/**
 * Harness de demo do `agent-runtime`: fala com o `codex app-server` de verdade,
 * usando o login ChatGPT do Operador. Não roda nos testes — é o que se usa para
 * ver o streaming, o HITL e o resume funcionando de ponta a ponta.
 *
 *   pnpm --filter @sprint-griller/agent-runtime harness "<prompt>"
 *   pnpm --filter @sprint-griller/agent-runtime harness --resume <sessionId> "<prompt>"
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { createLogger } from "@sprint-griller/core";
import { AgentRuntimeError, createAgentRuntime } from "../src/index";
import type { AgentEvent, AgentQuestion, AgentSession } from "../src/index";

const terminal = createInterface({ input: stdin, output: stdout });

async function main(): Promise<void> {
  const { sessionId, prompt } = parseArguments(process.argv.slice(2));

  const runtime = await createAgentRuntime({
    cwd: process.cwd(),
    logger: createLogger({ name: "agent-runtime" }),
  });

  try {
    const session = sessionId
      ? await runtime.resumeSession(sessionId)
      : await runtime.startSession();

    stdout.write(`\n── sessão ${session.id} ──\n\n`);
    await streamTurn(session, prompt);
    stdout.write(`\n\n── retome com: --resume ${session.id} ──\n`);
  } finally {
    await runtime.close();
    terminal.close();
  }
}

async function streamTurn(session: AgentSession, prompt: string): Promise<void> {
  for await (const event of session.send(prompt)) {
    await render(event);
  }
}

async function render(event: AgentEvent): Promise<void> {
  switch (event.type) {
    case "message-delta":
      stdout.write(event.text);
      return;

    case "message":
      stdout.write("\n");
      return;

    case "question": {
      const answers: Record<string, string[]> = {};
      for (const question of event.question.questions) {
        answers[question.id] = [await ask(question)];
      }
      await event.question.answer(answers);
      return;
    }

    case "approval": {
      stdout.write(`\n\n🔐 ${event.approval.kind}: ${event.approval.summary}\n`);
      if (event.approval.reason) stdout.write(`   motivo: ${event.approval.reason}\n`);
      const reply = await terminal.question("   aprovar? [s/N/sessão] ");
      await event.approval.decide(
        reply.startsWith("se") ? "accept-for-session" : reply.startsWith("s") ? "accept" : "decline",
      );
      return;
    }

    case "turn-completed":
      stdout.write(`\n\n✅ turno ${event.turn.status} em ${event.turn.durationMs ?? "?"}ms\n`);
      return;

    case "turn-failed":
      stdout.write(`\n\n❌ ${event.error.message}\n`);
      return;
  }
}

async function ask(question: AgentQuestion): Promise<string> {
  stdout.write(`\n\n❓ ${question.header}: ${question.question}\n`);
  question.options.forEach((option, index) => {
    stdout.write(`   ${index + 1}. ${option.label} — ${option.description}\n`);
  });

  const reply = await terminal.question("   > ");
  const chosen = question.options[Number(reply) - 1];
  return chosen ? chosen.label : reply;
}

function parseArguments(argv: readonly string[]): { sessionId?: string; prompt: string } {
  const resumeAt = argv.indexOf("--resume");
  if (resumeAt === -1) {
    return { prompt: requirePrompt(argv.join(" ")) };
  }

  const sessionId = argv[resumeAt + 1];
  if (!sessionId) throw new AgentRuntimeError("--resume precisa do id da sessão.");

  const rest = [...argv.slice(0, resumeAt), ...argv.slice(resumeAt + 2)];
  return { sessionId, prompt: requirePrompt(rest.join(" ")) };
}

function requirePrompt(prompt: string): string {
  if (prompt.trim() === "") {
    throw new AgentRuntimeError(
      'informe o prompt: pnpm --filter @sprint-griller/agent-runtime harness "<prompt>"',
    );
  }
  return prompt;
}

await main();
