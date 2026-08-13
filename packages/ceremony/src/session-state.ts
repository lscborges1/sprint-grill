import { z } from "zod";
import type { CeremonyDumpState, DossieState, SignedDumpInputs } from "./types";

// O vocabulário da Spec anda com os contratos: a aba do Dossiê é uma tela ao
// vivo, e precisa das mesmas palavras que o Markdown do despejo.
export { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";

/**
 * Os contratos do SSE — Palco e Dossiê — e o único módulo deste pacote que o
 * browser importa, daí ele viver fora do barril, no subpath
 * `@sprint-griller/ceremony/session-state`: o barril puxa o store, e o store
 * puxa o binding nativo do SQLite, que não existe no bundle do cliente.
 *
 * Tudo aqui continua browser-safe: schemas e projeções puras, sem store nem
 * binding nativo.
 */

const storySchema = z.object({ id: z.number(), title: z.string(), url: z.string() });

const decisionSchema = z.object({
  questionSeq: z.number(),
  questionId: z.string(),
  question: z.string(),
  recommendation: z.string(),
  answer: z.string(),
  decidedBy: z.string(),
  decidedAt: z.number(),
  recordId: z.number().int().positive().optional(),
  recordUrl: z.string().url().optional(),
});

const signedDumpInputsSchema = z.object({
  dumpId: z.string(),
  markdown: z.string(),
  tasksMarkdown: z.string(),
  estimate: z.number().finite().positive(),
});

const dumpStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-started") }),
  z.object({
    status: z.literal("publishing"),
    inputs: signedDumpInputsSchema,
    startedAt: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal("retryable"), inputs: signedDumpInputsSchema }),
  z.object({
    status: z.literal("completed"),
    inputs: signedDumpInputsSchema,
    completedAt: z.number().int().nonnegative(),
  }),
]);

/**
 * O Dossiê chega ao browser pelo mesmo caminho do Palco. `generated` e `draft`
 * viajam separados de propósito: é a comparação entre o texto gerado agora e a
 * `base` da edição que denuncia um documento assinado antes da última decisão.
 */
export const dossieStateSchema: z.ZodType<DossieState> = z.object({
  sessionId: z.string(),
  status: z.enum(["ativa", "encerrada", "falhou"]),
  timeZone: z.string(),
  taskPreview: z.string(),
  dump: dumpStateSchema,
  story: storySchema,
  decisions: z.array(decisionSchema),
  pending: z.array(z.object({ id: z.string(), question: z.string() })),
  investigation: z.object({ impact: z.string(), unverified: z.string() }),
  spec: z.object({
    generated: z.string(),
    draft: z
      .object({ markdown: z.string(), base: z.string(), savedAt: z.number() })
      .nullable(),
  }),
});

/** Os inputs assinados existem em todos os estados posteriores ao primeiro beginDump. */
export function signedDumpInputs(dump: CeremonyDumpState): SignedDumpInputs | undefined {
  switch (dump.status) {
    case "not-started":
      return undefined;
    case "publishing":
    case "retryable":
    case "completed":
      return dump.inputs;
  }
}
