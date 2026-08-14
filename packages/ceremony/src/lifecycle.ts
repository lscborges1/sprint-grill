import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import type { AgentRuntime } from "@sprint-griller/agent-runtime";
import type { AdoClientOptions } from "@sprint-griller/ado-client";
import { createLogger } from "@sprint-griller/core";
import type { Logger, SquadConfig } from "@sprint-griller/core";
import { createCeremony } from "./ceremony";
import type { Ceremony, ConsultInput, StartCeremonyInput } from "./ceremony";
import { CeremonyError } from "./ceremony-error";
import { createCeremonyDump } from "./despejo";
import type { CeremonyDump, CeremonyDumpInput } from "./despejo";
import { readDossie } from "./dossie";
import { readPalco } from "./palco";
import { openCeremonyStore } from "./store";
import type {
  CeremonyStore,
  DiscardSpecDraftInput,
  RecordDecisionInput,
  SaveSpecDraftInput,
} from "./store";
import type {
  CeremonyConsultation,
  CeremonyDecision,
  CeremonySession,
  DossieState,
  PalcoState,
  SpecDraft,
} from "./types";

export interface CreateCeremonyLifecycleOptions {
  readonly dbPath: string;
  readonly repos: SquadConfig["repos"];
  /** A Investigação aprovada que alimenta a cerimônia, se ela existir. */
  readonly resolveStartInput: (storyId: number) => StartCeremonyInput | undefined;
  /** Só é avaliado pelo preflight e pelo despejo, nunca por leituras locais. */
  readonly adoOptions: () => AdoClientOptions;
  /** Seam de infraestrutura: o runtime real nasce somente no primeiro comando vivo. */
  readonly runtimeFactory?: () => Promise<AgentRuntime>;
  readonly logger?: Logger;
}

type PalcoSubscriber = (state: PalcoState) => void;
type DossieSubscriber = (state: DossieState) => void;

export interface CeremonyLifecycle {
  start(storyId: number): Promise<CeremonySession>;
  findOpen(storyId: number): CeremonySession | undefined;
  palco(sessionId: string): PalcoState | undefined;
  dossie(sessionId: string): DossieState | undefined;
  decide(input: RecordDecisionInput): Promise<CeremonyDecision>;
  consult(input: ConsultInput): Promise<CeremonyConsultation>;
  resume(sessionId: string): Promise<void>;
  saveSpecDraft(input: SaveSpecDraftInput): SpecDraft;
  discardSpecDraft(input: DiscardSpecDraftInput): void;
  dump(input: CeremonyDumpInput): Promise<void>;
  subscribePalco(sessionId: string, subscriber: PalcoSubscriber): () => void;
  subscribeDossie(sessionId: string, subscriber: DossieSubscriber): () => void;
  close(): Promise<void>;
}

/**
 * Fronteira profunda do ciclo de vida da cerimônia. A UI só traz entradas
 * validadas; SQLite, runtime e publicação ficam aqui para não virar estado de
 * módulo no adaptador Next.
 */
