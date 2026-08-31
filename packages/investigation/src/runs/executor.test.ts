import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StoryDetails } from "@sprint-griller/ado-client";
import { Writable } from "node:stream";
import { createLogger, type Logger, type SquadConfig } from "@sprint-griller/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openInvestigationsStore } from "./store";
import { RunExecutor } from "./executor";
import type { InvestigationOutcome } from "../investigate";

const SILENT: Logger = createLogger({
  destination: new Writable({ write(_c, _e, done) { done(); } }),
  level: "fatal",
});

const REPOS: SquadConfig["repos"] = {
  primary: { name: "core-api", path: "/dev/core-api" },
  related: [],
};

const STORY: StoryDetails = {
  id: 0,
  title: "TTL de sessão configurável",
  type: "User Story",
  state: "New",
  rev: 3,
  description: "O TTL hoje é fixo.",
  url: "https://example.com/0",
  wikiContext: { references: [], omitted: [], attempts: 0, contentCharacters: 0 },
};

const APPROVED: InvestigationOutcome = {
  status: "aprovado",
  report: {
    summary: "resumo",
    gaps: [],
    impacts: [],
    externalRepos: [],
    unverified: [],
  },
  markdown: "# Investigação\n",
};

let dbPath: string;
let now: number;

beforeEach(() => {
  dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), "refina-runs-executor-")),
    "investigacoes.db",
  );
  now = 1_000;
});

function storyFor(storyId: number): StoryDetails {
  return { ...STORY, id: storyId, url: `https://example.com/${storyId}` };
}

interface Harness {
  readonly executor: RunExecutor;
  readonly fetchStory: ReturnType<typeof vi.fn>;
  readonly runInvestigation: ReturnType<typeof vi.fn>;
}

/**
 * Executor de mentira: `runInvestigation` retorna uma deferred por US — o teste
 * decide quando cada turno termina e o que ele entrega.
 */
function harness(): Harness & { readonly turns: Map<number, { resolve: (o: InvestigationOutcome) => void }> } {
  const turns = new Map<number, { resolve: (o: InvestigationOutcome) => void }>();
  const fetchStory = vi.fn(async (_o: unknown, storyId: number) => storyFor(storyId));
  const runInvestigation = vi.fn(
    (input: { readonly story: StoryDetails }) =>
      new Promise<InvestigationOutcome>((resolve) => {
        turns.set(input.story.id, { resolve });
      }),
  );

  const executor = new RunExecutor(
    openInvestigationsStore(dbPath, { logger: SILENT }),
    REPOS,
    {
      adoOptions: () => ({}) as never,
      fetchStory: fetchStory as never,
      runtimeFactory: async () => ({
        runInvestigation,
        close: async () => undefined,
      }),
    },
    SILENT,
    () => now++,
  );

  return { executor, fetchStory, runInvestigation, turns };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("RunExecutor.start (manual)", () => {
  it("should return before the turn finishes and keep the report afterwards", async () => {
    const { executor, runInvestigation, turns } = harness();

    const run = executor.start(42);
    expect(run.status).toBe("em-andamento");

    await flush();
    turns.get(42)!.resolve(APPROVED);
    await flush();

    const done = executor.get(42);
    expect(done?.status).toBe("aprovado");
    expect(runInvestigation).toHaveBeenCalledTimes(1);
  });

  it("should not start a second turn for the same US while one is running", async () => {
    const { executor, runInvestigation, turns } = harness();

    executor.start(42);
    executor.start(42);
    await flush();

    expect(runInvestigation).toHaveBeenCalledTimes(1);
    turns.get(42)!.resolve(APPROVED);
    await flush();
  });

  it("should isolate failures: a dead US does not stop the queue or the next manual run", async () => {
    const { executor, turns } = harness();

    executor.start(1);
    await flush();
    turns.get(1)!.resolve({ status: "falhou", message: "ADO fora do ar" });
    await flush();

    executor.start(2);
    await flush();
    turns.get(2)!.resolve(APPROVED);
    await flush();

    expect(executor.get(1)?.status).toBe("falhou");
    expect(executor.get(2)?.status).toBe("aprovado");
  });
});

describe("RunExecutor queue (preparo)", () => {
  it("should run one queued story at a time, FIFO", async () => {
    const { executor, turns } = harness();

    executor.enqueue(1, 3);
    executor.enqueue(2, 3);

    const first = executor.claimNext();
    expect(first?.storyId).toBe(1);
    expect(executor.claimNext()).toBeUndefined(); // concorrência 1

    await flush();
    turns.get(1)!.resolve(APPROVED);
    await flush();

    // O drain pega a próxima automaticamente quando o turno termina.
    expect(executor.get(2)?.status).toBe("em-andamento");
    turns.get(2)!.resolve(APPROVED);
    await flush();

    expect(executor.get(1)?.status).toBe("aprovado");
    expect(executor.get(2)?.status).toBe("aprovado");
  });

  it("should keep processing the queue when one queued story fails", async () => {
    const { executor, turns } = harness();

    executor.enqueue(1, 3);
    executor.enqueue(2, 3);
    executor.claimNext();
    await flush();

    turns.get(1)!.resolve({ status: "falhou", message: "agente morreu" });
    await flush();

    expect(executor.get(1)?.status).toBe("falhou");
    expect(executor.get(2)?.status).toBe("em-andamento");
    turns.get(2)!.resolve(APPROVED);
    await flush();
    expect(executor.get(2)?.status).toBe("aprovado");
  });

  it("should promote a queued story when the operator clicks it", async () => {
    const { executor, turns } = harness();

    executor.enqueue(1, 3);
    executor.start(1); // o Operador não espera a fila
    await flush();

    expect(executor.get(1)?.status).toBe("em-andamento");
    turns.get(1)!.resolve(APPROVED);
    await flush();
    expect(executor.get(1)?.status).toBe("aprovado");
  });
});

describe("RunExecutor restart recovery", () => {
  it("should recover an interrupted queue: queued survives, in-flight becomes a failure", async () => {
    const first = harness();

    first.executor.enqueue(1, 3);
    first.executor.enqueue(2, 3);
    first.executor.claimNext();
    await flush();
    // processo morre aqui — sem resolver o turno

    const second = harness();
    expect(second.executor.get(1)?.status).toBe("falhou");
    expect(second.executor.get(2)?.status).toBe("aguardando");

    // a fila retoma do ponto onde parou
    const resumed = second.executor.claimNext();
    expect(resumed?.storyId).toBe(2);
    await flush();
    second.turns.get(2)!.resolve(APPROVED);
    await flush();
    expect(second.executor.get(2)?.status).toBe("aprovado");
  });
});
