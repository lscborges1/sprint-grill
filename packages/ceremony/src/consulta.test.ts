import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { AgentRuntimeError } from "@sprint-griller/agent-runtime";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  ApprovalDecision,
  StartSessionOptions,
} from "@sprint-griller/agent-runtime";
import { createLogger } from "@sprint-griller/core";
import { afterAll, describe, expect, it } from "vitest";
import { CONSULTA_SEM_SALA, runConsultation } from "./consulta";

/** Os testes exercitam a fronteira, não o log — que iria para o stdout do runner. */
const SILENT_LOGGER = createLogger({
  destination: new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }),
  level: "fatal",
});

/** Captura as linhas JSON emitidas pelo logger, uma por chamada. */
function captureLines() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  return { lines, destination };
}

const root = mkdtempSync(path.join(tmpdir(), "sprint-griller-consulta-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(path.join(root, "core-api", "src"), { recursive: true });
writeFileSync(path.join(root, "core-api", "src", "order.ts"), "export function createOrder() {}\n");

const REPOS = {
  primary: { name: "core-api", path: path.join(root, "core-api") },
  related: [],
};

const STORY = {
  id: 4242,
  title: "Parcelamento no checkout",
  url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4242",
};

const TURN_COMPLETED: AgentEvent = {
  type: "turn-completed",
  turn: { id: "turn-1", status: "completed", durationMs: 10 },
};

function answerMessage(citations: unknown): AgentEvent {
  return {
    type: "message",
    text: `\`\`\`json\n${JSON.stringify({
      kind: "fact",
      answer: "O createOrder só é chamado pelo checkout.",
      citations,
    })}\n\`\`\``,
  };
}

interface FakeRuntime {
  readonly runtime: AgentRuntime;
  readonly prompts: string[];
  readonly instructions: (string | undefined)[];
}

/** Runtime de mentira: entrega um roteiro de eventos e anota o que recebeu. */
function fakeRuntime(script: readonly AgentEvent[]): FakeRuntime {
  const prompts: string[] = [];
  const instructions: (string | undefined)[] = [];

  const session: AgentSession = {
    id: "consulta-1",
    send(prompt) {
      prompts.push(prompt);
      return (async function* () {
        for (const event of script) yield event;
      })();
    },
    interrupt: async () => undefined,
  };

  return {
    prompts,
    instructions,
    runtime: {
      startSession: async (options: StartSessionOptions = {}) => {
        instructions.push(options.instructions);
        return session;
      },
      resumeSession: async () => session,
      close: async () => undefined,
    },
  };
}

function consult(runtime: AgentRuntime, question = "Quem chama o createOrder?") {
  return runConsultation({
    runtime,
    repos: REPOS,
    story: STORY,
    question,
    logger: SILENT_LOGGER,
  });
}

describe("runConsultation", () => {
  it("should answer with the citations that exist on disk", async () => {
    const fake = fakeRuntime([
      answerMessage([{ repo: "core-api", path: "src/order.ts", symbol: "createOrder" }]),
      TURN_COMPLETED,
    ]);

    const outcome = await consult(fake.runtime);

    expect(outcome).toEqual({
      status: "respondida",
      answer: "O createOrder só é chamado pelo checkout.",
      citations: [{ repo: "core-api", path: "src/order.ts", symbol: "createOrder" }],
    });
  });

  it("should classify a product choice for the room instead of inventing a fact", async () => {
    const fake = fakeRuntime([
      {
        type: "message",
        text: `\`\`\`json\n${JSON.stringify({
          kind: "room-choice",
          question: "O parcelamento também vale no app?",
          recommendation: "Começar pela web para reduzir o risco do rollout.",
          evidence: ["core-api · src/order.ts"],
          options: [{ label: "Só web", description: "Entrega inicial menor." }],
          allowFreeText: true,
        })}\n\`\`\``,
      },
      TURN_COMPLETED,
    ]);

    const outcome = await consult(fake.runtime, "Isto vale no app também?");

    expect(outcome).toEqual({
      status: "precisa-sala",
      question: "O parcelamento também vale no app?",
      recommendation: "Começar pela web para reduzir o risco do rollout.",
      evidence: ["core-api · src/order.ts"],
      options: [{ label: "Só web", description: "Entrega inicial menor." }],
      allowFreeText: true,
    });
  });

  it("should send the repo instructions and the room question to the agent", async () => {
    const fake = fakeRuntime([
      answerMessage([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_COMPLETED,
    ]);

    await consult(fake.runtime, "O contrato já tem campo de parcelas?");

    expect(fake.instructions[0]).toContain(REPOS.primary.path);
    expect(fake.prompts[0]).toContain("O contrato já tem campo de parcelas?");
  });

  it("should refuse to call an answer a fact when the cited file does not exist", async () => {
    const fake = fakeRuntime([
      answerMessage([{ repo: "core-api", path: "src/inventado.ts" }]),
      TURN_COMPLETED,
    ]);

    const outcome = await consult(fake.runtime);

    expect(outcome).toMatchObject({
      status: "sem-lastro",
      answer: "O createOrder só é chamado pelo checkout.",
    });
    expect(outcome.status === "sem-lastro" && outcome.motivo).toContain("src/inventado.ts");
  });

  it("should refuse to call an answer a fact when it cites nothing at all", async () => {
    const fake = fakeRuntime([answerMessage([]), TURN_COMPLETED]);

    const outcome = await consult(fake.runtime);

    expect(outcome).toMatchObject({ status: "sem-lastro" });
    expect(outcome.status === "sem-lastro" && outcome.motivo).toMatch(/sem citar/i);
  });

  it("should keep a readable answer unverified when a citation is malformed", async () => {
    const fake = fakeRuntime([
      answerMessage([{ repo: "core-api" }]),
      TURN_COMPLETED,
    ]);

    const outcome = await consult(fake.runtime);

    expect(outcome).toMatchObject({
      status: "sem-lastro",
      answer: "O createOrder só é chamado pelo checkout.",
      citations: [],
    });
    expect(outcome.status === "sem-lastro" && outcome.motivo).toMatch(/formato inválido/i);
  });

  it("should fail when the agent never returns a readable answer", async () => {
    const fake = fakeRuntime([{ type: "message", text: "não achei nada" }, TURN_COMPLETED]);

    const outcome = await consult(fake.runtime);

    expect(outcome.status).toBe("falhou");
  });

  it("should persist a stable failure message while logging the runtime message", async () => {
    const fake = fakeRuntime([
      { type: "turn-failed", error: new AgentRuntimeError("o codex caiu") },
    ]);

    const { lines, destination } = captureLines();
    const outcome = await runConsultation({
      runtime: fake.runtime,
      repos: REPOS,
      story: STORY,
      question: "Quem chama o createOrder?",
      logger: createLogger({ destination, level: "info" }),
    });

    expect(outcome).toEqual({
      status: "falhou",
      message: "A consulta parou por um erro inesperado.",
    });
    expect(lines).toContainEqual(expect.objectContaining({ reason: "o codex caiu" }));
  });

  it("should send the room back to the stage instead of hanging when the agent asks something", async () => {
    const asked: Record<string, readonly string[]>[] = [];
    const fake = fakeRuntime([
      {
        type: "question",
        question: {
          questions: [
            {
              id: "q1",
              agendaItemId: null,
              header: "Escopo",
              question: "Que repo?",
              recommendation: null,
              evidence: [],
              options: [],
              allowFreeText: true,
            },
          ],
          answer: async (given) => {
            asked.push(given);
          },
        },
      },
      answerMessage([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_COMPLETED,
    ]);

    await consult(fake.runtime);

    expect(asked).toEqual([{ q1: [CONSULTA_SEM_SALA] }]);
  });

  it("should refuse to leave the read-only sandbox", async () => {
    const decided: ApprovalDecision[] = [];
    const fake = fakeRuntime([
      {
        type: "approval",
        approval: {
          kind: "command",
          summary: "rg createOrder",
          reason: null,
          decide: async (decision) => {
            decided.push(decision);
          },
        },
      },
      answerMessage([{ repo: "core-api", path: "src/order.ts" }]),
      TURN_COMPLETED,
    ]);

    await consult(fake.runtime);

    expect(decided).toEqual(["decline"]);
  });

  it("should log question length instead of the raw operator question", async () => {
    const { lines, destination } = captureLines();
    const logger = createLogger({ destination, level: "info" });
    const question = "O CPF 123.456.789-00 já tem parcelas no contrato?";
    const fake = fakeRuntime([
      answerMessage([{ repo: "core-api", path: "src/order.ts", symbol: "createOrder" }]),
      TURN_COMPLETED,
    ]);

    await runConsultation({
      runtime: fake.runtime,
      repos: REPOS,
      story: STORY,
      question,
      logger,
    });

    expect(lines.some((line) => JSON.stringify(line).includes(question))).toBe(false);
    expect(lines.some((line) => line.questionLength === question.length)).toBe(true);
  });
});
