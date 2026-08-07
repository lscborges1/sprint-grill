import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentRuntimeError } from "@sprint-griller/agent-runtime";
import type {
  AgentQuestion,
  AgentRuntime,
  AgentSession,
  StartSessionOptions,
} from "@sprint-griller/agent-runtime";
import type { SquadConfig } from "@sprint-griller/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCeremony } from "./ceremony";
import { openCeremonyStore } from "./store";
import type { CeremonyStore } from "./store";

const SESSION_ID = "thread-1";

const repos: SquadConfig["repos"] = {
  primary: { name: "core-api", path: "/dev/core-api" },
  related: [],
};

const story = {
  id: 4242,
  title: "Exportar relatório de comissões",
  description: "<p>O gerente precisa baixar o CSV.</p>",
  url: "https://dev.azure.com/org/proj/_workitems/edit/4242",
};

const agentQuestion = (overrides: Partial<AgentQuestion> = {}): AgentQuestion => ({
  id: "q1",
  header: "Arredondamento",
  question: "A comissão arredonda para cima?",
  recommendation: "Seguir a regra bancária, igual à folha.",
  evidence: ["core-api · src/payroll/rounding.ts"],
  options: [{ label: "Regra bancária", description: "Igual à folha." }],
  allowFreeText: true,
  ...overrides,
});

type Step =
  | { readonly type: "message"; readonly text: string }
  | { readonly type: "ask"; readonly questions: readonly AgentQuestion[] }
  | { readonly type: "complete" }
  | { readonly type: "fail"; readonly message: string };

/**
 * Runtime de mentira que para de verdade na pergunta: o gerador só avança
 * quando `answer` é chamado, que é como o turno real se comporta.
 */
function fakeRuntime(turns: readonly (readonly Step[])[]) {
  const prompts: string[] = [];
  const answered: Record<string, readonly string[]>[] = [];
  const resumed: string[] = [];
  let turn = 0;

  const session: AgentSession = {
    id: SESSION_ID,
    send(prompt) {
      prompts.push(prompt);
      const script = turns[turn] ?? [];
      turn += 1;

      return (async function* () {
        for (const step of script) {
          switch (step.type) {
            case "message":
              yield { type: "message", text: step.text } as const;
              break;
            case "ask": {
              let release: () => void = () => undefined;
              const gate = new Promise<void>((resolve) => {
                release = resolve;
              });
              yield {
                type: "question",
                question: {
                  questions: step.questions,
                  answer: async (answers: Readonly<Record<string, readonly string[]>>) => {
                    answered.push(answers);
                    release();
                  },
                },
              } as const;
              await gate;
              break;
            }
            case "complete":
              yield {
                type: "turn-completed",
                turn: { id: "turn-1", status: "completed", durationMs: 1 },
              } as const;
              break;
            case "fail":
              yield { type: "turn-failed", error: new AgentRuntimeError(step.message) } as const;
              break;
          }
        }
      })() as ReturnType<AgentSession["send"]>;
    },
    interrupt: async () => undefined,
  };

  const runtime: AgentRuntime = {
    startSession: async (_options?: StartSessionOptions) => session,
    resumeSession: async (id: string) => {
      resumed.push(id);
      return session;
    },
    close: async () => undefined,
  };

  return { runtime, prompts, answered, resumed };
}

const stores: CeremonyStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
});

function newStore(): CeremonyStore {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-")), "cerimonias.db");
  const store = openCeremonyStore(file);
  stores.push(store);
  return store;
}

function ceremonyWith(turns: readonly (readonly Step[])[]) {
  const store = newStore();
  const fake = fakeRuntime(turns);
  const onChange = vi.fn();
  const ceremony = createCeremony({ runtime: fake.runtime, store, repos, onChange });
  return { ...fake, store, ceremony, onChange };
}

async function start(ceremony: ReturnType<typeof createCeremony>) {
  return ceremony.start({ story, investigationMarkdown: "## Furos da US\n\n- Sem regra." });
}