export function createCeremonyLifecycle(
  options: CreateCeremonyLifecycleOptions,
): CeremonyLifecycle {
  const logger = options.logger ?? createLogger({ name: "ceremony-lifecycle" });
  const startingByStory = new Map<number, Promise<CeremonySession>>();
  const activeDumps = new Set<Promise<void>>();
  const palcoSubscribers = new Map<string, Set<PalcoSubscriber>>();
  const dossieSubscribers = new Map<string, Set<DossieSubscriber>>();

  let store: CeremonyStore | undefined;
  let runtime: AgentRuntime | undefined;
  let startingRuntime: Promise<AgentRuntime> | undefined;
  let ceremony: Ceremony | undefined;
  let startingCeremony: Promise<Ceremony> | undefined;
  let dump: CeremonyDump | undefined;
  let closing: Promise<void> | undefined;
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new CeremonyError("o ciclo de vida da cerimônia já foi fechado.");
  }

  function getStore(): CeremonyStore {
    assertOpen();
    store ??= openCeremonyStore(options.dbPath, { logger });
    return store;
  }

  function notify(sessionId: string): void {
    if (closed) return;
    notifySubscribers(sessionId, palcoSubscribers.get(sessionId), () => {
      const state = lifecycle.palco(sessionId);
      if (state) return state;
      return undefined;
    });
    notifySubscribers(sessionId, dossieSubscribers.get(sessionId), () => {
      const state = lifecycle.dossie(sessionId);
      if (state) return state;
      return undefined;
    });
  }

  function notifySubscribers<T>(
    sessionId: string,
    subscribers: Set<(state: T) => void> | undefined,
    state: () => T | undefined,
  ): void {
    if (!subscribers) return;
    const next = state();
    if (!next) return;

    for (const subscriber of subscribers) {
      try {
        subscriber(next);
      } catch (error) {
        logger.warn({ err: error, sessionId }, "assinante da cerimônia quebrou ao receber estado");
      }
    }
  }

  function getDump(): CeremonyDump {
    assertOpen();
    dump ??= createCeremonyDump({
      store: getStore(),
      adoOptions: options.adoOptions,
      logger,
      onChange: notify,
    });
    return dump;
  }

  async function getRuntime(): Promise<AgentRuntime> {
    assertOpen();
    if (runtime) return runtime;

    startingRuntime ??= (options.runtimeFactory ?? (() =>
      createAgentRuntime({ cwd: options.repos.primary.path, logger })))();
    try {
      runtime = await startingRuntime;
      assertOpen();
      return runtime;
    } catch (error) {
      startingRuntime = undefined;
      logger.error({ err: error }, "falha ao subir a cerimônia");
      throw error;
    }
  }

  async function getCeremony(): Promise<Ceremony> {
    assertOpen();
    if (ceremony) return ceremony;

    startingCeremony ??= (async (): Promise<Ceremony> => {
      const next = createCeremony({
        runtime: await getRuntime(),
        store: getStore(),
        repos: options.repos,
        logger,
        onChange: notify,
      });
      ceremony = next;
      return next;
    })().finally(() => {
      startingCeremony = undefined;
    });
    return startingCeremony;
  }

  function subscribe<T>(
    subscribersBySession: Map<string, Set<(state: T) => void>>,
    sessionId: string,
    subscriber: (state: T) => void,
  ): () => void {
    assertOpen();
    const subscribers = subscribersBySession.get(sessionId) ?? new Set<(state: T) => void>();
    subscribers.add(subscriber);
    subscribersBySession.set(sessionId, subscribers);

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) subscribersBySession.delete(sessionId);
    };
  }

  function trackDump(publication: Promise<void>): Promise<void> {
    activeDumps.add(publication);
    void publication.then(
      () => activeDumps.delete(publication),
      () => activeDumps.delete(publication),
    );
    return publication;
  }

  function errorFrom(failure: unknown, stage: string): Error {
    return failure instanceof Error
      ? failure
      : new Error(`falha ao encerrar ${stage}.`, { cause: failure });
  }

  const lifecycle: CeremonyLifecycle = {
    async start(storyId) {
      assertOpen();
      const inFlight = startingByStory.get(storyId);
      if (inFlight) return inFlight;

      const open = getStore().findOpenSessionByStory(storyId);
      if (open) return open;

      const starting = (async (): Promise<CeremonySession> => {
        const input = options.resolveStartInput(storyId);
        await getDump().assertCanStartCeremony({
          storyId,
          investigationApproved: input !== undefined,
        });
        if (!input) {
          throw new Error("assertCanStartCeremony aceitou uma Investigação não aprovada.");
        }

        const activeCeremony = await getCeremony();
        const raced = getStore().findOpenSessionByStory(storyId);
        if (raced) return raced;

        return activeCeremony.start(input);
      })().finally(() => {
        startingByStory.delete(storyId);
      });

      startingByStory.set(storyId, starting);
      return starting;
    },

    findOpen(storyId) {
      return getStore().findOpenSessionByStory(storyId);
    },

    palco(sessionId) {
      assertOpen();
      return ceremony?.palco(sessionId) ?? readPalco(getStore(), sessionId, false);
    },

    dossie(sessionId) {
      return readDossie(getStore(), sessionId);
    },

    async decide(input) {
      return (await getCeremony()).decide(input);
    },

    async consult(input) {
      return (await getCeremony()).consult(input);
    },

    async resume(sessionId) {
      await (await getCeremony()).resume(sessionId);
    },

    saveSpecDraft(input) {
      const draft = getStore().saveSpecDraft(input);
      notify(input.sessionId);
      return draft;
    },

    discardSpecDraft(input) {
      getStore().discardSpecDraft(input);
      notify(input.sessionId);
    },

    dump(input) {
      assertOpen();
      const initial = lifecycle.dossie(input.sessionId);
      if (!initial) {
        return Promise.reject(new CeremonyError(`cerimônia ${input.sessionId} não existe.`));
      }
      if (startingByStory.has(initial.story.id)) {
        return Promise.reject(new CeremonyError(
          `a US #${initial.story.id} já está abrindo outra cerimônia. Aguarde antes de despejar.`,
        ));
      }
      return trackDump(getDump().publish(input));
    },

    subscribePalco(sessionId, subscriber) {
      return subscribe(palcoSubscribers, sessionId, subscriber);
    },

    subscribeDossie(sessionId, subscriber) {
      return subscribe(dossieSubscribers, sessionId, subscriber);
    },

    close() {
      closing ??= (async () => {
        closed = true;
        palcoSubscribers.clear();
        dossieSubscribers.clear();
        const failures: Error[] = [];
        const runtimeStartup = startingRuntime;

        const dumpResults = await Promise.allSettled([...activeDumps]);
        for (const result of dumpResults) {
          if (result.status === "rejected") {
            failures.push(errorFrom(result.reason, "um despejo em andamento"));
          }
        }

        let activeRuntime = runtime;
        if (!activeRuntime && runtimeStartup) {
          try {
            activeRuntime = await runtimeStartup;
          } catch (error) {
            failures.push(errorFrom(error, "a inicialização do runtime"));
          }
        }
        try {
          if (activeRuntime) await activeRuntime.close();
        } catch (error) {
          failures.push(errorFrom(error, "o runtime"));
        }
        try {
          store?.close();
        } catch (error) {
          failures.push(errorFrom(error, "o SQLite"));
        }

        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, "múltiplas falhas ao encerrar a cerimônia.");
        }
      })();
      return closing;
    },
  };

  return lifecycle;
}
