import { z } from "zod";

/**
 * Superfície do protocolo do `codex app-server` que este módulo consome —
 * e só ela. Os bindings oficiais completos saem de
 * `codex app-server generate-ts --out <dir> --experimental` (verificado contra
 * codex-cli 0.146.1); aqui ficam schemas estreitos dos campos que a gente lê,
 * porque o protocolo cresce a cada release e campo novo não pode quebrar uma
 * cerimônia.
 */

export const CLIENT_NAME = "sprint-griller";
export const CLIENT_VERSION = "0.1.0";

/** Ferramenta própria de HITL: superfície estável, sob nosso controle. */
export const ASK_OPERATOR_TOOL_NAME = "ask_operator";

export type RequestId = number | string;

const requestIdSchema = z.union([z.number(), z.string()]);

const rawMessageSchema = z.object({
  id: requestIdSchema.optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

export type IncomingMessage =
  | { readonly kind: "response"; readonly id: RequestId; readonly result: unknown }
  | { readonly kind: "error-response"; readonly id: RequestId; readonly message: string }
  | {
      readonly kind: "server-request";
      readonly id: RequestId;
      readonly method: string;
      readonly params: unknown;
    }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown };

/**
 * Classifica uma linha do app-server. JSON-RPC não marca o tipo da mensagem:
 * quem tem `method` + `id` é request do servidor, só `method` é notificação, e
 * só `id` é resposta a um request nosso.
 */
export function parseIncomingMessage(line: string): IncomingMessage | null {
  const parsed = rawMessageSchema.safeParse(JSON.parse(line));
  if (!parsed.success) return null;

  const { id, method, params, result, error } = parsed.data;

  if (method !== undefined && id !== undefined) {
    return { kind: "server-request", id, method, params };
  }
  if (method !== undefined) return { kind: "notification", method, params };
  if (id === undefined) return null;
  if (error) return { kind: "error-response", id, message: error.message };
  return { kind: "response", id, result };
}

export const threadResponseSchema = z.object({ thread: z.object({ id: z.string() }) });

export const turnStartResponseSchema = z.object({ turn: z.object({ id: z.string() }) });

/**
 * Todo evento de turno vem carimbado com o turno de origem, e é isso que separa
 * o turno corrente do rastro de um turno abandonado. `turn/completed` é a
 * exceção: lá o id mora em `turn.id`.
 */
export const agentMessageDeltaSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  delta: z.string(),
});

export const itemCompletedSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  item: z.object({ type: z.string(), text: z.string().optional() }),
});

export const turnCompletedSchema = z.object({
  threadId: z.string(),
  turn: z.object({
    id: z.string(),
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
    error: z.object({ message: z.string() }).nullish(),
    durationMs: z.number().nullish(),
  }),
});

export const errorNotificationSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  error: z.object({ message: z.string() }),
  willRetry: z.boolean(),
});

const questionOptionSchema = z.object({ label: z.string(), description: z.string() });

/** `item/tool/requestUserInput` — experimental, pode não existir na versão instalada. */
export const requestUserInputParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        header: z.string(),
        question: z.string(),
        isOther: z.boolean().default(false),
        options: z.array(questionOptionSchema).nullish(),
      }),
    )
    .min(1),
});

/** `item/tool/call` — a chamada da nossa `ask_operator`. */
export const dynamicToolCallParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  tool: z.string(),
  arguments: z.unknown(),
});

/** Resposta de `item/tool/call`: o texto volta para o agente como saída da ferramenta. */
export interface DynamicToolCallResponse {
  readonly contentItems: readonly { readonly type: "inputText"; readonly text: string }[];
  readonly success: boolean;
}

export const askOperatorArgumentsSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().describe("Identificador curto e único da pergunta."),
        header: z.string().describe("Rótulo do assunto, poucas palavras."),
        question: z.string(),
        // Obrigatória de propósito: sem recomendação a pergunta é um fato que
        // você deveria ter buscado no código, e o schema recusa a chamada.
        recommendation: z
          .string()
          .min(1)
          .describe("O que você recomenda, e por quê. Sem isso a pergunta é recusada."),
        evidence: z
          .array(z.string())
          .default([])
          .describe("Evidências curtas que sustentam a recomendação, ex.: `repo · caminho/arquivo.ts`."),
        options: z
          .array(questionOptionSchema)
          .default([])
          .describe("Alternativas, quando houver alternativas claras."),
        allowFreeText: z
          .boolean()
          .default(true)
          .describe("Se a sala pode responder fora das opções."),
      }),
    )
    .min(1)
    .max(3),
});

/** Serve tanto para `item/commandExecution/requestApproval` quanto para o de arquivo. */
export const approvalParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  command: z.string().nullish(),
  reason: z.string().nullish(),
  grantRoot: z.string().nullish(),
});

/**
 * Declarada em `thread/start`, chega de volta como `item/tool/call`. Existe
 * porque o `requestUserInput` nativo é experimental e está atrás de um feature
 * flag ainda em desenvolvimento — esta não depende de nada.
 *
 * O JSON Schema é derivado do schema zod acima: o modelo e o parser enxergam a
 * mesma forma, sempre.
 */
export const askOperatorToolSpec = {
  type: "function",
  name: ASK_OPERATOR_TOOL_NAME,
  description:
    "Pergunta à sala (squad + PO) quando uma decisão depende de gente, não de código. " +
    "Faça de 1 a 3 perguntas por chamada, cada uma com `recommendation` (obrigatória) e opções " +
    "quando houver alternativas claras. Fato que o código responde você busca sozinho — se você " +
    "não consegue recomendar nada, não é decisão da sala. " +
    "Prefira perguntar a assumir: decisão assumida em silêncio é o que o produto existe para evitar.",
  inputSchema: z.toJSONSchema(askOperatorArgumentsSchema, { io: "input", target: "draft-7" }),
} as const;
