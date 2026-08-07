import { z } from "zod";
import type { CeremonyConsultation, PalcoState } from "./types";

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

const citationSchema = z.object({
  repo: z.string(),
  path: z.string(),
  symbol: z.string().optional(),
});

const askedSchema = { id: z.string(), question: z.string(), askedAt: z.number() };
const answeredSchema = { ...askedSchema, answeredAt: z.number() };

const consultationSchema: z.ZodType<CeremonyConsultation> = z.discriminatedUnion("status", [
  z.object({ ...askedSchema, status: z.literal("buscando") }),
  z.object({
    ...answeredSchema,
    status: z.literal("respondida"),
    answer: z.string(),
    citations: z.array(citationSchema),
  }),
  z.object({
    ...answeredSchema,
    status: z.literal("sem-lastro"),
    answer: z.string(),
    citations: z.array(citationSchema),
    motivo: z.string(),
  }),
  z.object({ ...answeredSchema, status: z.literal("falhou"), message: z.string() }),
]);

/**
 * O Palco recebe o estado inteiro pela rede a cada mudança: é dado externo do
 * ponto de vista do browser, e entra por schema — não por `as PalcoState`.
 */
export const palcoStateSchema: z.ZodType<PalcoState> = z.object({
  sessionId: z.string(),
  story: z.object({ id: z.number(), title: z.string(), url: z.string() }),
  decisionCount: z.number(),
  decisions: z.array(decisionSchema),
  pendingQuestions: z.array(questionSchema),
  lastDecision: decisionSchema.nullable(),
  consultation: consultationSchema.nullable(),
  live: z.boolean(),
  current: z.discriminatedUnion("phase", [
    z.object({ phase: z.literal("perguntando"), question: questionSchema }),
    z.object({ phase: z.literal("pensando") }),
    z.object({ phase: z.literal("retomavel") }),
    z.object({ phase: z.literal("encerrada") }),
    z.object({ phase: z.literal("falhou"), message: z.string() }),
  ]),
});
