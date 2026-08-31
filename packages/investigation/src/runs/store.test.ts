import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StoryDetails } from "@sprint-griller/ado-client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  InvestigationsDbError,
  ORPHANED_RUN_MESSAGE,
  openInvestigationsStore,
} from "./store";
import type { InvestigationRun } from "./types";

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), "refina-runs-store-")),
    "investigacoes.db",
  );
});

const STORY: StoryDetails = {
  id: 42,
  title: "TTL de sessão configurável",
  type: "User Story",
  state: "New",
  rev: 3,
  description: "O TTL hoje é fixo.",
  url: "https://example.com/42",
  wikiContext: { references: [], omitted: [], attempts: 0, contentCharacters: 0 },
};

function queuedRun(storyId: number, queuedRev = 3): InvestigationRun {
  return {
    storyId,
    origin: "automatico",
    story: undefined,
    startedAt: 1_000,
    previous: undefined,
    publication: undefined,
    status: "aguardando",
    queuedRev,
  };
}

describe("openInvestigationsStore", () => {
  it("should keep a queued run across a reopen — a fila sobrevive ao restart", () => {
    const store = openInvestigationsStore(dbPath);
    store.replace(queuedRun(42));
    store.close();

    const reopened = openInvestigationsStore(dbPath);
    const run = reopened.get(42);

    expect(run?.status).toBe("aguardando");
    if (run?.status !== "aguardando") throw new Error("unreachable");
    expect(run.queuedRev).toBe(3);
    reopened.close();
  });

  it("should keep a finished report with publication across a reopen — o preview sobrevive ao restart", () => {
    const store = openInvestigationsStore(dbPath);
    store.replace({
      storyId: 42,
      origin: "operador",
      story: STORY,
      startedAt: 1_000,
      previous: undefined,
      publication: undefined,
      status: "aprovado",
      finishedAt: 2_000,
      report: {
        summary: "resumo",
        gaps: [],
        impacts: [],
        externalRepos: [],
        unverified: [],
      },
      markdown: "# Investigação — US #42\n",
    });
    store.close();

    const reopened = openInvestigationsStore(dbPath);
    const run = reopened.get(42);

    expect(run?.status).toBe("aprovado");
    if (run?.status !== "aprovado") throw new Error("unreachable");
    expect(run.story).toEqual(STORY);
    expect(run.markdown).toBe("# Investigação — US #42\n");
    reopened.close();
  });

  it("should mark an in-flight run as failed on reopen — turno morto não fica 'rodando'", () => {
    const store = openInvestigationsStore(dbPath);
    store.replace({
      storyId: 42,
      origin: "operador",
      story: STORY,
      startedAt: 1_000,
      previous: undefined,
      publication: undefined,
      status: "em-andamento",
    });
    store.close();

    const reopened = openInvestigationsStore(dbPath);
    const run = reopened.get(42);

    expect(run?.status).toBe("falhou");
    if (run?.status !== "falhou") throw new Error("unreachable");
    expect(run.message).toBe(ORPHANED_RUN_MESSAGE);
    reopened.close();
  });

  it("should preserve `previous` chains and publications through a reopen", () => {
    const previous = {
      storyId: 42,
      origin: "operador" as const,
      story: STORY,
      startedAt: 500,
      finishedAt: 600,
      previous: undefined,
      publication: {
        status: "publicada" as const,
        commentId: 77,
        url: "https://example.com/42#comment",
      },
      status: "aprovado" as const,
      report: {
        summary: "resumo antigo",
        gaps: [],
        impacts: [],
        externalRepos: [],
        unverified: [],
      },
      markdown: "# antigo",
    };

    const store = openInvestigationsStore(dbPath);
    store.replace(queuedRun(42, 3));
    store.replace({
      ...queuedRun(42, 3),
      previous,
    });
    store.close();

    const reopened = openInvestigationsStore(dbPath);
    const run = reopened.get(42);

    expect(run?.previous?.publication?.status).toBe("publicada");
    reopened.close();
  });

  it("should hand out the oldest queued run first — fila é FIFO", () => {
    const store = openInvestigationsStore(dbPath);
    store.replace(queuedRun(2, 1));
    store.replace(queuedRun(1, 1));

    expect(store.oldestAguardando()?.storyId).toBe(1);
    store.close();
  });

  it("should refuse a database from an incompatible schema version instead of migrating", async () => {
    const store = openInvestigationsStore(dbPath);
    store.close();

    const { default: Database } = await import("better-sqlite3");
    const sqlite = new Database(dbPath);
    sqlite.pragma("user_version = 99");
    sqlite.close();

    expect(() => openInvestigationsStore(dbPath)).toThrow(
      InvestigationsDbError,
    );
  });
});
