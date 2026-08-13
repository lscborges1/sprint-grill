import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { AgentSession } from "@sprint-griller/agent-runtime";
import type { Ceremony, CeremonyDump, CeremonyStore } from "@sprint-griller/ceremony";
import { CeremonyError } from "@sprint-griller/ceremony";
import { createLogger } from "@sprint-griller/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAgentRuntime = vi.hoisted(() => vi.fn());
const createCeremonyDump = vi.hoisted(() => vi.fn());
const getInvestigation = vi.hoisted(() => vi.fn());
const assertCanStartCeremony = vi.hoisted(() => vi.fn());
const publishDump = vi.hoisted(() => vi.fn());

vi.mock("@sprint-griller/agent-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/agent-runtime")>()),
  createAgentRuntime,
}));
vi.mock("@sprint-griller/ceremony", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/ceremony")>()),
  createCeremonyDump,
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

vi.stubEnv(
  "SPRINT_GRILLER_DB",
  path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-web-")), "cerimonias.db"),
);

const {
  decisionSchema,
  dumpCeremony,
  dumpCeremonySchema,
  getDossie,
  sessionIdSchema,
  specDraftSchema,
  startCeremony,
} = await import("./ceremonies");

interface RegistryForTest {
  store?: CeremonyStore | undefined;
  ceremony?: Ceremony | undefined;
  dump?: CeremonyDump | undefined;
  starting?: Promise<Ceremony> | undefined;
  startingByStory: Map<number, Promise<unknown>>;
}

let storyId = 100;
let sessionId = 0;
let agentSessionId = 0;

function registry(): RegistryForTest | undefined {
  return (globalThis as { __sprintGrillerCeremonies?: RegistryForTest })
    .__sprintGrillerCeremonies;
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
      })() as ReturnType<AgentSession["send"]>;
    },
    interrupt: async () => undefined,
  };
}

beforeEach(() => {
  storyId += 1;
  sessionId += 1;
  agentSessionId = 0;
  vi.clearAllMocks();
  assertCanStartCeremony.mockResolvedValue(undefined);
  publishDump.mockResolvedValue(undefined);
  createCeremonyDump.mockReturnValue({
    assertCanStartCeremony,
    publish: publishDump,
  } satisfies CeremonyDump);
  createAgentRuntime.mockResolvedValue({
    startSession: async () => terminalSession(`session-${sessionId}-${++agentSessionId}`),
    resumeSession: async (id: string) => terminalSession(id),
    close: async () => undefined,
  });
  getInvestigation.mockImplementation((requestedStoryId: number) => ({
    storyId: requestedStoryId,
    story: {
      id: requestedStoryId,
      title: "Exportar relatório",
      type: "User Story",
      state: "New",
      description: "O gerente precisa baixar o CSV.",
      url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${requestedStoryId}`,
    },
    status: "aprovado",
    markdown: "## Furos da US\n\n- Sem regra de arredondamento.",
  }));

  const current = registry();
  if (current) {
    current.ceremony = undefined;
    current.dump = undefined;
    current.starting = undefined;
    current.startingByStory.clear();
  }
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

describe("startCeremony", () => {
  it("should delegate preflight with the parsed investigation approval", async () => {
    await startCeremony(storyId);

    expect(assertCanStartCeremony).toHaveBeenCalledWith({
      storyId,
      investigationApproved: true,
    });
  });

  it("should return one session when Grelhar is submitted twice concurrently", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let starts = 0;
    createAgentRuntime.mockResolvedValue({
      startSession: async () => {
        starts += 1;
        await held;
        return terminalSession(`session-${sessionId}-${starts}`);
      },
      resumeSession: async (id: string) => terminalSession(id),
      close: async () => undefined,
    });

    const pending = Promise.all([startCeremony(storyId), startCeremony(storyId)]);
    release();
    const [first, second] = await pending;

    expect({ sameSession: second.id === first.id, starts }).toEqual({
      sameSession: true,
      starts: 1,
    });
  });

  it("should preserve the module's blocker message for a missing approved investigation", async () => {
    getInvestigation.mockReturnValue(undefined);
    assertCanStartCeremony.mockRejectedValueOnce(new CeremonyError(
      `A US #${storyId} ainda não tem Investigação aprovada — investigue antes de grelhar.`,
    ));

    await expect(startCeremony(storyId)).rejects.toThrow(
      `A US #${storyId} ainda não tem Investigação aprovada — investigue antes de grelhar.`,
    );
    expect(createAgentRuntime).not.toHaveBeenCalled();
  });
});

describe("dumpCeremony", () => {
  it("should delegate the parsed dump input to the deep module", async () => {
    const session = await startCeremony(storyId);
    await vi.waitFor(() => expect(getDossie(session.id)?.status).toBe("encerrada"));
    const dossie = getDossie(session.id);
    if (!dossie) throw new Error("expected dossie");
    const input = {
      sessionId: session.id,
      markdown: dossie.spec.generated,
      base: dossie.spec.generated,
      tasksMarkdown: "## Task",
      estimate: 5,
      confirmPending: true,
    } as const;

    await dumpCeremony(input);

    expect(publishDump).toHaveBeenCalledWith(input);
  });

  it("should reject an old dump while the same story is starting", async () => {
    const first = await startCeremony(storyId);
    await vi.waitFor(() => expect(getDossie(first.id)?.status).toBe("encerrada"));
    const firstDossie = getDossie(first.id);
    if (!firstDossie) throw new Error("expected first dossie");
    let release!: () => void;
    assertCanStartCeremony.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    const starting = startCeremony(storyId);
    await vi.waitFor(() => expect(assertCanStartCeremony).toHaveBeenCalledTimes(2));
    await expect(dumpCeremony({
      sessionId: first.id,
      markdown: firstDossie.spec.generated,
      base: firstDossie.spec.generated,
      tasksMarkdown: "## Task",
      estimate: 5,
      confirmPending: true,
    })).rejects.toThrow(/abrindo outra cerimônia/i);
    expect(publishDump).not.toHaveBeenCalled();

    release();
    await starting;
  });
});
