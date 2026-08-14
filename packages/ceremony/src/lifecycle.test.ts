import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { AgentQuestion, AgentRuntime, AgentSession } from "@sprint-griller/agent-runtime";
import type { AdoClientOptions } from "@sprint-griller/ado-client";
import type * as AdoClientModule from "@sprint-griller/ado-client";
import { createLogger } from "@sprint-griller/core";
import type { SquadConfig } from "@sprint-griller/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCeremonyLifecycle } from "./lifecycle";
import type { CreateCeremonyLifecycleOptions } from "./lifecycle";

const readIncompleteDumps = vi.hoisted(() => vi.fn());
const readDumpCompletion = vi.hoisted(() => vi.fn());
const publishDecisionRecord = vi.hoisted(() => vi.fn());
const publishStorySpec = vi.hoisted(() => vi.fn());
const publishChildTasks = vi.hoisted(() => vi.fn());
const publishDumpCompletion = vi.hoisted(() => vi.fn());

vi.mock("@sprint-griller/ado-client", async (importOriginal) => ({
  ...(await importOriginal<typeof AdoClientModule>()),
  readIncompleteDumps,
  readDumpCompletion,
  publishDecisionRecord,
  publishStorySpec,
  publishChildTasks,
  publishDumpCompletion,
}));

const STORY_ID = 42;
const repos: SquadConfig["repos"] = {
  primary: { name: "core-api", path: "/tmp/core-api" },
  related: [],
};

const startInput = {
  story: {
    id: STORY_ID,
    title: "Exportar relatório",
    description: "O gerente precisa baixar o CSV.",
    url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/42",
  },
  investigationMarkdown: "## Furos da US\n\n- Sem regra de arredondamento.",
};

const tasksMarkdown = `## Preparar cálculo

Entrega o cálculo de comissão como um slice executável.

[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/42)

### Critérios de aceite

- O cálculo usa a regra bancária.`;

const directories: string[] = [];
const logLines: string[] = [];
const logger = createLogger({
  destination: new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  }),
  level: "trace",
});

beforeEach(() => {
  logLines.length = 0;
  readIncompleteDumps.mockResolvedValue([]);
  readDumpCompletion.mockResolvedValue([]);
  publishDecisionRecord.mockResolvedValue({ commentId: 1, url: "https://ado/decision/1" });
  publishStorySpec.mockResolvedValue(undefined);
  publishChildTasks.mockResolvedValue(undefined);
  publishDumpCompletion.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function dbPath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "sprint-griller-lifecycle-"));
  directories.push(directory);
  return path.join(directory, "ceremonies.db");
}

function createTestLifecycle(
  options: Omit<CreateCeremonyLifecycleOptions, "logger">,
) {
  return createCeremonyLifecycle({ ...options, logger });
}

function terminalRuntime(close = vi.fn(async () => undefined)): AgentRuntime {
  let sessions = 0;
  return {
    startSession: async () => terminalSession(`thread-${++sessions}`),
    resumeSession: async (sessionId) => terminalSession(sessionId),
    close,
  };
}

function liveQuestionRuntime(): AgentRuntime {
  let sessions = 0;

  return {
    startSession: async () => {
      sessions += 1;
      const id = `thread-${sessions}`;
      return {
        id,
        send() {
          return (async function* () {
            let release: () => void = () => undefined;
            const answered = new Promise<void>((resolve) => { release = resolve; });
            yield {
              type: "question",
              question: {
                questions: [{
                  id: "q1",
                  agendaItemId: "investigacao-1",
                  header: "Arredondamento",
                  question: "A comissão arredonda para cima?",
                  recommendation: "Seguir a regra bancária.",
                  evidence: ["core-api · src/payroll/rounding.ts"],
                  options: [{ label: "Regra bancária", description: "Igual à folha." }],
                  allowFreeText: true,
                }],
                answer: async () => { release(); },
              },
            } as const;
            await answered;
          })();
        },
        interrupt: async () => undefined,
      } satisfies AgentSession;
    },
    resumeSession: async (id) => terminalSession(id),
    close: async () => undefined,
  };
}

function terminalSession(id: string): AgentSession {
  return {
    id,
    send() {
      return (async function* () {
        yield {
          type: "turn-completed",
          turn: { id: "turn-1", status: "completed", durationMs: 1 },
        } as const;
      })();
    },
    interrupt: async () => undefined,
  };
}

