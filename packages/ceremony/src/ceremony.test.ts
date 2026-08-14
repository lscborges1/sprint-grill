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
  agendaItemId: "investigacao-1",
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
  | { readonly type: "propose-completion"; readonly summary?: string }
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
  const proposalVerdicts: { readonly accepted: boolean; readonly message: string }[] = [];
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
            case "propose-completion": {
              let release: () => void = () => undefined;
              const gate = new Promise<void>((resolve) => {
                release = resolve;
              });
              const summary = step.summary ?? "Todos os itens da agenda foram resolvidos.";
              yield {
                type: "completion-proposal",
                proposal: {
                  submission: { summary },
                  respond: async (verdict: { readonly accepted: boolean; readonly message: string }) => {
                    proposalVerdicts.push(verdict);
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

  return { runtime, prompts, consultaPrompts, answered, resumed, proposalVerdicts };
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
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: "ativa",
    });
    expect(session.refinement).toEqual({ phase: "refinando", revision: 1 });
    expect(store.listRefinementItems(SESSION_ID)).toEqual([
      expect.objectContaining({ id: "investigacao-1", question: "Sem regra." }),
    ]);
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
            agendaItemId: "investigacao-1",
            source: "agent",
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

  it("should continue once and remain resumable when normal turns make no progress", async () => {
    const { ceremony, store, prompts } = ceremonyWith([
      [{ type: "message", text: "sem furos" }, { type: "complete" }],
      [{ type: "complete" }],
    ]);
    await start(ceremony);

    await vi.waitFor(() => expect(prompts).toHaveLength(2));
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current).toEqual({ phase: "retomavel" }));
    expect(store.getSession(SESSION_ID)).toMatchObject({
      status: "ativa",
      refinement: { phase: "refinando" },
    });
    expect(store.listTranscript(SESSION_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ kind: "mensagem", text: expect.stringMatching(/retom/i) }),
        }),
      ]),
    );
  });

  it("should reject a completion proposal while an agenda item remains open", async () => {
    const { ceremony, store, proposalVerdicts } = ceremonyWith([
      [{ type: "propose-completion" }, { type: "complete" }],
      [{ type: "complete" }],
    ]);

    await start(ceremony);

    await vi.waitFor(() => expect(proposalVerdicts).toHaveLength(1));
    expect(proposalVerdicts[0]).toMatchObject({ accepted: false, message: expect.stringMatching(/aberto/i) });
    expect(store.getSession(SESSION_ID)?.refinement.phase).toBe("refinando");
  });

  it("should stop after two rejected completion proposals make no persisted progress", async () => {
    const { ceremony, store, prompts, proposalVerdicts } = ceremonyWith([
      [{ type: "propose-completion" }, { type: "complete" }],
      [{ type: "propose-completion" }, { type: "complete" }],
    ]);

    await start(ceremony);

    await vi.waitFor(() => expect(proposalVerdicts).toHaveLength(2));
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("retomavel"));
    expect(prompts).toHaveLength(2);
    expect(store.listTranscript(SESSION_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ kind: "mensagem", text: expect.stringMatching(/duas vezes/i) }),
        }),
      ]),
    );
  });

  it("should reset the no-progress count when an agenda question reaches the room", async () => {
    const { ceremony, prompts } = ceremonyWith([
      [{ type: "complete" }],
      [{ type: "ask", questions: [agentQuestion()] }, { type: "complete" }],
      [{ type: "complete" }],
      [{ type: "complete" }],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    await ceremony.decide({
      sessionId: SESSION_ID,
      questionId: "q1",
      answer: "Regra bancária",
    });

    await vi.waitFor(() => expect(prompts).toHaveLength(4));
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("retomavel"));
  });

  it("should persist the confirmation gate after an explicit proposal with a resolved agenda", async () => {
    const { ceremony, store, proposalVerdicts } = ceremonyWith([
      [
        { type: "ask", questions: [agentQuestion()] },
        { type: "propose-completion" },
        { type: "complete" },
      ],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    await ceremony.decide({
      sessionId: SESSION_ID,
      questionId: "q1",
      answer: "Regra bancária",
    });

    await vi.waitFor(() => expect(proposalVerdicts).toEqual([
      expect.objectContaining({ accepted: true }),
    ]));
    expect(store.getSession(SESSION_ID)?.refinement.phase).toBe("aguardando-confirmacao");
    expect(store.getSession(SESSION_ID)?.status).toBe("ativa");
    expect(ceremony.palco(SESSION_ID)?.completionProposal).toMatchObject({
      summary: "Todos os itens da agenda foram resolvidos.",
      proposedAt: expect.any(Number),
    });
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
  it("should record the room choice without an author and hand it back to the agent", async () => {
    const { ceremony, store, answered } = ceremonyWith([
      [{ type: "ask", questions: [agentQuestion()] }, { type: "complete" }],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    const decision = await ceremony.decide({
      sessionId: SESSION_ID,
      questionId: "q1",
      answer: "Regra bancária",
    });

    expect(decision).toMatchObject({ answer: "Regra bancária" });
    expect(decision).not.toHaveProperty("decidedBy");
    expect(store.countDecisions(SESSION_ID)).toBe(1);
    expect(answered).toEqual([{ q1: ["Regra bancária"] }]);
  });

  it("should reject a batch before any question reaches the room", async () => {
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
    await vi.waitFor(() => expect(answered).toHaveLength(1));

    expect(answered[0]).toEqual({
      q1: ["Envie exatamente uma pergunta por vez para a sala."],
      q2: ["Envie exatamente uma pergunta por vez para a sala."],
    });
    expect(ceremony.palco(SESSION_ID)?.pendingQuestions).toEqual([]);
  });

  it("should notify the stage on every change", async () => {
    const { ceremony, onChange } = ceremonyWith([
      [{ type: "ask", questions: [agentQuestion()] }, { type: "complete" }],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(SESSION_ID));

    onChange.mockClear();
    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Sim" });

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
      timeZone: "UTC",
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
    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Regra bancária" });
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
      timeZone: "UTC",
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
      timeZone: "UTC",
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
      timeZone: "UTC",
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
    });

    expect(decision.answer).toBe("Só web");
    expect(store.countDecisions(SESSION_ID)).toBe(1);
    expect(ceremony.palco(SESSION_ID)?.current).toEqual({ phase: "retomavel" });
  });

  it("should preserve and answer a queued room doubt after process recovery", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-choice-")), "cerimonias.db");
    const previousStore = openCeremonyStore(file);
    const roomChoice: AgentEvent = {
      type: "message",
      text: `\`\`\`json\n${JSON.stringify({
        kind: "room-choice",
        question: "O rollout inclui o app mobile?",
        recommendation: "Começar pela web.",
        evidence: ["core-api · src/order.ts"],
        options: [{ label: "Só web", description: "Menor risco inicial." }],
        allowFreeText: true,
      })}\n\`\`\``,
    };
    const firstRuntime = fakeRuntime(
      [[{ type: "ask", questions: [agentQuestion()] }]],
      [roomChoice, {
        type: "turn-completed",
        turn: { id: "turn-consulta", status: "completed", durationMs: 1 },
      }],
    );
    const firstCeremony = createCeremony({ runtime: firstRuntime.runtime, store: previousStore, repos });
    await start(firstCeremony);
    await vi.waitFor(() => expect(firstCeremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));
    firstCeremony.consult({ sessionId: SESSION_ID, question: "Isto vale no app também?" });
    await vi.waitFor(() => expect(previousStore.listOpenQuestions(SESSION_ID)).toHaveLength(2));
    previousStore.close();

    const recoveredStore = openCeremonyStore(file);
    stores.push(recoveredStore);
    const recoveredRuntime = fakeRuntime([[]]);
    const recovered = createCeremony({ runtime: recoveredRuntime.runtime, store: recoveredStore, repos });

    await recovered.resume(SESSION_ID);

    expect(recoveredStore.currentQuestion(SESSION_ID)).toMatchObject({
      id: "duvida-1",
      agendaItemId: "duvida-1",
      question: "O rollout inclui o app mobile?",
    });
    expect(recoveredStore.listRefinementItems(SESSION_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "investigacao-1", status: "aberto" }),
        expect.objectContaining({ id: "duvida-1", status: "aguardando-sala" }),
      ]),
    );
    expect(recoveredRuntime.prompts[0]).toContain("investigacao-1");
    expect(recoveredRuntime.prompts[0]).toContain("duvida-1");
    await recovered.decide({
      sessionId: SESSION_ID,
      questionId: "duvida-1",
      answer: "Só web",
    });
    expect(recoveredStore.listRefinementItems(SESSION_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "duvida-1", status: "resolvido" }),
      ]),
    );
  });

  it("should refuse to resume a ceremony that already ended", async () => {
    const { ceremony, store } = ceremonyWith([]);
    await start(ceremony);
    store.finishSession(SESSION_ID, { status: "encerrada" });

    await expect(ceremony.resume(SESSION_ID)).rejects.toThrow(/encerrada/i);
  });
});

