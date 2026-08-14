import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import {
  createCeremonyLifecycle,
  type CeremonyLifecycle,
  type CeremonyDumpInput,
  type CeremonySession,
  type DiscardSpecDraftInput,
  type DossieState,
  type PalcoState,
  type SaveSpecDraftInput,
  type SpecDraft,
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
  question: z.string().trim().min(1, "escreva a dúvida de fato"),
});

export const decisionSchema = z.object({
  sessionId: sessionIdSchema,
  questionId: z.string().min(1),
  answer: z.string().trim().min(1, "escolha ou escreva a resposta da sala"),
  decidedBy: z.string().trim().min(1, "registre quem decidiu"),
});

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
  markdown: z.string().min(1),
  base: z.string(),
  tasksMarkdown: z.string().min(1, "escreva as Tasks agent-ready antes de despejar"),
  estimate: z.coerce.number().finite().positive("registre a estimativa da squad"),
  confirmPending: z.boolean(),
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
 * do grilling, e sem ela não há o que grelhar.
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
export async function askFact(input: z.infer<typeof consultationSchema>): Promise<void> {
  await lifecycle.consult(input);
}

export function resumeCeremony(sessionId: string): Promise<void> {
  return lifecycle.resume(sessionId);
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
