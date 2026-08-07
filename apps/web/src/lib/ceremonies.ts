import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import { CeremonyError, createCeremony, openCeremonyStore, readPalco } from "@sprint-griller/ceremony";
import type { Ceremony, CeremonySession, CeremonyStore, PalcoState } from "@sprint-griller/ceremony";
import { defaultCeremonyDbPath } from "@sprint-griller/core";
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

type PalcoListener = (state: PalcoState) => void;

interface CeremonyRegistry {
  store: CeremonyStore | undefined;
  ceremony: Ceremony | undefined;
  starting: Promise<Ceremony> | undefined;
  /** Evita duas sessões ativas da mesma US quando o clique em "Grelhar" corre em paralelo. */
  startingByStory: Map<number, Promise<CeremonySession>>;
  listeners: Map<string, Set<PalcoListener>>;
}

/**
 * Pinado no globalThis para o HMR do `next dev` não abrir um segundo banco nem
 * derrubar os assinantes do Palco a cada save.
 */
const registry: CeremonyRegistry = ((
  globalThis as { __sprintGrillerCeremonies?: CeremonyRegistry }
).__sprintGrillerCeremonies ??= {
  store: undefined,
  ceremony: undefined,
  starting: undefined,
  startingByStory: new Map(),
  listeners: new Map(),
});
// Campo novo: HMR pode reusar um registry antigo sem ele.
registry.startingByStory ??= new Map();

/** Abrir o banco é efeito colateral: só acontece quando alguém pergunta de cerimônia. */
function getStore(): CeremonyStore {
  registry.store ??= openCeremonyStore(defaultCeremonyDbPath(), { logger });
  return registry.store;
}

/**
 * O runtime da cerimônia vive enquanto o app viver: o turno do grilling fica
 * aberto entre uma pergunta e outra, e a retomada precisa do mesmo processo do
 * `codex app-server`. Diferente da Investigação, que abre e fecha um por turno.
 */
async function getCeremony(): Promise<Ceremony> {
  if (registry.ceremony) return registry.ceremony;

  registry.starting ??= (async () => {
    const { repos } = getSquadConfig();
    const runtime = await createAgentRuntime({ cwd: repos.primary.path, logger });
    const ceremony = createCeremony({
      runtime,
      store: getStore(),
      repos,
      logger,
      onChange: publish,
    });
    registry.ceremony = ceremony;
    return ceremony;
  })();

  try {
    return await registry.starting;
  } catch (error) {
    registry.starting = undefined;
    logger.error({ err: error }, "falha ao subir a cerimônia");
    throw error;
  }
}

/**
 * Abre a cerimônia de uma US **investigada**: a Investigação aprovada é o insumo
 * do grilling, e sem ela não há o que grelhar.
 */
export async function startCeremony(storyId: number): Promise<CeremonySession> {
  const inFlight = registry.startingByStory.get(storyId);
  if (inFlight) return inFlight;

  const open = getStore().findOpenSessionByStory(storyId);
  if (open) return open;

  const starting = (async () => {
    const run = getInvestigation(storyId);
    if (run?.status !== "aprovado" || !run.story) {
      throw new CeremonyError(
        `A US #${storyId} ainda não tem Investigação aprovada — investigue antes de grelhar.`,
      );
    }

    const ceremony = await getCeremony();
    // Outro caminho pode ter aberto a sessão enquanto o runtime subia.
    const raced = getStore().findOpenSessionByStory(storyId);
    if (raced) return raced;

    return ceremony.start({
      story: {
        id: run.story.id,
        title: run.story.title,
        description: run.story.description,
        url: run.story.url,
      },
      investigationMarkdown: run.markdown,
    });
  })().finally(() => {
    registry.startingByStory.delete(storyId);
  });

  registry.startingByStory.set(storyId, starting);
  return starting;
}

/**
 * O Palco lido do banco: é o que faz o refresh voltar no mesmo ponto. Sem
 * cerimônia no processo (app recém-reiniciado) não há turno vivo, e a sessão
 * aberta aparece como retomável — sem subir o `codex app-server` só para ler.
 */
export function getPalco(sessionId: string): PalcoState | undefined {
  return registry.ceremony?.palco(sessionId) ?? readPalco(getStore(), sessionId, false);
}

export function findOpenCeremony(storyId: number): CeremonySession | undefined {
  return getStore().findOpenSessionByStory(storyId);
}

export async function submitDecision(input: z.infer<typeof decisionSchema>): Promise<void> {
  const ceremony = await getCeremony();
  await ceremony.decide(input);
}

/**
 * Dispara a Consulta factual da sala. Volta assim que ela é registrada — a
 * resposta do agente chega ao Palco pelo SSE, como todo o resto.
 */
export async function askFact(input: z.infer<typeof consultationSchema>): Promise<void> {
  const ceremony = await getCeremony();
  ceremony.consult(input);
}

export async function resumeCeremony(sessionId: string): Promise<void> {
  const ceremony = await getCeremony();
  await ceremony.resume(sessionId);
}

/** Assina o Palco de uma sessão. Devolve o cancelamento — o SSE chama no `cancel`. */
export function subscribeToPalco(sessionId: string, listener: PalcoListener): () => void {
  const listeners = registry.listeners.get(sessionId) ?? new Set<PalcoListener>();
  listeners.add(listener);
  registry.listeners.set(sessionId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) registry.listeners.delete(sessionId);
  };
}

function publish(sessionId: string): void {
  const listeners = registry.listeners.get(sessionId);
  if (!listeners || listeners.size === 0) return;

  const state = getPalco(sessionId);
  if (!state) return;

  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      logger.warn({ err: error, sessionId }, "assinante do Palco quebrou ao receber estado");
    }
  }
}