describe("consult", () => {
  const factAnswer = (citations: unknown): AgentEvent => ({
    type: "message",
    text: `\`\`\`json\n${JSON.stringify({
      kind: "fact",
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
      timeZone: "UTC",
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
    const { ceremony, store } = await grilling([
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
    expect(store.listRefinementItems(SESSION_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "duvida-1",
          status: "resolvido",
          resolution: expect.objectContaining({ kind: "fato" }),
        }),
      ]),
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

  it("should queue a classified room choice behind the active question", async () => {
    const roomChoice: AgentEvent = {
      type: "message",
      text: `\`\`\`json\n${JSON.stringify({
        kind: "room-choice",
        question: "O rollout inclui o app mobile?",
        recommendation: "Começar pela web.",
        evidence: ["core-api · src/order.ts"],
        options: [{ label: "Só web", description: "Menor risco inicial." }],
        allowFreeText: true,
      })}\n\`\`\``,
    };
    const { ceremony, store } = await grilling([roomChoice, TURN_DONE]);

    ceremony.consult({ sessionId: SESSION_ID, question: "Isto vale no app também?" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.consultation?.status).toBe("precisa-sala"),
    );
    expect(ceremony.palco(SESSION_ID)?.current).toMatchObject({
      phase: "perguntando",
      question: { id: "q1" },
    });
    expect(store.listOpenQuestions(SESSION_ID)).toEqual([
      expect.objectContaining({ id: "q1" }),
      expect.objectContaining({ id: "duvida-1", agendaItemId: "duvida-1" }),
    ]);
    expect(store.listRefinementItems(SESSION_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "duvida-1", status: "aguardando-sala" }),
      ]),
    );
  });

  it("should refuse a queued room choice until the current question is answered", async () => {
    const roomChoice: AgentEvent = {
      type: "message",
      text: `\`\`\`json\n${JSON.stringify({
        kind: "room-choice",
        question: "O rollout inclui o app mobile?",
        recommendation: "Começar pela web.",
        evidence: ["core-api · src/order.ts"],
        options: [{ label: "Só web", description: "Menor risco inicial." }],
        allowFreeText: true,
      })}\n\`\`\``,
    };
    const { ceremony, store } = await grilling([roomChoice, TURN_DONE]);
    ceremony.consult({ sessionId: SESSION_ID, question: "Isto vale no app também?" });
    await vi.waitFor(() => expect(store.listOpenQuestions(SESSION_ID)).toHaveLength(2));

    await expect(
      ceremony.decide({
        sessionId: SESSION_ID,
        questionId: "duvida-1",
        answer: "Só web",
      }),
    ).rejects.toThrow(/pergunta atual/i);

    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Regra bancária" });
    expect(store.currentQuestion(SESSION_ID)?.id).toBe("duvida-1");
    await ceremony.decide({
      sessionId: SESSION_ID,
      questionId: "duvida-1",
      answer: "Só web",
    });
    expect(store.listRefinementItems(SESSION_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "duvida-1",
          status: "resolvido",
          resolution: expect.objectContaining({ kind: "escolha", answer: "Só web" }),
        }),
      ]),
    );
  });

  it("should mark an answer whose citation does not exist as unsustained", async () => {
    const { ceremony, store } = await grilling([
      factAnswer([{ repo: "core-api", path: "src/inventado.ts" }]),
      TURN_DONE,
    ]);

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.consultation).toMatchObject({ status: "sem-lastro" }),
    );
    expect(store.listRefinementItems(SESSION_ID)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "duvida-1", status: "aberto" })]),
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
    expect(store.listRefinementItems(SESSION_ID)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "duvida-1", status: "aberto" })]),
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

  it("should catch and log a later agenda transition failure", async () => {
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
    const ceremony = createCeremony({
      runtime: fake.runtime,
      store,
      repos,
      logger: createLogger({ destination, level: "info" }),
    });
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));
    const transition = store.transitionRefinementItem.bind(store);
    let doubtTransitions = 0;
    store.transitionRefinementItem = (input) => {
      if (input.itemId === "duvida-1" && ++doubtTransitions === 2) {
        throw new Error("revisão concorrente");
      }
      return transition(input);
    };

    ceremony.consult({ sessionId: SESSION_ID, question: "Quem chama o createOrder?" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.consultation?.status).toBe("respondida"),
    );
    await vi.waitFor(() =>
      expect(lines).toContainEqual(
        expect.objectContaining({
          msg: "não foi possível atualizar a Agenda depois da consulta",
          sessionId: SESSION_ID,
        }),
      ),
    );
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
    const { ceremony, store } = ceremonyWith([]);
    await start(ceremony);
    store.finishSession(SESSION_ID, { status: "encerrada" });

    expect(() => ceremony.consult({ sessionId: SESSION_ID, question: "e aí?" })).toThrow(
      /encerrada/i,
    );
  });
});

