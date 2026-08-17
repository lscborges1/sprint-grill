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
export const ADD_REFINEMENT_ITEM_TOOL_NAME = "add_refinement_item";
export const AGENDA_RESOLUTION_TOOL_NAME = "resolve_refinement_item";
export const COMPLETION_PROPOSAL_TOOL_NAME = "propose_refinement_completion";
export const SPEC_SUBMISSION_TOOL_NAME = "submit_refinement_spec";
export const TICKETS_SUBMISSION_TOOL_NAME = "submit_refinement_tickets";
export const AGENT_TOOL_NAMES = [
  ASK_OPERATOR_TOOL_NAME,
  ADD_REFINEMENT_ITEM_TOOL_NAME,
  AGENDA_RESOLUTION_TOOL_NAME,
  COMPLETION_PROPOSAL_TOOL_NAME,
  SPEC_SUBMISSION_TOOL_NAME,
  TICKETS_SUBMISSION_TOOL_NAME,
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

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

const askOperatorQuestionSchema = z
  .object({
    id: z.string().min(1).describe("Identificador curto e único da pergunta."),
    agendaItemId: z
      .string()
      .min(1)
      .describe("Identificador do item persistido da Agenda que esta pergunta resolve."),
    header: z.string().describe("Rótulo do assunto, poucas palavras."),
    question: z.string(),
    // Obrigatória de propósito: sem recomendação a pergunta é um fato que
    // você deveria ter buscado no código, e o schema recusa a chamada.
    recommendation: z
      .string()
      .min(1)
      .describe("O que você recomenda, e por quê. Sem isso a pergunta é recusada."),
    evidence: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "Evidências curtas que sustentam a recomendação (obrigatório, ao menos uma), ex.: `repo · caminho/arquivo.ts`.",
      ),
    options: z
      .array(questionOptionSchema)
      .default([])
      .describe("Alternativas, quando houver alternativas claras."),
    allowFreeText: z
      .boolean()
      .default(true)
      .describe("Se a sala pode responder fora das opções."),
  })
  .superRefine((question, ctx) => {
    // Sem opções e sem texto livre o Palco não tem como responder.
    if (question.options.length === 0 && !question.allowFreeText) {
      ctx.addIssue({
        code: "custom",
        message:
          "pergunte com opções ou com allowFreeText: true — senão a sala não tem como responder.",
        path: ["allowFreeText"],
      });
    }
  });

export const askOperatorArgumentsSchema = z.object({
  questions: z
    .array(askOperatorQuestionSchema)
    .length(1)
    .superRefine((questions, ctx) => {
      const seen = new Set<string>();
      for (const [index, question] of questions.entries()) {
        if (seen.has(question.id)) {
          ctx.addIssue({
            code: "custom",
            message: `id de pergunta duplicado: ${question.id}`,
            path: [index, "id"],
          });
          continue;
        }
        seen.add(question.id);
      }
    }),
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
    "Faça exatamente uma pergunta por chamada, vinculada por `agendaItemId`, com `recommendation` e ao menos uma `evidence` " +
    "(ambas obrigatórias), ids únicos, e um jeito de responder: opções e/ou `allowFreeText: true`. " +
    "Fato que o código responde você busca sozinho — se você não consegue recomendar nada, " +
    "não é decisão da sala. Prefira perguntar a assumir: decisão assumida em silêncio é o que " +
    "o produto existe para evitar.",
  inputSchema: z.toJSONSchema(askOperatorArgumentsSchema, { io: "input", target: "draft-7" }),
} as const;

export const completionProposalArgumentsSchema = z.object({
  summary: z.string().trim().min(1).describe("Resumo curto de por que a Agenda está encerrada."),
});

export const completionProposalToolSpec = {
  type: "function",
  name: COMPLETION_PROPOSAL_TOOL_NAME,
  description:
    "Propõe explicitamente encerrar a etapa Refinar. O sistema confere a Agenda; terminar o turno não encerra nada.",
  inputSchema: z.toJSONSchema(completionProposalArgumentsSchema, {
    io: "input",
    target: "draft-7",
  }),
} as const;

export const addRefinementItemArgumentsSchema = z.object({
  question: z.string().trim().min(1),
});

export const addRefinementItemToolSpec = {
  type: "function",
  name: ADD_REFINEMENT_ITEM_TOOL_NAME,
  description:
    "Adiciona à Agenda um furo novo descoberto durante o Refinamento e devolve o ID persistido para perguntar ou resolver.",
  inputSchema: z.toJSONSchema(addRefinementItemArgumentsSchema, {
    io: "input",
    target: "draft-7",
  }),
} as const;

const refinementCitationSchema = z.object({
  repo: z.string().trim().min(1),
  path: z.string().trim().min(1),
  symbol: z.string().trim().min(1).optional(),
});

export const agendaResolutionArgumentsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fact"),
    agendaItemId: z.string().trim().min(1),
    answer: z.string().trim().min(1),
    citations: z.array(refinementCitationSchema).min(1),
  }),
  z.object({
    kind: z.literal("out-of-scope"),
    agendaItemId: z.string().trim().min(1),
    justification: z.string().trim().min(1),
  }),
]);

