import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { AgentQuestion, AgentSession } from "@sprint-griller/agent-runtime";
import { createLogger } from "@sprint-griller/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAgentRuntime = vi.hoisted(() => vi.fn());
const getInvestigation = vi.hoisted(() => vi.fn());

vi.mock("@sprint-griller/agent-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/agent-runtime")>()),
  createAgentRuntime,
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
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
    level: "fatal",
  }),
}));

vi.stubEnv(
  "SPRINT_GRILLER_DB",
  path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-web-")), "cerimonias.db"),
);

const { getPalco, startCeremony, submitDecision, subscribeToPalco } = await import("./ceremonies");

const STORY = {
  id: 1,
  title: "Exportar relatório de comissões",
  type: "User Story",
  state: "New",
  description: "O gerente precisa baixar o CSV.",
  url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/1",
};

const QUESTION: AgentQuestion = {
  id: "q1",
  header: "Arredondamento",
  question: "A comissão arredonda para cima?",
  recommendation: "Seguir a regra bancária.",
  evidence: ["core-api · src/payroll/rounding.ts"],
  options: [],
  allowFreeText: true,
};

/** Cada teste usa uma US própria: o banco é o mesmo do começo ao fim, como em produção. */
let nextStoryId = 100;
let nextSessionId = 0;

function fakeSession(id: string): AgentSession {
  return {
    id,
    send() {
      return (async function* () {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        yield {
          type: "question",
          question: {
            questions: [QUESTION],
            answer: async () => {
              release();
            },
          },
        } as const;
        await gate;
      })() as ReturnType<AgentSession["send"]>;
    },
    interrupt: async () => undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  nextStoryId += 1;
  nextSessionId += 1;

  createAgentRuntime.mockResolvedValue({
    startSession: async () => fakeSession(`thread-${nextSessionId}`),
    resumeSession: async (id: string) => fakeSession(id),
    close: async () => undefined,
  });
  getInvestigation.mockReturnValue({
    storyId: nextStoryId,
    story: { ...STORY, id: nextStoryId },
    status: "aprovado",
    markdown: "## Furos da US\n\n- Sem regra de arredondamento.",
  });
});

describe("startCeremony", () => {
  it("should refuse a story with no approved investigation", async () => {
    getInvestigation.mockReturnValue(undefined);

    await expect(startCeremony(nextStoryId)).rejects.toThrow(/investiga/i);
  });

  it("should refuse a story whose investigation was rejected", async () => {
    getInvestigation.mockReturnValue({
      storyId: nextStoryId,
      story: STORY,
      status: "reprovado",
      markdown: "# reprovado",
      violations: [],
    });

    await expect(startCeremony(nextStoryId)).rejects.toThrow(/investiga/i);
  });

  it("should open the stage on the first question of the grilling", async () => {
    const session = await startCeremony(nextStoryId);

    await vi.waitFor(() =>
      expect(getPalco(session.id)).toMatchObject({
        story: { id: nextStoryId, title: STORY.title },
        decisionCount: 0,
        current: { phase: "perguntando", question: { id: "q1" } },
      }),
    );
  });

  it("should return to the open ceremony instead of starting a second one", async () => {
    const first = await startCeremony(nextStoryId);

    const second = await startCeremony(nextStoryId);

    expect(second.id).toBe(first.id);
  });

  it("should not open two ceremonies when Grelhar is submitted twice at once", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let starts = 0;
    createAgentRuntime.mockResolvedValue({
      startSession: async () => {
        starts += 1;
        await hold;
        return fakeSession(`thread-${nextSessionId}-${starts}`);
      },
      resumeSession: async (id: string) => fakeSession(id),
      close: async () => undefined,
    });
    // Força o getCeremony a criar de novo com o mock acima.
    const reg = (globalThis as { __sprintGrillerCeremonies?: { ceremony?: unknown; starting?: unknown } })
      .__sprintGrillerCeremonies;
    if (reg) {
      reg.ceremony = undefined;
      reg.starting = undefined;
    }

    const storyId = nextStoryId;
    const pending = Promise.all([startCeremony(storyId), startCeremony(storyId)]);
    release();
    const [first, second] = await pending;

    expect(second.id).toBe(first.id);
    expect(starts).toBe(1);
  });
});

describe("submitDecision", () => {
  it("should record who decided and when", async () => {
    const session = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getPalco(session.id)?.current.phase).toBe("perguntando"));

    await submitDecision({
      sessionId: session.id,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO + squad",
    });

    expect(getPalco(session.id)).toMatchObject({
      decisionCount: 1,
      lastDecision: { answer: "Regra bancária", decidedBy: "PO + squad" },
    });
  });
});

describe("subscribeToPalco", () => {
  it("should push the new state to the stage when a decision lands", async () => {
    const session = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getPalco(session.id)?.current.phase).toBe("perguntando"));
    const seen: number[] = [];
    const unsubscribe = subscribeToPalco(session.id, (state) => seen.push(state.decisionCount));

    await submitDecision({
      sessionId: session.id,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    expect(seen).toContain(1);
    unsubscribe();
  });

  it("should stop pushing after the stage disconnects", async () => {
    const session = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getPalco(session.id)?.current.phase).toBe("perguntando"));
    const listener = vi.fn();
    subscribeToPalco(session.id, listener)();

    await submitDecision({
      sessionId: session.id,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("should not push the state of another ceremony", async () => {
    const other = await startCeremony(nextStoryId);
    nextStoryId += 1;
    nextSessionId += 1;
    getInvestigation.mockReturnValue({
      storyId: nextStoryId,
      story: { ...STORY, id: nextStoryId },
      status: "aprovado",
      markdown: "## Furos da US",
    });
    const mine = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getPalco(mine.id)?.current.phase).toBe("perguntando"));
    const listener = vi.fn();
    const unsubscribe = subscribeToPalco(other.id, listener);

    await submitDecision({
      sessionId: mine.id,
      questionId: "q1",
      answer: "Sim",
      decidedBy: "PO",
    });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
