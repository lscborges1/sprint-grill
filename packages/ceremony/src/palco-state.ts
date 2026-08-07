import { z } from "zod";
import type { PalcoState } from "./types";

/**
 * O contrato do SSE, e o único módulo deste pacote que o browser importa —
 * daí ele viver fora do barril, no subpath `@sprint-griller/ceremony/palco-state`:
 * o barril puxa o store, e o store puxa o binding nativo do SQLite, que não
 * existe no bundle do cliente.
 *
 * Só dependências de tipo aqui dentro. Nada de runtime além do zod.
 */

const decisionSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  recommendation: z.string(),
  answer: z.string(),
  decidedBy: z.string(),
  decidedAt: z.number(),
});

const questionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  recommendation: z.string(),
  evidence: z.array(z.string()),
  options: z.array(z.object({ label: z.string(), description: z.string() })),
  allowFreeText: z.boolean(),
});

/**
 * O Palco recebe o estado inteiro pela rede a cada mudança: é dado externo do
 * ponto de vista do browser, e entra por schema — não por `as PalcoState`.
 */
export const palcoStateSchema: z.ZodType<PalcoState> = z.object({
  sessionId: z.string(),
  story: z.object({ id: z.number(), title: z.string(), url: z.string() }),
  decisionCount: z.number(),
  lastDecision: decisionSchema.nullable(),
  live: z.boolean(),
  current: z.discriminatedUnion("phase", [
    z.object({ phase: z.literal("perguntando"), question: questionSchema }),
    z.object({ phase: z.literal("pensando") }),
    z.object({ phase: z.literal("retomavel") }),
    z.object({ phase: z.literal("encerrada") }),
    z.object({ phase: z.literal("falhou"), message: z.string() }),
  ]),
});