function questioningRuntime(): {
  readonly runtime: AgentRuntime;
  readonly answers: readonly Readonly<Record<string, readonly string[]>>[];
  readonly sessionStarts: () => number;
} {
  const answers: Readonly<Record<string, readonly string[]>>[] = [];
  let sessions = 0;
  const question: AgentQuestion = {
    id: "q1",
    agendaItemId: "investigacao-1",
    header: "Arredondamento",
    question: "A comissão arredonda para cima?",
    recommendation: "Seguir a regra bancária.",
    evidence: ["core-api · src/payroll/rounding.ts"],
    options: [{ label: "Regra bancária", description: "Igual à folha." }],
    allowFreeText: true,
  };
  const ceremonySession: AgentSession = {
    id: "thread-1",
    send() {
      return (async function* () {
        let release: () => void = () => undefined;
        const answered = new Promise<void>((resolve) => { release = resolve; });
        yield {
          type: "question",
          question: {
            questions: [question],
            answer: async (next) => {
              answers.push(next);
              release();
            },
          },
        } as const;
        await answered;
      })();
    },
    interrupt: async () => undefined,
  };
  const consultationSession = terminalSession("consulta-1");

  return {
    runtime: {
      startSession: async () => {
        sessions += 1;
        return sessions === 1 ? ceremonySession : consultationSession;
      },
      resumeSession: async (id) => terminalSession(id),
      close: async () => undefined,
    },
    answers,
    sessionStarts: () => sessions,
  };
}

function resumableRuntime(): {
  readonly runtime: AgentRuntime;
  readonly resumed: readonly string[];
} {
  const resumed: string[] = [];
  const idleSession = (id: string): AgentSession => ({
    id,
    send() {
      return (async function* () {})();
    },
    interrupt: async () => undefined,
  });

  return {
    runtime: {
      startSession: async () => idleSession("thread-1"),
      resumeSession: async (id) => {
        resumed.push(id);
        return idleSession(id);
      },
      close: async () => undefined,
    },
    resumed,
  };
}

async function terminalDossie(
  lifecycle: ReturnType<typeof createCeremonyLifecycle>,
): Promise<NonNullable<ReturnType<typeof lifecycle.dossie>>> {
  const session = await lifecycle.start(STORY_ID);
  await vi.waitFor(() => expect(lifecycle.dossie(session.id)?.status).toBe("encerrada"));
  const dossie = lifecycle.dossie(session.id);
  if (!dossie) throw new Error("expected dossie");
  return dossie;
}

function adoOptions(): AdoClientOptions {
  return {
    azureDevOps: { organization: "acme", project: "Plataforma" },
    credentials: { pat: "test-token" },
  };
}

