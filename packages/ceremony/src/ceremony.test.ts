import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { AgentRuntimeError } from "@sprint-griller/agent-runtime";
import type {
  AgentEvent,
  AgentQuestion,
  AgentRuntime,
  AgentSession,
  StartSessionOptions,
} from "@sprint-griller/agent-runtime";
import { createLogger } from "@sprint-griller/core";
import type { Logger, SquadConfig } from "@sprint-griller/core";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createCeremony } from "./ceremony";
import { openCeremonyStore } from "./store";
import type { CeremonyStore } from "./store";

const SESSION_ID = "thread-1";

/** Repo de mentira no disco: a Consulta confere as citações contra ele de verdade. */
const tmpRoot = mkdtempSync(path.join(tmpdir(), "sprint-griller-repo-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

const repoRoot = path.join(tmpRoot, "core-api");
mkdirSync(path.join(repoRoot, "src"), { recursive: true });
writeFileSync(path.join(repoRoot, "src", "order.ts"), "export function createOrder() {}\n");

const repos: SquadConfig["repos"] = {
  primary: { name: "core-api", path: repoRoot },
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
 *
 * `consulta` é o roteiro da sessão que a Consulta factual abre à parte — o
 * runtime real também devolve uma sessão nova a cada `startSession`.
 */
function fakeRuntime(
  turns: readonly (readonly Step[])[],
  consulta: readonly AgentEvent[] = [],
) {
  const prompts: string[] = [];
  const consultaPrompts: string[] = [];
  const answered: Record<string, readonly string[]>[] = [];
  const resumed: string[] = [];
  let turn = 0;
  let sessions = 0;

  const consultaSession: AgentSession = {
    id: "consulta-1",
    send(prompt) {
      consultaPrompts.push(prompt);
      return (async function* () {
        for (const event of consulta) yield event;
      })() as ReturnType<AgentSession["send"]>;
    },
    interrupt: async () => undefined,
  };

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
    // A primeira sessão é a da cerimônia; as seguintes são Consultas.
    startSession: async (_options?: StartSessionOptions) => {
      sessions += 1;
      return sessions === 1 ? session : consultaSession;
    },
    resumeSession: async (id: string) => {
      resumed.push(id);
      return session;
    },
    close: async () => undefined,
  };

  return { runtime, prompts, consultaPrompts, answered, resumed };
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

function ceremonyWith(
  turns: readonly (readonly Step[])[],
  consulta: readonly AgentEvent[] = [],
) {
  const store = newStore();
  const fake = fakeRuntime(turns, consulta);
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
          questionSeq: 1,
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

describe("consult", () => {
  const factAnswer = (citations: unknown): AgentEvent => ({
    type: "message",
    text: `\`\`\`json\n${JSON.stringify({
      answer: "O createOrder só é chamado pelo checkout.",
      citations,
    })}\n\`\`\``,
  });

  const TURN_DONE: AgentEvent = {
    type: "turn-completed",
    turn: { id: "turn-1", status: "completed", durationMs: 1 },
  };

  async function grilling(consulta: readonly AgentEvent[]) {
    const fake = ceremonyWith([[{ type: "ask", questions: [agentQuestion()] }]], consulta);
    await start(fake.ceremony);
    await vi.waitFor(() => expect(fake.ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));
    return fake;
  }

  it("should fail an orphaned consultation during process recovery", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-recovery-")), "cerimonias.db");
    const previousStore = openCeremonyStore(file);
    previousStore.createSession({
      id: SESSION_ID,
      storyId: story.id,
      storyTitle: story.title,
      storyUrl: story.url,
      investigationMarkdown: "## Furos da US",
    });
    previousStore.openConsultation(SESSION_ID, "Quem chama o createOrder?");
    previousStore.close();

    const recoveredStore = openCeremonyStore(file);
    stores.push(recoveredStore);
    const fake = fakeRuntime([[{ type: "ask", questions: [agentQuestion()] }]]);
    const ceremony = createCeremony({ runtime: fake.runtime, store: recoveredStore, repos });

    expect(recoveredStore.lastConsultation(SESSION_ID)).toMatchObject({
      status: "falhou",
      message: /processo foi reiniciado/i,
    });
    expect(ceremony.palco(SESSION_ID)?.consultation).toMatchObject({ status: "falhou" });
    expect(() =>
      ceremony.consult({ sessionId: SESSION_ID, question: "E o cancelOrder?" }),
    ).not.toThrow();
  });

  it("should put the room question on the stage while the agent is still looking", async () => {
    const { ceremony } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_DONE,
    ]);

    const consultation = ceremony.consult({
      sessionId: SESSION_ID,
      question: "Quem chama o createOrder?",
    });

    expect(consultation).toMatchObject({
      question: "Quem chama o createOrder?",
      status: "buscando",
    });
  });

  it("should refuse a second consultation while the first is still looking", async () => {
    const { ceremony } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_DONE,
    ]);

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    expect(() =>
      ceremony.consult({ sessionId: SESSION_ID, question: "E o cancelOrder?" }),
    ).toThrow(/espere a consulta/i);
  });

  it("should answer live with the citation that sustains it", async () => {
    const { ceremony } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/order.ts", symbol: "createOrder" }]),
      TURN_DONE,
    ]);

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.consultation).toMatchObject({
        status: "respondida",
        answer: "O createOrder só é chamado pelo checkout.",
        citations: [{ repo: "core-api", path: "src/order.ts", symbol: "createOrder" }],
      }),
    );
  });

  it("should record the factual answer in the transcript without touching the decisions", async () => {
    const { ceremony, store } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_DONE,
    ]);

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(store.listTranscript(SESSION_ID).map((entry) => entry.event.kind)).toContain(
        "resposta-factual",
      ),
    );
    expect(store.countDecisions(SESSION_ID)).toBe(0);
  });

  it("should keep the decision on the stage while the fact is being looked up", async () => {
    const { ceremony } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_DONE,
    ]);

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.consultation?.status).toBe("respondida"));
    expect(ceremony.palco(SESSION_ID)?.current).toMatchObject({
      phase: "perguntando",
      question: { id: "q1" },
    });
  });

  it("should mark an answer whose citation does not exist as unsustained", async () => {
    const { ceremony } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/inventado.ts" }]),
      TURN_DONE,
    ]);

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.consultation).toMatchObject({ status: "sem-lastro" }),
    );
  });

  it("should surface a broken consultation instead of leaving the room waiting", async () => {
    const { ceremony } = await grilling([
      { type: "turn-failed", error: new AgentRuntimeError("o codex caiu") },
    ]);

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.consultation).toMatchObject({
        status: "falhou",
        message: "A consulta parou por um erro inesperado.",
      }),
    );
  });

  it("should include the ceremony session in consultation logs", async () => {
    const lines: Record<string, unknown>[] = [];
    const destination = new Writable({
      write(chunk, _encoding, done) {
        lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        done();
      },
    });
    const store = newStore();
    const fake = fakeRuntime(
      [[{ type: "ask", questions: [agentQuestion()] }]],
      [factAnswer([{ repo: "core-api", path: "src/order.ts" }]), TURN_DONE],
    );
    const logger: Logger = createLogger({ destination, level: "info" });
    const ceremony = createCeremony({ runtime: fake.runtime, store, repos, logger });
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(lines).toContainEqual(
        expect.objectContaining({
          msg: "consulta respondida",
          sessionId: SESSION_ID,
          storyId: story.id,
        }),
      ),
    );
  });

  it("should surface a write failure instead of leaving the consultation searching", async () => {
    const { ceremony, store } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_DONE,
    ]);
    const answer = store.answerConsultation.bind(store);
    let failuresLeft = 1;
    store.answerConsultation = (consultationId, outcome) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("disco cheio");
      }
      answer(consultationId, outcome);
    };

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.consultation).toMatchObject({
        status: "falhou",
        message: /não foi possível gravar/i,
      }),
    );
  });

  it("should keep the stage unstuck when even the failure cannot be written", async () => {
    const { ceremony, store } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_DONE,
    ]);
    store.answerConsultation = () => {
      throw new Error("disco cheio");
    };

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.consultation).toMatchObject({
        status: "falhou",
        message: /não foi possível gravar/i,
      }),
    );
    // A falha em memória não pode travar a próxima pergunta da sala.
    expect(() =>
      ceremony.consult({ sessionId: SESSION_ID, question: "E o cancelOrder?" }),
    ).not.toThrow();
  });

  it("should notify the stage when the consultation opens and when it answers", async () => {
    const { ceremony, onChange } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_DONE,
    ]);
    onChange.mockClear();

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    expect(onChange).toHaveBeenCalledWith(SESSION_ID);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
  });

  it("should refuse a consultation on a ceremony that does not exist", async () => {
    const { ceremony } = await grilling([]);

    expect(() => ceremony.consult({ sessionId: "thread-fantasma", question: "e aí?" })).toThrow(
      /não existe/i,
    );
  });

  it("should refuse a consultation on a ceremony that already ended", async () => {
    const { ceremony } = ceremonyWith([[{ type: "complete" }]]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("encerrada"));

    expect(() => ceremony.consult({ sessionId: SESSION_ID, question: "e aí?" })).toThrow(
      /encerrada/i,
    );
  });
});

describe("palco", () => {
  it("should keep repeated agent ids distinct with the persisted question sequence", async () => {
    const { ceremony } = ceremonyWith([
      [{ type: "ask", questions: [agentQuestion({ id: "q1" })] }],
      [{ type: "ask", questions: [agentQuestion({ id: "q1" })] }],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Sim", decidedBy: "PO" });
    await ceremony.resume(SESSION_ID);

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)).toMatchObject({
        decisions: [{ questionId: "q1", questionSeq: 1 }],
        pendingQuestions: [{ id: "q1", questionSeq: 2 }],
      }),
    );
  });

  it("should expose decided and pending questions for the stage progress", async () => {
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
        decisions: [{ questionId: "q1", answer: "Sim", decidedBy: "PO" }],
        pendingQuestions: [{ id: "q2" }],
        live: true,
      }),
    );
  });

  it("should return nothing for a ceremony that does not exist", () => {
    const { ceremony } = ceremonyWith([[]]);

    expect(ceremony.palco("thread-fantasma")).toBeUndefined();
  });
});