export const agendaResolutionToolSpec = {
  type: "function",
  name: AGENDA_RESOLUTION_TOOL_NAME,
  description:
    "Resolve um item aberto da Agenda como fato verificado ou justifica que ele está fora de escopo. " +
    "Fatos exigem resposta e ao menos uma citação de arquivo; caminhos e símbolos serão conferidos mecanicamente.",
  inputSchema: z.toJSONSchema(agendaResolutionArgumentsSchema, {
    io: "input",
    target: "draft-7",
  }),
} as const;

const structuredSpecListEntrySchema = z.string().trim().min(1);

export const refinementSpecSubmissionSchema = z.object({
  problem: z.string().min(1),
  solution: z.string().min(1),
  expectedBehaviors: z.array(structuredSpecListEntrySchema),
  implementationDecisions: z.array(structuredSpecListEntrySchema),
  testStrategy: z.array(structuredSpecListEntrySchema),
  outOfScope: z.array(structuredSpecListEntrySchema),
  traceability: z.array(structuredSpecListEntrySchema),
});

export const refinementSpecSubmissionToolSpec = {
  type: "function",
  name: SPEC_SUBMISSION_TOOL_NAME,
  description: "Submete uma Spec estruturada para o gate de revisão da cerimônia.",
  inputSchema: z.toJSONSchema(refinementSpecSubmissionSchema, { io: "input", target: "draft-7" }),
} as const;

const ticketListEntrySchema = z.string().min(1);
const acceptanceCriteriaInputSchema = z.array(ticketListEntrySchema).min(1).describe(
  "Critérios de aceite sem entradas repetidas.",
);
const blockedByInputSchema = z.array(ticketListEntrySchema).describe(
  "IDs de Tickets bloqueadores sem entradas repetidas.",
);

const refinementTicketSubmissionInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: acceptanceCriteriaInputSchema,
  specUrl: z.string().url(),
  blockedBy: blockedByInputSchema,
});

export const refinementTicketSubmissionSchema = refinementTicketSubmissionInputSchema.extend({
  acceptanceCriteria: acceptanceCriteriaInputSchema.refine(
    (entries) => new Set(entries).size === entries.length,
    { message: "os critérios de aceite não podem se repetir" },
  ),
  blockedBy: blockedByInputSchema.refine(
    (entries) => new Set(entries).size === entries.length,
    { message: "as dependências não podem se repetir" },
  ),
});

const refinementTicketsSubmissionInputSchema = z.object({
  tickets: z.array(refinementTicketSubmissionInputSchema).min(1),
});

const refinementTicketSubmissionsSchema = z
  .array(refinementTicketSubmissionSchema)
  .min(1)
  .superRefine((tickets, ctx) => {
    const ids = new Set<string>();
    for (const [index, ticket] of tickets.entries()) {
      if (ids.has(ticket.id)) {
        ctx.addIssue({
          code: "custom",
          message: `id de Ticket duplicado: ${ticket.id}`,
          path: [index, "id"],
        });
      }
      ids.add(ticket.id);
    }
  });

export const refinementTicketsSubmissionSchema = z.object({
  tickets: refinementTicketSubmissionsSchema,
});

export const refinementTicketsSubmissionToolSpec = {
  type: "function",
  name: TICKETS_SUBMISSION_TOOL_NAME,
  description: "Submete Tickets estruturados para o gate de revisão da cerimônia.",
  inputSchema: z.toJSONSchema(refinementTicketsSubmissionInputSchema, {
    io: "input",
    target: "draft-7",
  }),
} as const;
