import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import {
  CeremonyError,
  createCeremony,
  createCeremonyDump,
  openCeremonyStore,
  readDossie,
  readPalco,
} from "@sprint-griller/ceremony";
import type {
  Ceremony,
  CeremonyDump,
  CeremonyDumpInput,
  CeremonySession,
  CeremonyStore,
  DossieState,
  DiscardSpecDraftInput,
  PalcoState,
  SaveSpecDraftInput,
  SpecDraft,
  StartCeremonyInput,
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

/** Assinante de uma sessão: o que ele projeta é decisão dele, não do registro. */
type SessionListener = () => void;

interface CeremonyRegistry {
  store: CeremonyStore | undefined;
  ceremony: Ceremony | undefined;
  dump: CeremonyDump | undefined;
  starting: Promise<Ceremony> | undefined;
  /** Evita duas sessões ativas da mesma US quando o clique em "Grelhar" corre em paralelo. */
  startingByStory: Map<number, Promise<CeremonySession>>;
  listeners: Map<string, Set<SessionListener>>;
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
  dump: undefined,
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

/** O despejo nasce só quando start ou publish realmente precisam do ADO. */
function getCeremonyDump(): CeremonyDump {
  registry.dump ??= createCeremonyDump({
    store: getStore(),
    adoOptions: () => {
      const { azureDevOps } = getSquadConfig();
      return { azureDevOps, credentials: loadAdoCredentials(), logger };
    },
    logger,
    onChange: publish,
  });
  return registry.dump;
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
    const startInput = ceremonyInputFromInvestigation(run);
    await getCeremonyDump().assertCanStartCeremony({
      storyId,
      investigationApproved: startInput !== undefined,
    });
    if (!startInput) {
      throw new Error("assertCanStartCeremony aceitou uma Investigação não aprovada.");
    }

    const ceremony = await getCeremony();
    // Outro caminho pode ter aberto a sessão enquanto o runtime subia.
    const raced = getStore().findOpenSessionByStory(storyId);
    if (raced) return raced;

    return ceremony.start(startInput);
  })().finally(() => {
    registry.startingByStory.delete(storyId);
  });

  registry.startingByStory.set(storyId, starting);
  return starting;
}

function ceremonyInputFromInvestigation(
  run: ReturnType<typeof getInvestigation>,
): StartCeremonyInput | undefined {
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

/**
 * O Palco lido do banco: é o que faz o refresh voltar no mesmo ponto. Sem
 * cerimônia no processo (app recém-reiniciado) não há turno vivo, e a sessão
 * aberta aparece como retomável — sem subir o `codex app-server` só para ler.
 */
export function getPalco(sessionId: string): PalcoState | undefined {
  return registry.ceremony?.palco(sessionId) ?? readPalco(getStore(), sessionId, false);
}

/**
 * O Dossiê nunca precisa do agente: ele é leitura do que está gravado, e salvar
 * uma edição também. Subir o `codex app-server` só para o Operador revisar o
 * documento seria custo sem contrapartida.
 */
export function getDossie(sessionId: string): DossieState | undefined {
  return readDossie(getStore(), sessionId);
}

/** Grava a edição do Operador e avisa as telas — o despejo é outro passo. */
export function saveSpecDraft(input: SaveSpecDraftInput): SpecDraft {
  const draft = getStore().saveSpecDraft(input);
  publish(input.sessionId);
  return draft;
}

export function discardSpecDraft(input: DiscardSpecDraftInput): void {
  getStore().discardSpecDraft(input);
  publish(input.sessionId);
}

/**
 * O despejo é serial por US: cada comment confirmado fica no SQLite antes da
 * próxima escrita, então um retry explícito não duplica Registros já vistos e
 * duas cerimônias da mesma US não publicam em paralelo.
 */
export function dumpCeremony(input: z.infer<typeof dumpCeremonySchema>): Promise<void> {
  const initial = getDossie(input.sessionId);
  if (!initial) {
    return Promise.reject(new CeremonyError(`cerimônia ${input.sessionId} não existe.`));
  }

  if (registry.startingByStory.has(initial.story.id)) {
    return Promise.reject(new CeremonyError(
      `a US #${initial.story.id} já está abrindo outra cerimônia. Aguarde antes de despejar.`,
    ));
  }
  return getCeremonyDump().publish(input);
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
export function subscribeToPalco(
  sessionId: string,
  listener: (state: PalcoState) => void,
): () => void {
  return subscribe(sessionId, () => {
    const state = getPalco(sessionId);
    if (state) listener(state);
  });
}

/** Assina o Dossiê da mesma sessão: a aba do Operador anda junto com o Palco. */
export function subscribeToDossie(
  sessionId: string,
  listener: (state: DossieState) => void,
): () => void {
  return subscribe(sessionId, () => {
    const state = getDossie(sessionId);
    if (state) listener(state);
  });
}

function subscribe(sessionId: string, listener: SessionListener): () => void {
  const listeners = registry.listeners.get(sessionId) ?? new Set<SessionListener>();
  listeners.add(listener);
  registry.listeners.set(sessionId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) registry.listeners.delete(sessionId);
  };
}

function publish(sessionId: string): void {
  for (const listener of registry.listeners.get(sessionId) ?? []) {
    try {
      listener();
    } catch (error) {
      logger.warn({ err: error, sessionId }, "assinante da cerimônia quebrou ao receber estado");
    }
  }
}
