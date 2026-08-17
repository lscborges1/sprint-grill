import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import {
  createCeremonyLifecycle,
  type ArtifactApproval,
  type ArtifactGateInput,
  type CeremonyLifecycle,
  type CeremonyDumpInput,
  type CeremonySession,
  type DiscardSpecDraftInput,
  type DossieState,
  type PalcoState,
  type SaveSpecDraftInput,
  type SpecDraft,
  type TicketArtifact,
} from "@sprint-griller/ceremony";
import { defaultCeremonyDbPath, loadAdoCredentials } from "@sprint-griller/core";
import { z } from "zod";
import { getInvestigation } from "./investigations";
import { logger } from "./logger";
import { getSquadConfig } from "./squad-config";

/** Um id de sessão vem da URL: passa por aqui antes de virar consulta. */
export const sessionIdSchema = z.string().min(1);

export const consultationSchema = z.object({
  sessionId: sessionIdSchema,
  question: z.string().trim().min(1, "escreva a dúvida"),
});

const decisionAnswerSchema = z.string().trim().min(1, "escolha ou escreva a resposta da sala");

/** Forma que o browser envia: o tipo impede misturar opção e texto livre. */
export const decisionFormSchema = z.discriminatedUnion("answerKind", [
  z.object({
    sessionId: sessionIdSchema,
    questionId: z.string().min(1),
    answerKind: z.literal("option"),
    answer: decisionAnswerSchema,
  }),
  z.object({
    sessionId: sessionIdSchema,
    questionId: z.string().min(1),
    answerKind: z.literal("free-text"),
    answer: decisionAnswerSchema,
  }),
]);

/** Contrato de domínio: a origem da resposta não atravessa a fronteira. */
export const decisionSchema = z.object({
  sessionId: sessionIdSchema,
  questionId: z.string().min(1),
  answer: decisionAnswerSchema,
});

export const artifactGateSchema = z.object({
  sessionId: sessionIdSchema,
  expectedRevision: z.coerce.number().int().nonnegative(),
}) satisfies z.ZodType<ArtifactGateInput>;

const expectedSavedAtSchema = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce.number().int().positive().nullable(),
);

const overwriteSchema = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean(),
);

export const specDraftSchema = z.object({
  sessionId: sessionIdSchema,
  // Valida vazio sem `.trim()` no valor: whitespace à esquerda pode ser Markdown.
  markdown: z.string().refine((value) => value.trim() !== "", {
    message: "o documento não pode ficar vazio",
  }),
  base: z.string(),
  expectedSavedAt: expectedSavedAtSchema,
  overwrite: overwriteSchema,
});

export const discardSpecDraftSchema = z.object({
  sessionId: sessionIdSchema,
  expectedSavedAt: expectedSavedAtSchema,
});

export const dumpCeremonySchema = z.object({
  sessionId: sessionIdSchema,
  estimate: z.coerce.number().finite().positive("registre a estimativa da squad"),
}) satisfies z.ZodType<CeremonyDumpInput>;

type CeremonyGlobal = typeof globalThis & {
  __sprintGrillerCeremonyLifecycle?: CeremonyLifecycle;
};

const squadConfig = getSquadConfig();

/**
 * A única fronteira de infraestrutura do Next. Piná-la no global preserva a
 * sessão viva, o SQLite e assinaturas SSE durante HMR no `next dev`.
 */
const lifecycle = ((globalThis as CeremonyGlobal).__sprintGrillerCeremonyLifecycle ??=
  createCeremonyLifecycle({
    dbPath: defaultCeremonyDbPath(),
    repos: squadConfig.repos,
    resolveStartInput: (storyId) => ceremonyInputFromInvestigation(getInvestigation(storyId)),
    adoOptions: () => ({
      azureDevOps: squadConfig.azureDevOps,
      credentials: loadAdoCredentials(),
      logger,
    }),
    runtimeFactory: () => createAgentRuntime({ cwd: squadConfig.repos.primary.path, logger }),
    logger,
  }));

/**
 * Abre a cerimônia de uma US **investigada**: a Investigação aprovada é o insumo
 * do Refinamento coletivo.
 */
export function startCeremony(storyId: number): Promise<CeremonySession> {
  return lifecycle.start(storyId);
}

function ceremonyInputFromInvestigation(
  run: ReturnType<typeof getInvestigation>,
) {
  if (run?.status !== "aprovado" || run.story === undefined) return undefined;
  return {
    story: {
      id: run.story.id,
      title: run.story.title,
      description: run.story.description,
      url: run.story.url,
    },
    investigationMarkdown: run.markdown,
  };
}

/** O Palco lido do banco — sem subir o runtime só para uma leitura. */
export function getPalco(sessionId: string): PalcoState | undefined {
  return lifecycle.palco(sessionId);
}

/** O Dossiê é projeção do estado gravado e não precisa do agente. */
export function getDossie(sessionId: string): DossieState | undefined {
  return lifecycle.dossie(sessionId);
}

/** Grava a edição do Operador e avisa as telas — o despejo é outro passo. */
export function saveSpecDraft(input: SaveSpecDraftInput): SpecDraft {
  return lifecycle.saveSpecDraft(input);
}

export function discardSpecDraft(input: DiscardSpecDraftInput): void {
  lifecycle.discardSpecDraft(input);
}

/** O despejo é serial por US e permanece responsabilidade do ciclo de vida. */
export function dumpCeremony(input: z.infer<typeof dumpCeremonySchema>): Promise<void> {
  return lifecycle.dump(input);
}

export function findOpenCeremony(storyId: number): CeremonySession | undefined {
  return lifecycle.findOpen(storyId);
}

export async function submitDecision(input: z.infer<typeof decisionSchema>): Promise<void> {
  await lifecycle.decide(input);
}

/** Dispara a Consulta factual; a resposta chega ao Palco pelo SSE. */
export async function addDoubt(input: z.infer<typeof consultationSchema>): Promise<void> {
  await lifecycle.consult(input);
}

export function resumeCeremony(sessionId: string): Promise<void> {
  return lifecycle.resume(sessionId);
}

export function confirmRefinement(input: ArtifactGateInput): Promise<void> {
  return lifecycle.confirmRefinement(input);
}

export function continueRefining(input: ArtifactGateInput): Promise<void> {
  return lifecycle.continueRefining(input);
}

export function approveSpec(input: ArtifactGateInput): Promise<ArtifactApproval> {
  return lifecycle.approveSpec(input);
}

export function approveTickets(
  input: ArtifactGateInput,
): Promise<NonNullable<TicketArtifact["approval"]>> {
  return lifecycle.approveTickets(input);
}

export function reopenRefinement(input: ArtifactGateInput): Promise<void> {
  return lifecycle.reopenRefinement(input);
}

/** Assina o Palco de uma sessão. Devolve o cancelamento — o SSE chama no `cancel`. */
export function subscribeToPalco(
  sessionId: string,
  listener: (state: PalcoState) => void,
): () => void {
  return lifecycle.subscribePalco(sessionId, listener);
}

/** Assina o Dossiê da mesma sessão: a aba do Operador anda junto com o Palco. */
export function subscribeToDossie(
  sessionId: string,
  listener: (state: DossieState) => void,
): () => void {
  return lifecycle.subscribeDossie(sessionId, listener);
}
