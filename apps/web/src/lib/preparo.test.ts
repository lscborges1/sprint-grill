import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BacklogStory } from "@sprint-griller/ado-client";
import type { SquadConfig } from "@sprint-griller/core";
import { Writable } from "node:stream";
import { createLogger, type Logger } from "@sprint-griller/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchBacklog = vi.hoisted(() => vi.fn());
const loadAdoCredentials = vi.hoisted(() => vi.fn(() => ({})));
const getRunExecutor = vi.hoisted(() => vi.fn());
const selectPreparoBatch = vi.hoisted(() =>
  vi.fn<typeof import("@sprint-griller/investigation/runs").selectPreparoBatch>(),
);

vi.mock("@sprint-griller/ado-client", () => ({ fetchBacklog }));
vi.mock("@sprint-griller/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/core")>()),
  loadAdoCredentials,
}));
vi.mock("@sprint-griller/investigation/runs", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@sprint-griller/investigation/runs")
  >()),
  selectPreparoBatch,
}));
vi.mock("./investigations", () => ({ getRunExecutor }));
vi.mock("./logger", () => ({
  logger: createLogger({
    destination: new Writable({ write(_c, _e, done) { done(); } }),
    level: "fatal",
  }),
}));
vi.mock("./squad-config", () => ({
  getSquadConfig: () => SQUAD_CONFIG,
}));

const SQUAD_CONFIG = {
  azureDevOps: { organization: "acme", project: "Plataforma" },
  repos: { primary: { name: "core-api", path: "/dev/core-api" }, related: [] },
} satisfies SquadConfig;

const { runPreparoCycle } = await import("./preparo");

const SILENT: Logger = createLogger({
  destination: new Writable({ write(_c, _e, done) { done(); } }),
  level: "fatal",
});

const PREPARO = {
  enabled: true,
  intervalMinutes: 30,
  limit: 5,
  states: ["New"],
};

function story(id: number, rev: number, state = "New"): BacklogStory {
  return {
    id,
    title: `US ${id}`,
    type: "User Story",
    state,
    rev,
    assignedTo: undefined,
    url: `https://example.com/${id}`,
    refinement: "sem-investigacao",
  };
}

describe("runPreparoCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPRINT_GRILLER_INVESTIGATIONS_DB = path.join(
      mkdtempSync(path.join(tmpdir(), "refina-preparo-")),
      "investigacoes.db",
    );
    delete (globalThis as { __sprintGrillerRunExecutor?: unknown }).__sprintGrillerRunExecutor;
  });

  it("should scan the backlog, enqueue the selected batch, and drain the queue", async () => {
    const executor = fakeExecutor();
    getRunExecutor.mockReturnValue(executor);
    const backlog = [story(1, 3), story(2, 4)];
    fetchBacklog.mockResolvedValue(backlog);
    selectPreparoBatch.mockReturnValue(backlog);

    await runPreparoCycle(SQUAD_CONFIG, PREPARO, { logger: SILENT });

    expect(fetchBacklog).toHaveBeenCalledOnce();
    expect(executor.enqueue).toHaveBeenCalledWith(1, 3);
    expect(executor.enqueue).toHaveBeenCalledWith(2, 4);
    expect(executor.claimNext).toHaveBeenCalledOnce();
  });

  it("should not start a second cycle while one is running", async () => {
    const executor = fakeExecutor();
    getRunExecutor.mockReturnValue(executor);
    fetchBacklog.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 20)),
    );
    selectPreparoBatch.mockReturnValue([]);

    const first = runPreparoCycle(SQUAD_CONFIG, PREPARO, { logger: SILENT });
    const second = runPreparoCycle(SQUAD_CONFIG, PREPARO, { logger: SILENT });
    await Promise.all([first, second]);

    expect(fetchBacklog).toHaveBeenCalledOnce();
  });

  it("should swallow cycle errors — o próximo tick tenta de novo", async () => {
    const executor = fakeExecutor();
    getRunExecutor.mockReturnValue(executor);
    fetchBacklog.mockRejectedValue(new Error("ADO fora do ar"));

    await expect(
      runPreparoCycle(SQUAD_CONFIG, PREPARO, { logger: SILENT }),
    ).rejects.toThrow("ADO fora do ar");
    expect(executor.enqueue).not.toHaveBeenCalled();
  });
});

function fakeExecutor() {
  return {
    summaries: () => new Map(),
    enqueue: vi.fn(),
    claimNext: vi.fn(() => undefined),
    get: vi.fn(() => undefined),
    start: vi.fn(),
  };
}