describe("palco", () => {
  it("should keep repeated agent ids distinct with the persisted question sequence", async () => {
    const { ceremony, store } = ceremonyWith([
      [{ type: "ask", questions: [agentQuestion({ id: "q1" })] }],
      [
        {
          type: "ask",
          questions: [agentQuestion({ id: "q1", agendaItemId: "sala-2" })],
        },
      ],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));

    store.seedRefinementItems(SESSION_ID, [{ id: "sala-2", question: "E o segundo contexto?" }]);
    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Sim" });
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.live).toBe(false));
    await ceremony.resume(SESSION_ID);

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)).toMatchObject({
        decisions: [{ questionId: "q1", questionSeq: 1 }],
        pendingQuestions: [{ id: "q1", questionSeq: 2 }],
      }),
    );
  });

  it("should expose unanswered questions as pending work for the room", async () => {
    const { ceremony } = ceremonyWith([[{ type: "ask", questions: [agentQuestion()] }]]);
    await start(ceremony);

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)?.pending).toEqual([
        { id: "q1", question: "A comissão arredonda para cima?" },
      ]),
    );
  });

  it("should count the decisions and keep the last one for the stage", async () => {
    const { ceremony, store } = ceremonyWith([
      [
        { type: "ask", questions: [agentQuestion({ id: "q1" })] },
        {
          type: "ask",
          questions: [agentQuestion({ id: "q2", agendaItemId: "sala-2" })],
        },
      ],
    ]);
    await start(ceremony);
    await vi.waitFor(() => expect(ceremony.palco(SESSION_ID)?.current.phase).toBe("perguntando"));
    store.seedRefinementItems(SESSION_ID, [{ id: "sala-2", question: "E o segundo contexto?" }]);
    await ceremony.decide({ sessionId: SESSION_ID, questionId: "q1", answer: "Sim" });

    await vi.waitFor(() =>
      expect(ceremony.palco(SESSION_ID)).toMatchObject({
        decisionCount: 1,
        lastDecision: { answer: "Sim" },
        decisions: [{ questionId: "q1", answer: "Sim" }],
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
