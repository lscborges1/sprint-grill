import { z } from "zod";
import { dumpStateSchema } from "./dump-state";
import type { DossieState } from "./types";
import {
  refinementCompletionProposalSchema,
  refinementItemSchema,
  refinementStateSchema,
} from "./refinement-state";

export { signedDumpInputs } from "./dump-state";

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
  decidedAt: z.number(),
  recordId: z.number().int().positive().optional(),
  recordUrl: z.string().url().optional(),
});

const approvalSchema = z.object({
  revision: z.number().int().positive(),
  hash: z.string(),
  markdown: z.string(),
  approvedAt: z.number(),
});

const specSubmissionSchema = z.object({
  problem: z.string(),
  solution: z.string(),
  expectedBehaviors: z.array(z.string()),
  implementationDecisions: z.array(z.string()),
  testStrategy: z.array(z.string()),
  outOfScope: z.array(z.string()),
  traceability: z.array(z.string()),
});

const artifactsSchema = z.object({
  spec: z.object({
    revision: z.number().int().positive(),
    submission: specSubmissionSchema,
    markdown: z.string(),
    submittedAt: z.number(),
    approval: approvalSchema.nullable(),
  }).nullable(),
  tickets: z.object({
    revision: z.number().int().positive(),
    submission: z.object({
      tickets: z.array(z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        acceptanceCriteria: z.array(z.string()),
        specUrl: z.string(),
        blockedBy: z.array(z.string()),
      })),
    }),
    markdown: z.string(),
    submittedAt: z.number(),
    specRevision: z.number().int().positive(),
    specHash: z.string(),
    approval: approvalSchema.extend({
      specRevision: z.number().int().positive(),
      specHash: z.string(),
    }).nullable(),
  }).nullable(),
});

/**
 * O Dossiê chega ao browser pelo mesmo caminho do Palco. `generated` e `draft`
 * viajam separados de propósito: é a comparação entre o texto gerado agora e a
 * `base` da edição que denuncia um documento assinado antes da última decisão.
 */
export const dossieStateSchema: z.ZodType<DossieState> = z.object({
  sessionId: z.string(),
  status: z.enum(["ativa", "encerrada", "falhou"]),
  timeZone: z.string(),
  refinement: refinementStateSchema,
  completionProposal: refinementCompletionProposalSchema.nullable(),
  agenda: z.array(refinementItemSchema),
  artifacts: artifactsSchema,
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
