import { z } from "zod";
import type {
  RefinementCompletionProposal,
  RefinementItem,
  RefinementState,
} from "./types";

const citationSchema = z.object({
  repo: z.string(),
  path: z.string(),
  symbol: z.string().optional(),
});

const itemBase = {
  id: z.string(),
  question: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
};

export const refinementStateSchema: z.ZodType<RefinementState> = z.object({
  phase: z.enum([
    "refinando",
    "aguardando-confirmacao",
    "revisando-spec",
    "revisando-tickets",
    "pronto-para-publicar",
    "publicado",
  ]),
  revision: z.number().int().nonnegative(),
});

export const refinementCompletionProposalSchema: z.ZodType<RefinementCompletionProposal> =
  z.object({ summary: z.string(), proposedAt: z.number() });

export const refinementItemSchema: z.ZodType<RefinementItem> = z.discriminatedUnion("status", [
  z.object({ ...itemBase, status: z.enum(["aberto", "pesquisando", "aguardando-sala"]) }),
  z.object({
    ...itemBase,
    status: z.literal("resolvido"),
    resolution: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("fato"),
        answer: z.string(),
        citations: z.array(citationSchema),
        resolvedAt: z.number(),
      }),
      z.object({
        kind: z.literal("escolha"),
        answer: z.string(),
        recommendation: z.string(),
        resolvedAt: z.number(),
      }),
    ]),
  }),
  z.object({
    ...itemBase,
    status: z.literal("fora-de-escopo"),
    resolution: z.object({
      kind: z.literal("fora-de-escopo"),
      justification: z.string(),
      resolvedAt: z.number(),
    }),
  }),
]);
