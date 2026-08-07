import { z } from "zod";
import type { DossieState } from "./types";

// O vocabulário da Spec anda com os contratos: a aba do Dossiê é uma tela ao
// vivo, e precisa das mesmas palavras que o Markdown do despejo.
export { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";

/**
 * Os contratos do SSE — Palco e Dossiê — e o único módulo deste pacote que o
 * browser importa, daí ele viver fora do barril, no subpath
 * `@sprint-griller/ceremony/session-state`: o barril puxa o store, e o store
 * puxa o binding nativo do SQLite, que não existe no bundle do cliente.
 *
 * Só dependências de tipo aqui dentro. Nada de runtime além do zod.
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
});

/**
 * O Dossiê chega ao browser pelo mesmo caminho do Palco. `generated` e `draft`
 * viajam separados de propósito: é a comparação entre o texto gerado agora e a
 * `base` da edição que denuncia um documento assinado antes da última decisão.
 */
export const dossieStateSchema: z.ZodType<DossieState> = z.object({
  sessionId: z.string(),
  story: storySchema,
  decisions: z.array(decisionSchema),
  pending: z.array(z.string()),
  investigation: z.object({ impact: z.string(), unverified: z.string() }),
  spec: z.object({
    generated: z.string(),
    draft: z
      .object({ markdown: z.string(), base: z.string(), savedAt: z.number() })
      .nullable(),
  }),
});
