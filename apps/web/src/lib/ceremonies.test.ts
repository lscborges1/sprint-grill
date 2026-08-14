import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type {
  CeremonyLifecycle,
  CeremonySession,
  CreateCeremonyLifecycleOptions,
} from "@sprint-griller/ceremony";
import { createLogger } from "@sprint-griller/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCeremonyLifecycle = vi.hoisted(() => vi.fn());
const lifecycleSpies = vi.hoisted(() => ({
  start: vi.fn(),
  findOpen: vi.fn(),
  palco: vi.fn(),
  dossie: vi.fn(),
  decide: vi.fn(),
  consult: vi.fn(),
  resume: vi.fn(),
  saveSpecDraft: vi.fn(),
  discardSpecDraft: vi.fn(),
  dump: vi.fn(),
  subscribePalco: vi.fn(),
  subscribeDossie: vi.fn(),
  close: vi.fn(),
}));
const lifecycle = lifecycleSpies as CeremonyLifecycle;
const getInvestigation = vi.hoisted(() => vi.fn());

vi.mock("@sprint-griller/ceremony", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/ceremony")>()),
  createCeremonyLifecycle,
}));
vi.mock("./investigations", () => ({ getInvestigation }));
vi.mock("./squad-config", () => ({
  getSquadConfig: () => ({
    azureDevOps: { organization: "acme", project: "Plataforma" },
    repos: { primary: { name: "core-api", path: "/dev/core-api" }, related: [] },
  }),
}));
vi.mock("./logger", () => ({
  logger: createLogger({
    destination: new Writable({ write(_chunk, _encoding, done) { done(); } }),
    level: "fatal",
  }),
}));

createCeremonyLifecycle.mockReturnValue(lifecycle);

vi.stubEnv(
  "SPRINT_GRILLER_DB",
  path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-web-")), "cerimonias.db"),
);

const {
  decisionSchema,
  dumpCeremonySchema,
  sessionIdSchema,
  specDraftSchema,
  startCeremony,
} = await import("./ceremonies");

const startedSession: CeremonySession = {
  id: "session-1",
  storyId: 117,
  storyTitle: "Exportar relatório",
  storyUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/117",
  investigationMarkdown: "## Furos da US",
  timeZone: "America/Sao_Paulo",
  createdAt: 1,
  status: "ativa",
  failureMessage: null,
  dump: { status: "not-started" },
};

beforeEach(() => {
  lifecycleSpies.start.mockReset().mockResolvedValue(startedSession);
  getInvestigation.mockImplementation((storyId: number) => ({
    story: {
      id: storyId,
      title: "Exportar relatório",
      description: "O gerente precisa baixar o CSV.",
      url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${storyId}`,
    },
    status: "aprovado",
    markdown: "## Furos da US\n\n- Sem regra de arredondamento.",
  }));
});

describe("ceremony input parsing", () => {
  it("should parse a session identifier", () => {
    expect(sessionIdSchema.parse("session-1")).toBe("session-1");
  });

  it("should trim decision authors and answers", () => {
    expect(decisionSchema.parse({
      sessionId: "session-1",
      questionId: "q1",
      answer: "  Sim  ",
      decidedBy: "  PO  ",
    })).toMatchObject({ answer: "Sim", decidedBy: "PO" });
  });

  it("should coerce the Spec draft concurrency fields", () => {
    expect(specDraftSchema.parse({
      sessionId: "session-1",
      markdown: "# Spec",
      base: "# Base",
      expectedSavedAt: "",
      overwrite: "true",
    })).toMatchObject({ expectedSavedAt: null, overwrite: true });
  });

  it("should coerce the dump estimate while preserving pending confirmation", () => {
    expect(dumpCeremonySchema.parse({
      sessionId: "session-1",
      markdown: "# Spec",
      base: "# Base",
      tasksMarkdown: "## Task",
      estimate: "5",
      confirmPending: true,
    })).toMatchObject({
      estimate: 5,
      confirmPending: true,
    });
  });
});

describe("ceremony lifecycle wiring", () => {
  it("should delegate an approved Investigation to the HMR-safe lifecycle", async () => {
    const session = await startCeremony(117);
    const options = createCeremonyLifecycle.mock.calls[0]?.[0] as
      | CreateCeremonyLifecycleOptions
      | undefined;
    if (!options) throw new Error("expected the web adapter to construct a ceremony lifecycle");

    expect({
      dbFile: path.basename(options.dbPath),
      lifecycleInstances: createCeremonyLifecycle.mock.calls.length,
      resolvedStart: options.resolveStartInput(117),
      storyIds: lifecycleSpies.start.mock.calls.map(([storyId]) => storyId),
      sessionId: session.id,
    }).toEqual({
      dbFile: "cerimonias.db",
      lifecycleInstances: 1,
      resolvedStart: {
        story: {
          id: 117,
          title: "Exportar relatório",
          description: "O gerente precisa baixar o CSV.",
          url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/117",
        },
        investigationMarkdown: "## Furos da US\n\n- Sem regra de arredondamento.",
      },
      storyIds: [117],
      sessionId: "session-1",
    });
  });

  it("should reuse the lifecycle after an HMR module reload", async () => {
    await startCeremony(117);

    vi.resetModules();
    const reloaded = await import("./ceremonies");
    await reloaded.startCeremony(118);

    expect({
      lifecycleInstances: createCeremonyLifecycle.mock.calls.length,
      storyIds: lifecycleSpies.start.mock.calls.map(([storyId]) => storyId),
    }).toEqual({ lifecycleInstances: 1, storyIds: [117, 118] });
  });
});
