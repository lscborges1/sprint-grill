import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  ApprovalDecision,
  StartSessionOptions,
} from "@sprint-griller/agent-runtime";
import { AgentRuntimeError } from "@sprint-griller/agent-runtime";
import { createLogger } from "@sprint-griller/core";
import { afterAll, describe, expect, it } from "vitest";
import { AFK_ANSWER, runInvestigation } from "./investigate";

/** Os testes exercitam a fronteira, não o log — que iria para o stdout do runner. */
const SILENT_LOGGER = createLogger({
  destination: new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }),
  level: "fatal",
});

const root = mkdtempSync(path.join(tmpdir(), "sprint-griller-investigate-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(path.join(root, "core-api", "src"), { recursive: true });
writeFileSync(
  path.join(root, "core-api", "src", "session.ts"),
  "export const SESSION_TTL = 3600;\n",
);

const REPOS = {
  primary: { name: "core-api", path: path.join(root, "core-api") },
  related: [],
};

const STORY = {
  id: 4211,
  title: "TTL de sessão configurável",
  description: "O TTL hoje é fixo.",
  url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
};

function reportMessage(citationPath: string): AgentEvent {
  return {
    type: "message",
    text:
      "```json\n" +
      JSON.stringify({
        summary: "A US mexe no cache de sessão.",
        impacts: [
          {
            claim: "O TTL precisa virar configurável.",
            citations: [{ repo: "core-api", path: citationPath, symbol: "SESSION_TTL" }],
          },
        ],
        unverified: ["O mobile talvez dependa disso."],
      }) +
      "\n```",
  };
}

const TURN_COMPLETED: AgentEvent = {
  type: "turn-completed",
  turn: { id: "turn-1", status: "completed", durationMs: 10 },
};

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
    id: "session-1",
    send(prompt) {
      prompts.push(prompt);
      return (async function* () {
        for (const event of script) {
          yield event;
        }
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

function question(id: string, answers: Record<string, readonly string[]>[]): AgentEvent {
  return {
    type: "question",
    question: {
      questions: [
        {
          id,
          agendaItemId: null,
          header: "Escopo",
          question: "Vale para o mobile?",
          recommendation: null,
          evidence: [],
          options: [],
          allowFreeText: true,
        },
      ],
      answer: async (given) => {
        answers.push(given);
      },
    },
  };
}

function approval(
  kind: "command" | "file-change",
  decisions: { kind: string; decision: ApprovalDecision }[],
): AgentEvent {
  return {
    type: "approval",
    approval: {
      kind,
      summary: "rg SESSION_TTL",
      reason: null,
      decide: async (decision) => {
        decisions.push({ kind, decision });
      },
    },
  };
}

describe("runInvestigation", () => {
  it("should approve a report whose citations all exist on disk", async () => {
    const fake = fakeRuntime([reportMessage("src/session.ts"), TURN_COMPLETED]);

    const outcome = await runInvestigation({
      runtime: fake.runtime,
      story: STORY,
      repos: REPOS,
      logger: SILENT_LOGGER,
    });

    expect(outcome.status).toBe("aprovado");
    expect(outcome.status === "aprovado" && outcome.markdown).toContain(
      "# Investigação — US #4211",
    );
  });

  it("should send the repo instructions and the story prompt to the agent", async () => {
    const fake = fakeRuntime([reportMessage("src/session.ts"), TURN_COMPLETED]);

    await runInvestigation({
      runtime: fake.runtime,
      story: STORY,
      repos: REPOS,
      logger: SILENT_LOGGER,
    });

    expect(fake.instructions[0]).toContain(REPOS.primary.path);
    expect(fake.prompts[0]).toContain("TTL de sessão configurável");
  });

  it("should reject the report when a cited path does not exist", async () => {
    const fake = fakeRuntime([reportMessage("src/inventado.ts"), TURN_COMPLETED]);

    const outcome = await runInvestigation({
      runtime: fake.runtime,
      story: STORY,
      repos: REPOS,
      logger: SILENT_LOGGER,
    });

    expect(outcome).toMatchObject({
      status: "reprovado",
      violations: [{ reason: "caminho-inexistente" }],
    });
  });

  it("should fail when the agent never returns a report", async () => {
    const fake = fakeRuntime([{ type: "message", text: "não achei nada" }, TURN_COMPLETED]);

    const outcome = await runInvestigation({
      runtime: fake.runtime,
      story: STORY,
      repos: REPOS,
      logger: SILENT_LOGGER,
    });

    expect(outcome.status).toBe("falhou");
  });

  it("should fail with the runtime message when the turn breaks", async () => {
    const fake = fakeRuntime([
      { type: "turn-failed", error: new AgentRuntimeError("o codex caiu") },
    ]);

    const outcome = await runInvestigation({
      runtime: fake.runtime,
      story: STORY,
      repos: REPOS,
      logger: SILENT_LOGGER,
    });

    expect(outcome).toMatchObject({ status: "falhou" });
    expect(outcome.status === "falhou" && outcome.message).toContain("o codex caiu");
  });

  it("should answer the agent instead of hanging when nobody is at the screen", async () => {
    const answers: Record<string, readonly string[]>[] = [];
    const fake = fakeRuntime([
      question("q1", answers),
      reportMessage("src/session.ts"),
      TURN_COMPLETED,
    ]);

    await runInvestigation({
      runtime: fake.runtime,
      story: STORY,
      repos: REPOS,
      logger: SILENT_LOGGER,
    });

    expect(answers).toEqual([{ q1: [AFK_ANSWER] }]);
  });

  it("should refuse to leave the read-only sandbox with nobody there to allow it", async () => {
    const decisions: { kind: string; decision: ApprovalDecision }[] = [];
    const fake = fakeRuntime([
      approval("command", decisions),
      approval("file-change", decisions),
      reportMessage("src/session.ts"),
      TURN_COMPLETED,
    ]);

    await runInvestigation({
      runtime: fake.runtime,
      story: STORY,
      repos: REPOS,
      logger: SILENT_LOGGER,
    });

    expect(decisions).toEqual([
      { kind: "command", decision: "decline" },
      { kind: "file-change", decision: "decline" },
    ]);
  });
});