describe("start", () => {
  it("should persist the ceremony with the investigation as its input", async () => {
    const { ceremony, store, prompts } = ceremonyWith([[{ type: "ask", questions: [agentQuestion()] }]]);

    const session = await start(ceremony);

    expect(session.id).toBe(SESSION_ID);
    expect(store.getSession(SESSION_ID)).toMatchObject({
      storyId: 4242,
      storyTitle: "Exportar relatório de comissões",
      status: "ativa",
    });
    await vi.waitFor(() => expect(prompts[0]).toContain("Sem regra."));
  });

  it("should put the question on the stage with its recommendation and evidence", async () => {
    const { ceremony } = ceremonyWith([[{ type: "ask", questions: [agentQuestion()] }]]);
    await start(ceremony);

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.current).toEqual({
        phase: "perguntando",
        question: {
          id: "q1",
          header: "Arredondamento",
          question: "A comissão arredonda para cima?",
          recommendation: "Seguir a regra bancária, igual à folha.",
          evidence: ["core-api · src/payroll/rounding.ts"],
          options: [{ label: "Regra bancária", description: "Igual à folha." }],
          allowFreeText: true,
        },
      }),
    );
  });

  it("should never record a decision on its own", async () => {
    const { ceremony, store } = ceremonyWith([
      [
        { type: "message", text: "li o repo" },
        { type: "ask", questions: [agentQuestion()] },
      ],
    ]);
    await start(ceremony);

    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    expect(store.countDecisions(SESSION_ID)).toBe(0);
    expect(store.listDecisions(SESSION_ID)).toEqual([]);
  });

  it("should end the ceremony when the agent runs out of questions", async () => {
    const { ceremony, store } = ceremonyWith([[{ type: "message", text: "sem furos" }, { type: "complete" }]]);
    await start(ceremony);

    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current).toEqual({ phase: "encerrada" }));
    expect(store.getSession(SESSION_ID)?.status).toBe("encerrada");
  });

  it("should surface a broken turn on the stage", async () => {
    const { ceremony } = ceremonyWith([[{ type: "fail", message: "o agente caiu" }]]);
    await start(ceremony);

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.current).toEqual({
        phase: "falhou",
        message: "o agente caiu",
      }),
    );
  });
});