describe("CeremonyLifecycle", () => {
  it("should start an approved Investigation through one lazy runtime", async () => {
    readIncompleteDumps.mockResolvedValue([]);
    const runtimeFactory = vi.fn(async () => terminalRuntime());
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: (storyId) => (storyId === STORY_ID ? startInput : undefined),
      adoOptions,
      runtimeFactory,
    });

    const session = await lifecycle.start(STORY_ID);

    expect({ id: session.id, runtimeStarts: runtimeFactory.mock.calls.length }).toEqual({
      id: "thread-1",
      runtimeStarts: 1,
    });

    await lifecycle.close();
  });

  it("should reject a missing approved Investigation before starting the runtime", async () => {
    readIncompleteDumps.mockResolvedValue([]);
    const runtimeFactory = vi.fn(async () => terminalRuntime());
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => undefined,
      adoOptions,
      runtimeFactory,
    });

    await expect(lifecycle.start(STORY_ID)).rejects.toThrow(
      `A US #${STORY_ID} ainda não tem Investigação aprovada`,
    );
    expect(runtimeFactory).not.toHaveBeenCalled();

    await lifecycle.close();
  });

  it("should keep Palco and Dossiê reads lazy", async () => {
    const runtimeFactory = vi.fn(async () => terminalRuntime());
    const adoOptionsSpy = vi.fn(adoOptions);
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions: adoOptionsSpy,
      runtimeFactory,
    });

    expect({ palco: lifecycle.palco("missing"), dossie: lifecycle.dossie("missing") }).toEqual({
      palco: undefined,
      dossie: undefined,
    });
    expect({ adoCalls: adoOptionsSpy.mock.calls.length, runtimeStarts: runtimeFactory.mock.calls.length })
      .toEqual({ adoCalls: 0, runtimeStarts: 0 });

    await lifecycle.close();
  });

  it("should coalesce concurrent starts for the same User Story", async () => {
    const runtimeFactory = vi.fn(async () => terminalRuntime());
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory,
    });

    const [first, second] = await Promise.all([lifecycle.start(STORY_ID), lifecycle.start(STORY_ID)]);

    expect({ sameSession: first.id === second.id, runtimeStarts: runtimeFactory.mock.calls.length })
      .toEqual({ sameSession: true, runtimeStarts: 1 });

    await lifecycle.close();
  });

  it("should keep distinct concurrent starts live on the same ceremony", async () => {
    let releaseRuntime: (runtime: AgentRuntime) => void = () => undefined;
    const runtimeReady = new Promise<AgentRuntime>((resolve) => { releaseRuntime = resolve; });
    const runtimeFactory = vi.fn(() => runtimeReady);
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: (storyId) => ({
        ...startInput,
        story: { ...startInput.story, id: storyId, title: `US ${storyId}` },
      }),
      adoOptions,
      runtimeFactory,
    });

    const firstStart = lifecycle.start(STORY_ID);
    const secondStart = lifecycle.start(STORY_ID + 1);
    await vi.waitFor(() => expect(runtimeFactory).toHaveBeenCalledTimes(1));
    releaseRuntime(liveQuestionRuntime());
    const [first, second] = await Promise.all([firstStart, secondStart]);

    await vi.waitFor(() =>
      expect({ first: lifecycle.palco(first.id)?.live, second: lifecycle.palco(second.id)?.live })
        .toEqual({ first: true, second: true }),
    );

    await lifecycle.close();
  });

  it("should reject a dump while another ceremony for the story is starting", async () => {
    let releasePreflight: () => void = () => undefined;
    const preflight = new Promise<readonly string[]>((resolve) => { releasePreflight = () => resolve([]); });
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory: async () => terminalRuntime(),
    });
    const previous = await terminalDossie(lifecycle);
    readIncompleteDumps.mockImplementationOnce(() => preflight);

    const starting = lifecycle.start(STORY_ID);
    await vi.waitFor(() => expect(readIncompleteDumps).toHaveBeenCalledTimes(2));
    await expect(lifecycle.dump({
      sessionId: previous.sessionId,
      markdown: previous.spec.generated,
      base: previous.spec.generated,
      tasksMarkdown,
      estimate: 3,
      confirmPending: true,
    })).rejects.toThrow(/já está abrindo outra cerimônia/i);

    releasePreflight();
    await starting;
    await lifecycle.close();
  });

  it("should block a start when a prior dump has reserved the same User Story", async () => {
    let releaseDumpRead: () => void = () => undefined;
    const dumpRead = new Promise<readonly string[]>((resolve) => { releaseDumpRead = () => resolve([]); });
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory: async () => terminalRuntime(),
    });
    const previous = await terminalDossie(lifecycle);
    readDumpCompletion.mockImplementationOnce(() => dumpRead);
    const dumping = lifecycle.dump({
      sessionId: previous.sessionId,
      markdown: previous.spec.generated,
      base: previous.spec.generated,
      tasksMarkdown,
      estimate: 3,
      confirmPending: true,
    });

    await expect(lifecycle.start(STORY_ID)).rejects.toThrow(/despejo incompleto/i);

    releaseDumpRead();
    await dumping;
    await lifecycle.close();
  });

  it("should drain an active dump before closing SQLite", async () => {
    let releaseDumpRead: () => void = () => undefined;
    const dumpRead = new Promise<readonly string[]>((resolve) => {
      releaseDumpRead = () => resolve([]);
    });
    const pathToDb = dbPath();
    const lifecycle = createTestLifecycle({
      dbPath: pathToDb,
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory: async () => terminalRuntime(),
    });
    const previous = await terminalDossie(lifecycle);
    readDumpCompletion.mockImplementationOnce(() => dumpRead);
    const dumping = lifecycle.dump({
      sessionId: previous.sessionId,
      markdown: previous.spec.generated,
      base: previous.spec.generated,
      tasksMarkdown,
      estimate: 3,
      confirmPending: true,
    });

    const closing = lifecycle.close();
    const closeWhileHeld = await Promise.race([
      closing.then(() => "fulfilled" as const, () => "rejected" as const),
      new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
    ]);
    const lateUse = (() => {
      try {
        lifecycle.dossie(previous.sessionId);
        return "accepted";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown error";
      }
    })();

    releaseDumpRead();
    const [dumpResult, closeResult] = await Promise.allSettled([dumping, closing]);

    expect({
      closeWhileHeld,
      closeResult: closeResult.status,
      dumpResult: dumpResult.status,
      lateUse,
      completionWrites: publishDumpCompletion.mock.calls.length,
      sqliteWalOpen: existsSync(`${pathToDb}-wal`),
    }).toEqual({
      closeWhileHeld: "pending",
      closeResult: "fulfilled",
      dumpResult: "fulfilled",
      lateUse: "o ciclo de vida da cerimônia já foi fechado.",
      completionWrites: 1,
      sqliteWalOpen: false,
    });
  });

  it("should retry runtime startup after a failed initialization", async () => {
    const runtimeFactory = vi
      .fn<() => Promise<AgentRuntime>>()
      .mockRejectedValueOnce(new Error("app-server indisponível"))
      .mockResolvedValueOnce(terminalRuntime());
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory,
    });

    await expect(lifecycle.start(STORY_ID)).rejects.toThrow("app-server indisponível");
    const session = await lifecycle.start(STORY_ID);

    expect({
      id: session.id,
      attempts: runtimeFactory.mock.calls.length,
      structuredErrors: logLines.filter((line) =>
        line.includes('"level":"error"') &&
        line.includes('"msg":"falha ao subir a cerimônia"')
      ).length,
    }).toEqual({
      id: "thread-1",
      attempts: 2,
      structuredErrors: 1,
    });

    await lifecycle.close();
  });

  it("should delegate decisions and Consultas to the live ceremony", async () => {
    const fake = questioningRuntime();
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory: async () => fake.runtime,
    });
    const session = await lifecycle.start(STORY_ID);
    await vi.waitFor(() => expect(lifecycle.palco(session.id)?.current.phase).toBe("perguntando"));

    const decision = await lifecycle.decide({
      sessionId: session.id,
      questionId: "q1",
      answer: "Regra bancária",
    });
    const consultation = await lifecycle.consult({
      sessionId: session.id,
      question: "Onde a regra atual é aplicada?",
    });

    expect({
      decision: decision.answer,
      answers: fake.answers,
      consultation: consultation.status,
      runtimeSessions: fake.sessionStarts(),
    }).toEqual({
      decision: "Regra bancária",
      answers: [{ q1: ["Regra bancária"] }],
      consultation: "buscando",
      runtimeSessions: 2,
    });

    await vi.waitFor(() =>
      expect(lifecycle.palco(session.id)?.consultation?.status).not.toBe("buscando"),
    );
    await lifecycle.close();
  });

  it("should delegate a resumable ceremony without starting a second runtime", async () => {
    const fake = resumableRuntime();
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory: async () => fake.runtime,
    });
    const session = await lifecycle.start(STORY_ID);
    await vi.waitFor(() => expect(lifecycle.palco(session.id)?.current.phase).toBe("retomavel"));

    await lifecycle.resume(session.id);

    expect(fake.resumed).toEqual([session.id]);
    await lifecycle.close();
  });

  it("should notify healthy subscribers when a draft changes despite a broken subscriber", async () => {
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory: async () => terminalRuntime(),
    });
    const dossie = await terminalDossie(lifecycle);
    const broken = vi.fn(() => { throw new Error("SSE caiu"); });
    const healthy = vi.fn();
    lifecycle.subscribePalco(dossie.sessionId, broken);
    lifecycle.subscribePalco(dossie.sessionId, healthy);

    const draft = lifecycle.saveSpecDraft({
      sessionId: dossie.sessionId,
      markdown: dossie.spec.generated,
      base: dossie.spec.generated,
      expectedSavedAt: null,
    });
    lifecycle.discardSpecDraft({ sessionId: dossie.sessionId, expectedSavedAt: draft.savedAt });

    const subscriberWarnings = logLines.filter((line) =>
      line.includes('"msg":"assinante da cerimônia quebrou ao receber estado"')
    );
    expect({
      brokenCalls: broken.mock.calls.length,
      healthyCalls: healthy.mock.calls.length,
      structuredWarnings: subscriberWarnings.filter((line) =>
        line.includes(`"sessionId":"${dossie.sessionId}"`)
      ).length,
    }).toEqual({ brokenCalls: 2, healthyCalls: 2, structuredWarnings: 2 });

    await lifecycle.close();
  });

  it("should close opened resources once and reject later use", async () => {
    const close = vi.fn(async () => undefined);
    const lifecycle = createTestLifecycle({
      dbPath: dbPath(),
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory: async () => terminalRuntime(close),
    });
    await lifecycle.start(STORY_ID);

    await Promise.all([lifecycle.close(), lifecycle.close()]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(() => lifecycle.findOpen(STORY_ID)).toThrow(/já foi fechado/i);
  });

  it("should close SQLite after a runtime startup failure", async () => {
    let rejectRuntime: (error: Error) => void = () => undefined;
    const runtimeStarting = new Promise<AgentRuntime>((_resolve, reject) => {
      rejectRuntime = (error) => reject(error);
    });
    const pathToDb = dbPath();
    const runtimeFactory = vi.fn(() => runtimeStarting);
    const lifecycle = createTestLifecycle({
      dbPath: pathToDb,
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory,
    });
    lifecycle.dossie("missing");
    expect(existsSync(`${pathToDb}-wal`)).toBe(true);

    const starting = lifecycle.start(STORY_ID);
    await vi.waitFor(() => expect(runtimeFactory).toHaveBeenCalledTimes(1));
    const firstClose = lifecycle.close();
    const secondClose = lifecycle.close();
    rejectRuntime(new Error("app-server indisponível"));

    await expect(starting).rejects.toThrow("app-server indisponível");
    await expect(firstClose).rejects.toThrow("app-server indisponível");
    await expect(secondClose).rejects.toThrow("app-server indisponível");
    expect(existsSync(`${pathToDb}-wal`)).toBe(false);
    expect(() => lifecycle.dossie("missing")).toThrow(/já foi fechado/i);
  });

  it("should aggregate dump and runtime failures while still closing SQLite", async () => {
    let rejectDumpRead: (error: Error) => void = () => undefined;
    const dumpRead = new Promise<readonly string[]>((_resolve, reject) => {
      rejectDumpRead = (error) => reject(error);
    });
    const pathToDb = dbPath();
    const closeRuntime = vi.fn(async () => {
      throw new Error("runtime não encerrou");
    });
    const lifecycle = createTestLifecycle({
      dbPath: pathToDb,
      repos,
      resolveStartInput: () => startInput,
      adoOptions,
      runtimeFactory: async () => terminalRuntime(closeRuntime),
    });
    const previous = await terminalDossie(lifecycle);
    readDumpCompletion.mockImplementationOnce(() => dumpRead);
    const dumping = lifecycle.dump({
      sessionId: previous.sessionId,
      markdown: previous.spec.generated,
      base: previous.spec.generated,
      tasksMarkdown,
      estimate: 3,
      confirmPending: true,
    });
    const closing = lifecycle.close();

    rejectDumpRead(new Error("ADO indisponível"));
    const [dumpResult, closeResult] = await Promise.allSettled([dumping, closing]);
    const aggregate = closeResult.status === "rejected" && closeResult.reason instanceof AggregateError
      ? closeResult.reason
      : undefined;

    expect({
      aggregateErrors: aggregate?.errors.flatMap((error: unknown) =>
        error instanceof Error ? [error.message] : []
      ),
      closeResult: closeResult.status,
      dumpResult: dumpResult.status,
      runtimeCloseCalls: closeRuntime.mock.calls.length,
      sqliteWalOpen: existsSync(`${pathToDb}-wal`),
    }).toEqual({
      aggregateErrors: ["ADO indisponível", "runtime não encerrou"],
      closeResult: "rejected",
      dumpResult: "rejected",
      runtimeCloseCalls: 1,
      sqliteWalOpen: false,
    });
  });
});
