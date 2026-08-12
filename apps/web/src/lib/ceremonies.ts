import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import { createHash } from "node:crypto";
import {
  appendDecisionTraceability,
  CeremonyError,
  createCeremony,
  openCeremonyStore,
  readDossie,
  readPalco,
  stripDecisionRecordLinks,
  parseTaskDraft,
} from "@sprint-griller/ceremony";
import { isCeremonyEstimate } from "@sprint-griller/ceremony/estimate";
import type {
  Ceremony,
  CeremonyDumpState,
  CeremonySession,
  CeremonyStore,
  DossieState,
  DiscardSpecDraftInput,
  PalcoState,
  SaveSpecDraftInput,
  SignedDumpInputs,
  SpecDraft,
} from "@sprint-griller/ceremony";
import { defaultCeremonyDbPath, loadAdoCredentials } from "@sprint-griller/core";
import {
  publishDumpCompletion,
  publishChildTasks,
  publishDecisionRecord,
  publishStorySpec,
  readDumpCompletion,
  readIncompleteDumps,
} from "@sprint-griller/ado-client";
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
});

/** Assinante de uma sessão: o que ele projeta é decisão dele, não do registro. */
type SessionListener = () => void;

interface CeremonyRegistry {
  store: CeremonyStore | undefined;
  ceremony: Ceremony | undefined;
  starting: Promise<Ceremony> | undefined;
  /** Evita duas sessões ativas da mesma US quando o clique em "Grelhar" corre em paralelo. */
  startingByStory: Map<number, Promise<CeremonySession>>;
  listeners: Map<string, Set<SessionListener>>;
  dumpsInFlight: Map<string, Promise<void>>;
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
  dumpsInFlight: new Map(),
});
// Campo novo: HMR pode reusar um registry antigo sem ele.
registry.startingByStory ??= new Map();
registry.dumpsInFlight ??= new Map();

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

  const incompleteLocal = getStore().findIncompleteDumpByStory(storyId);
  if (incompleteLocal && isIncompleteDump(incompleteLocal.dump)) {
    throw new CeremonyError(
      `A US #${storyId} tem um despejo incompleto na cerimônia anterior. ` +
        `Abra o Dossiê dessa cerimônia e conclua o retry antes de grelhar de novo.`,
    );
  }

  const starting = (async () => {
    const run = getInvestigation(storyId);
    if (run?.status !== "aprovado" || !run.story) {
      throw new CeremonyError(
        `A US #${storyId} ainda não tem Investigação aprovada — investigue antes de grelhar.`,
      );
    }

    const { azureDevOps } = getSquadConfig();
    const incompleteRemote = await readIncompleteDumps(
      { azureDevOps, credentials: loadAdoCredentials(), logger },
      storyId,
    );
    if (incompleteRemote.length > 0) {
      throw new CeremonyError(
        `A US #${storyId} tem um despejo incompleto no Azure DevOps. ` +
          `Conclua o retry desse despejo antes de abrir outra cerimônia.`,
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
 * O despejo é serial por sessão: cada comment confirmado fica no SQLite antes
 * da próxima escrita, então um retry explícito não duplica Registros já vistos.
 * O fingerprint das Tasks/estimativa também fica gravado no início — mudar
 * esses inputs no retry quebraria a reconciliação das Tasks já criadas no ADO.
 */
export function dumpCeremony(input: z.infer<typeof dumpCeremonySchema>): Promise<void> {
  const inFlight = registry.dumpsInFlight.get(input.sessionId);
  if (inFlight) return inFlight;

  const dump = dumpCeremonyNow(input).finally(() => {
    registry.dumpsInFlight.delete(input.sessionId);
  });
  registry.dumpsInFlight.set(input.sessionId, dump);
  return dump;
}

async function dumpCeremonyNow(input: z.infer<typeof dumpCeremonySchema>): Promise<void> {
  const initial = getDossie(input.sessionId);
  if (!initial) throw new CeremonyError(`cerimônia ${input.sessionId} não existe.`);
  if (isCompletedDump(initial.dump)) return;
  if (getStore().getSession(input.sessionId)?.status !== "encerrada") {
    throw new CeremonyError("encerre a cerimônia antes de despejar.");
  }

  const frozenInputs = signedDumpInputs(initial.dump);
  const frozen = frozenInputs?.markdown;
  const signed = frozen ?? initial.spec.draft?.markdown ?? initial.spec.generated;
  if (input.markdown !== signed) {
    throw new CeremonyError(
      frozen === undefined
        ? "salve a edição do Dossiê antes de despejar."
        : "o despejo já começou com outra Spec — use a Spec assinada no retry.",
    );
  }
  // O próprio despejo pode ter acabado de anexar links de Registro ao documento
  // gerado. Isso não é uma nova decisão da sala e não invalida um retry.
  if (
    frozen === undefined &&
    stripDecisionRecordLinks(input.base) !== stripDecisionRecordLinks(initial.spec.generated)
  ) {
    throw new CeremonyError(
      "a cerimônia andou depois desta edição — regenere ou salve uma Spec atualizada antes de despejar.",
    );
  }
  if (initial.pending.length > 0 && !input.confirmPending) {
    throw new CeremonyError("confirme que deseja despejar com as pendências abertas.");
  }
  if (frozenInputs !== undefined && input.estimate !== frozenInputs.estimate) {
    throw new CeremonyError(
      "o despejo já começou com outra estimativa — use a estimativa assinada no retry.",
    );
  }
  if (frozenInputs === undefined && !isCeremonyEstimate(input.estimate)) {
    throw new CeremonyError("a estimativa deve usar a escala Fibonacci da squad.");
  }
  const tasks = parseTaskDraft(input.tasksMarkdown, initial.story.url);
  const dumpId = frozenInputs?.dumpId ?? dumpFingerprint(
    initial.sessionId,
    initial.story.id,
    signed,
    tasks,
    input.estimate,
  );

  const { azureDevOps } = getSquadConfig();
  const ado = { azureDevOps, credentials: loadAdoCredentials(), logger };

  const completions = await readDumpCompletion(ado, initial.story.id);
  // Um despejo já concluído com outro fingerprint não bloqueia: a cerimônia nova
  // é o fluxo explícito para publicar uma Spec revisada sobre a anterior.

  const incomplete = await readIncompleteDumps(ado, initial.story.id);
  if (incomplete.some((id) => id !== dumpId)) {
    throw new CeremonyError(
      "a US tem um despejo incompleto de outra cerimônia. Conclua o retry desse despejo antes de publicar outro.",
    );
  }

  const store = getStore();
  store.beginDump(input.sessionId, {
    dumpId,
    markdown: signed,
    tasksMarkdown: input.tasksMarkdown,
    estimate: input.estimate,
  });

  try {
  if (completions.includes(dumpId)) {
    store.markDumpCompleted(input.sessionId, initial.decisions.length);
    publish(input.sessionId);
    return;
  }

  for (const decision of initial.decisions) {
    if (decision.recordId !== undefined && decision.recordUrl !== undefined) continue;
    if (decision.recordId !== undefined || decision.recordUrl !== undefined) {
      throw new CeremonyError(`a decisão ${decision.questionSeq} tem um Registro incompleto no banco local.`);
    }
    const published = await publishDecisionRecord(ado, {
      storyId: initial.story.id,
      dumpId,
      questionSeq: decision.questionSeq,
      question: decision.question,
      answer: decision.answer,
      recommendation: decision.recommendation,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
    });
    if (decision.recordId === undefined && decision.recordUrl === undefined) {
      store.attachDecisionRecord({
        sessionId: input.sessionId,
        questionSeq: decision.questionSeq,
        recordId: published.commentId,
        recordUrl: published.url,
      });
      publish(input.sessionId);
    }
  }

  const dossieWithRecords = getDossie(input.sessionId);
  if (!dossieWithRecords) throw new CeremonyError(`cerimônia ${input.sessionId} não existe.`);
  await publishStorySpec(ado, {
    storyId: dossieWithRecords.story.id,
    dumpId,
    markdown: appendDecisionTraceability(signed, dossieWithRecords.decisions),
    estimate: input.estimate,
  });
  await publishChildTasks(ado, {
    storyId: dossieWithRecords.story.id,
    dumpId,
    tasks,
  });

  await publishDumpCompletion(ado, { storyId: dossieWithRecords.story.id, dumpId });

  store.markDumpCompleted(input.sessionId, initial.decisions.length);
  publish(input.sessionId);
  logger.info(
    {
      sessionId: input.sessionId,
      storyId: dossieWithRecords.story.id,
      decisions: dossieWithRecords.decisions.length,
      tasks: tasks.length,
      estimate: input.estimate,
    },
    "despejo da cerimônia concluído",
  );
  } catch (error) {
    store.abortDump(input.sessionId);
    publish(input.sessionId);
    throw error;
  }
}

function signedDumpInputs(dump: CeremonyDumpState): SignedDumpInputs | undefined {
  switch (dump.status) {
    case "not-started":
      return undefined;
    case "publishing":
    case "retryable":
    case "completed":
      return dump.inputs;
  }
}

function isIncompleteDump(dump: CeremonyDumpState): boolean {
  switch (dump.status) {
    case "publishing":
    case "retryable":
      return true;
    case "not-started":
    case "completed":
      return false;
  }
}

function isCompletedDump(dump: CeremonyDumpState): boolean {
  switch (dump.status) {
    case "completed":
      return true;
    case "not-started":
    case "publishing":
    case "retryable":
      return false;
  }
}

function dumpFingerprint(
  sessionId: string,
  storyId: number,
  markdown: string,
  tasks: readonly ReturnType<typeof parseTaskDraft>[number][],
  estimate: number,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ sessionId, storyId, markdown, tasks, estimate }))
    .digest("hex");
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