describe("decide", () => {
  it("should record who decided and hand the answer back to the agent", async () => {
    const { ceremony, store, answered } = ceremonyWith([
      [{ type: "ask", questions: [agentQuestion()] }, { type: "complete" }],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    const decision = await ceremony.decide({
      sessionId: SESSION_ID,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO + squad",
    });

    expect(decision).toMatchObject({ answer: "Regra bancária", decidedBy: "PO + squad" });
    expect(store.countDecisions(SESSION_ID)).toBe(1);
    expect(answered).toEqual([{ q1: ["Regra bancária"] }]);
  });

  it("should hold the agent until every question of the round is decided", async () => {
    const { ceremony, answered } = ceremonyWith([
      [
        {
          type: "ask",
          questions: [agentQuestion({ id: "q1" }), agentQuestion({ id: "q2" })],
        },
        { type: "complete" },
      ],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Sim", decidedBy: "PO" });

    expect(answered).toEqual([]);

    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q2", answer: "Não", decidedBy: "squad" });

    expect(answered).toEqual([{ q1: ["Sim"], q2: ["Não"] }]);
  });

  it("should notify the stage on every change", async () => {
    const { ceremony, onChange } = ceremonyWith([
      [{ type: "ask", questions: [agentQuestion()] }, { type: "complete" }],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(SESSION_ID));

    onChange.mockClear();
    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Sim", decidedBy: "PO" });

    expect(onChange).toHaveBeenCalledWith(SESSION_ID);
  });
});

describe("questions with no recommendation", () => {
  it("should send them back to the agent instead of showing them to the room", async () => {
    const { ceremony, store, answered } = ceremonyWith([
      [
        { type: "ask", questions: [agentQuestion({ recommendation: null })] },
        { type: "ask", questions: [agentQuestion({ id: "q2" })] },
      ],
    ]);
    await start(ceremony);

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.current).toMatchObject({
        phase: "perguntando",
        question: { id: "q2" },
      }),
    );
    expect(answered[0]?.q1?.[0]).toMatch(/recomend/i);
    // A pergunta sem recomendação nem chegou a existir para a sala.
    expect(store.listTranscript(SESSION_ID).map((entry) => entry.event.kind)).toEqual([
      "pergunta-recusada",
      "pergunta",
    ]);
  });
});

describe("resume", () => {
  it("should mark a ceremony with no live turn as resumable", async () => {
    const store = newStore();
    store.createSession({
      id: SESSION_ID,
      storyId: 4242,
      storyTitle: story.title,
      storyUrl: story.url,
      investigationMarkdown: "## Furos da US",
    });
    const fake = fakeRuntime([[{ type: "complete" }]]);
    const ceremony = createCeremony({ runtime: fake.runtime, store, repos });

    expect(ceremony.palco(SESSION_ID)).toMatchObject({ live: false, current: { phase: "retomavel" } });
  });

  it("should resume the agent session replaying the decisions already taken", async () => {
    const { ceremony, store, resumed, prompts } = ceremonyWith([
      [{ type: "ask", questions: [agentQuestion()] }],
      [{ type: "complete" }],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));
    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Regra bancária", decidedBy: "PO" });
    store.appendEvent(SESSION_ID, { kind: "mensagem", text: "…" });

    await ceremony.resume(SESSION_ID);

    expect(resumed).toEqual([SESSION_ID]);
    expect(prompts[1]).toContain("Regra bancária");
  });

  it("should record the decision and resume when the turn died with the process", async () => {
    const store = newStore();
    store.createSession({
      id: SESSION_ID,
      storyId: 4242,
      storyTitle: story.title,
      storyUrl: story.url,
      investigationMarkdown: "## Furos da US",
    });
    store.askQuestions(SESSION_ID, [
      {
        id: "q1",
        header: "Arredondamento",
        question: "A comissão arredonda para cima?",
        recommendation: "Regra bancária.",
        evidence: [],
        options: [],
        allowFreeText: true,
      },
    ]);
    const fake = fakeRuntime([[{ type: "complete" }]]);
    const ceremony = createCeremony({ runtime: fake.runtime, store, repos });

    await ceremony.decide({
      sessionId: SESSION_ID,
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    expect(store.countDecisions(SESSION_ID)).toBe(1);
    expect(fake.resumed).toEqual([SESSION_ID]);
    expect(fake.prompts[0]).toContain("Regra bancária");
  });

  it("should drop the questions of the dead turn so the room is not asked twice", async () => {
    const store = newStore();
    store.createSession({
      id: SESSION_ID,
      storyId: 4242,
      storyTitle: story.title,
      storyUrl: story.url,
      investigationMarkdown: "## Furos da US",
    });
    store.askQuestions(SESSION_ID, [
      {
        id: "q1",
        header: "Escopo",
        question: "Vale para o mobile?",
        recommendation: "Só web.",
        evidence: [],
        options: [],
        allowFreeText: true,
      },
    ]);
    const fake = fakeRuntime([[{ type: "complete" }]]);
    const ceremony = createCeremony({ runtime: fake.runtime, store, repos });

    await ceremony.resume(SESSION_ID);

    expect(store.currentQuestion(SESSION_ID)).toBeUndefined();
    expect(store.countDecisions(SESSION_ID)).toBe(0);
  });

  it("should keep the decision even when the ceremony fails to resume", async () => {
    const store = newStore();
    store.createSession({
      id: SESSION_ID,
      storyId: 4242,
      storyTitle: story.title,
      storyUrl: story.url,
      investigationMarkdown: "## Furos da US",
    });
    store.askQuestions(SESSION_ID, [
      {
        id: "q1",
        header: "Escopo",
        question: "Vale para o mobile?",
        recommendation: "Só web.",
        evidence: [],
        options: [],
        allowFreeText: true,
      },
    ]);
    const fake = fakeRuntime([[{ type: "complete" }]]);
    const ceremony = createCeremony({
      runtime: { ...fake.runtime, resumeSession: async () => Promise.reject(new Error("codex caiu")) },
      store,
      repos,
    });

    const decision = await ceremony.decide({
      sessionId: SESSION_ID,
      questionId: "q1",
      answer: "Só web",
      decidedBy: "PO",
    });

    expect(decision.answer).toBe("Só web");
    expect(store.countDecisions(SESSION_ID)).toBe(1);
    expect(ceremony.palco(SESSION_ID)?.current).toEqual({ phase: "retomavel" });
  });

  it("should refuse to resume a ceremony that already ended", async () => {
    const { ceremony } = ceremonyWith([[{ type: "complete" }]]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("encerrada"));

    await expect(ceremony.resume(SESSION_ID)).rejects.toThrow(/encerrada/i);
  });
});

describe("palco", () => {
  it("should count the decisions and keep the last one for the stage", async () => {
    const { ceremony } = ceremonyWith([
      [
        { type: "ask", questions: [agentQuestion({ id: "q1" })] },
        { type: "ask", questions: [agentQuestion({ id: "q2" })] },
      ],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));
    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Sim", decidedBy: "PO" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)).toMatchObject({
        decisionCount: 1,
        lastDecision: { answer: "Sim", decidedBy: "PO" },
        live: true,
      }),
    );
  });

  it("should return nothing for a ceremony that does not exist", () => {
    const { ceremony } = ceremonyWith([[]]);

    expect(ceremony.palco("thread-fantasma")).toBeUndefined();
  });
});
