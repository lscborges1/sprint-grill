import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { AgentQuestion, AgentSession } from "@sprint-griller/agent-runtime";
import { AdoError } from "@sprint-griller/ado-client";
import { createLogger } from "@sprint-griller/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAgentRuntime = vi.hoisted(() => vi.fn());
const getInvestigation = vi.hoisted(() => vi.fn());
const loadAdoCredentials = vi.hoisted(() => vi.fn());
const publishDecisionRecord = vi.hoisted(() => vi.fn());
const publishStorySpec = vi.hoisted(() => vi.fn());

vi.mock("@sprint-griller/agent-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/agent-runtime")>()),
  createAgentRuntime,
}));
vi.mock("@sprint-griller/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/core")>()),
  loadAdoCredentials,
}));
vi.mock("@sprint-griller/ado-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/ado-client")>()),
  publishDecisionRecord,
  publishStorySpec,
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

const {
  discardSpecDraft,
  dumpCeremony,
  getDossie,
  getPalco,
  saveSpecDraft,
  startCeremony,
  submitDecision,
  subscribeToDossie,
  subscribeToPalco,
} = await import("./ceremonies");

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
  loadAdoCredentials.mockReturnValue({ pat: "pat-de-teste" });
  publishDecisionRecord.mockImplementation(async () => ({
    commentId: 90 + publishDecisionRecord.mock.calls.length,
    url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/1",
  }));
  publishStorySpec.mockResolvedValue(undefined);
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

describe("getDossie", () => {
  it("should form the document from the decisions taken in the room", async () => {
    const session = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getPalco(session.id)?.current.phase).toBe("perguntando"));

    await submitDecision({
      sessionId: session.id,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO + squad",
    });

    expect(getDossie(session.id)?.spec.generated).toContain("Decidido por PO + squad");
  });

  it("should hand the Operator edit back after a refresh, ahead of the generated text", async () => {
    const session = await startCeremony(nextStoryId);
    const generated = getDossie(session.id)?.spec.generated ?? "";

    saveSpecDraft({
      sessionId: session.id,
      markdown: `${generated}\n\nFora de escopo: relatório mensal.`,
      base: generated,
      expectedSavedAt: null,
    });

    expect(getDossie(session.id)?.spec.draft?.markdown).toContain(
      "Fora de escopo: relatório mensal.",
    );
  });

  it("should go back to the generated document when the edit is discarded", async () => {
    const session = await startCeremony(nextStoryId);
    const draft = getDossie(session.id)?.spec.draft;
    saveSpecDraft({
      sessionId: session.id,
      markdown: "assinado",
      base: "gerado",
      expectedSavedAt: draft?.savedAt ?? null,
    });

    discardSpecDraft({
      sessionId: session.id,
      expectedSavedAt: getDossie(session.id)?.spec.draft?.savedAt ?? null,
    });

    expect(getDossie(session.id)?.spec.draft).toBeNull();
  });
});

describe("dumpCeremony", () => {
  it("should require explicit confirmation before dumping with open questions", async () => {
    const session = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getDossie(session.id)?.pending).toHaveLength(1));
    const dossie = getDossie(session.id)!;

    await expect(
      dumpCeremony({
        sessionId: session.id,
        markdown: dossie.spec.generated,
        base: dossie.spec.generated,
        confirmPending: false,
      }),
    ).rejects.toThrow(/confirme/i);

    expect(publishDecisionRecord).not.toHaveBeenCalled();
    expect(publishStorySpec).not.toHaveBeenCalled();
  });

  it("should publish the saved draft, link its decision record, and skip it on a retry", async () => {
    const session = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getPalco(session.id)?.current.phase).toBe("perguntando"));
    await submitDecision({
      sessionId: session.id,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO + squad",
    });
    const generated = getDossie(session.id)!.spec.generated;
    saveSpecDraft({
      sessionId: session.id,
      markdown: "# Spec revisada pelo Operador",
      base: generated,
      expectedSavedAt: null,
    });
    const signed = getDossie(session.id)!;

    publishStorySpec.mockRejectedValueOnce(new AdoError("unexpected", "nada foi gravado"));
    await expect(
      dumpCeremony({
        sessionId: session.id,
        markdown: signed.spec.draft!.markdown,
        base: signed.spec.draft!.base,
        confirmPending: true,
      }),
    ).rejects.toThrow(/nada foi gravado/i);

    expect(publishDecisionRecord).toHaveBeenCalledTimes(1);
    expect(getDossie(session.id)?.decisions[0]).toMatchObject({ recordId: 91 });

    await dumpCeremony({
      sessionId: session.id,
      markdown: signed.spec.draft!.markdown,
      base: signed.spec.draft!.base,
      confirmPending: true,
    });

    expect(publishDecisionRecord).toHaveBeenCalledTimes(1);
    expect(publishStorySpec).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        markdown: expect.stringContaining("# Spec revisada pelo Operador"),
      }),
    );
    expect(publishStorySpec.mock.calls.at(-1)?.[1].markdown).toContain("Registro #91");
  });

  it("should share one in-flight dump when the Operator confirms twice", async () => {
    const session = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getPalco(session.id)?.current.phase).toBe("perguntando"));
    await submitDecision({
      sessionId: session.id,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });
    const dossie = getDossie(session.id)!;
    let release!: () => void;
    publishDecisionRecord.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ commentId: 91, url: dossie.story.url }); }),
    );
    const input = {
      sessionId: session.id,
      markdown: dossie.spec.generated,
      base: dossie.spec.generated,
      confirmPending: true,
    };

    const first = dumpCeremony(input);
    const second = dumpCeremony(input);
    expect(second).toBe(first);
    release();
    await first;

    expect(publishDecisionRecord).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeToDossie", () => {
  it("should push the new document to the Operator when a decision lands", async () => {
    const session = await startCeremony(nextStoryId);
    await vi.waitFor(() => expect(getPalco(session.id)?.current.phase).toBe("perguntando"));
    const seen: number[] = [];
    const unsubscribe = subscribeToDossie(session.id, (state) => seen.push(state.decisions.length));

    await submitDecision({
      sessionId: session.id,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    expect(seen).toContain(1);
    unsubscribe();
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
