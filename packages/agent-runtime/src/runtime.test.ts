import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "./runtime";
import type { FakeEmission, FakeReaction, FakeScript } from "./testing/fake-app-server";
import {
  createTestLogger,
  fakeAppServerCommand,
  readTranscript,
  transcriptPath,
} from "./testing/fake-app-server";
import type { AgentEvent } from "./types";

const THREAD_ID = "thread-1";
const TURN_ID = "turn-1";
const NEXT_TURN_ID = "turn-2";

function notify(method: string, params: Record<string, unknown>): FakeEmission {
  return { notify: { method, params: { threadId: THREAD_ID, turnId: TURN_ID, ...params } } };
}

function serverRequest(method: string, params: Record<string, unknown>): FakeEmission {
  return { request: { method, params: { threadId: THREAD_ID, turnId: TURN_ID, ...params } } };
}

const turnCompleted = notify("turn/completed", {
  turn: { id: TURN_ID, status: "completed", durationMs: 42 },
});

function scriptWith(
  emit: readonly FakeEmission[],
  interruptEmit: readonly FakeEmission[] = [],
): FakeScript {
  return {
    reactions: {
      "thread/start": { result: { thread: { id: THREAD_ID } } },
      "thread/resume": { result: { thread: { id: THREAD_ID } } },
      "turn/start": { result: { turn: { id: TURN_ID } }, emit },
      "turn/interrupt": { result: {}, emit: interruptEmit },
    },
  };
}

/** Dois turnos na mesma sessão, com ids distintos — como o codex os gera. */
function twoTurnScript(
  first: readonly FakeEmission[],
  second: readonly FakeEmission[],
  interrupt: FakeReaction,
): FakeScript {
  return {
    reactions: {
      "thread/start": { result: { thread: { id: THREAD_ID } } },
      "turn/start": [
        { result: { turn: { id: TURN_ID } }, emit: first },
        { result: { turn: { id: NEXT_TURN_ID } }, emit: second },
      ],
      "turn/interrupt": interrupt,
    },
  };
}

async function runtimeWith(script: FakeScript, transcript?: string) {
  const { logger, lines } = createTestLogger();
  const runtime = await createAgentRuntime({
    cwd: process.cwd(),
    logger,
    command: fakeAppServerCommand(script, transcript),
  });
  return { runtime, lines };
}

/** Consome o turno inteiro, respondendo a tudo que o agente pedir. */
async function drain(
  events: AsyncIterable<AgentEvent>,
  answers: Readonly<Record<string, readonly string[]>> = {},
): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) {
    collected.push(event);
    if (event.type === "question") await event.question.answer(answers);
    if (event.type === "approval") await event.approval.decide("accept-for-session");
  }
  return collected;
}

function responsesIn(transcript: string): Record<string, unknown>[] {
  return readTranscript(transcript)
    .filter((message) => message.result !== undefined)
    .map((message) => message.result as Record<string, unknown>);
}

describe("createAgentRuntime", () => {
  it("should expose the session id when a session starts", async () => {
    const { runtime } = await runtimeWith(scriptWith([turnCompleted]));

    const session = await runtime.startSession();

    expect(session.id).toBe(THREAD_ID);
    await runtime.close();
  });

  it("should stream deltas, the final message and the completed turn", async () => {
    const { runtime } = await runtimeWith(
      scriptWith([
        notify("item/agentMessage/delta", { delta: "cache " }),
        notify("item/agentMessage/delta", { delta: "invalida" }),
        notify("item/completed", { item: { type: "agentMessage", text: "cache invalida" } }),
        turnCompleted,
      ]),
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("como funciona o cache?"));

    expect(events).toEqual([
      { type: "message-delta", text: "cache " },
      { type: "message-delta", text: "invalida" },
      { type: "message", text: "cache invalida" },
      { type: "turn-completed", turn: { id: TURN_ID, status: "completed", durationMs: 42 } },
    ]);
    await runtime.close();
  });

  it("should surface a native requestUserInput question and unblock the turn once answered", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/tool/requestUserInput", {
          itemId: "item-1",
          questions: [
            {
              id: "q1",
              header: "Invalidação",
              question: "Quando o cache invalida?",
              isOther: true,
              isSecret: false,
              options: [{ label: "Na escrita", description: "Invalida ao salvar" }],
            },
          ],
        }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("investigue"), { q1: ["Na escrita"] });

    expect(events[0]).toMatchObject({
      type: "question",
      question: {
        questions: [
          {
            id: "q1",
            header: "Invalidação",
            question: "Quando o cache invalida?",
            allowFreeText: true,
            options: [{ label: "Na escrita", description: "Invalida ao salvar" }],
            // O HITL nativo não tem onde carregar recomendação: quem exibe decide o que fazer.
            recommendation: null,
            evidence: [],
          },
        ],
      },
    });
    expect(events.at(-1)).toMatchObject({ type: "turn-completed" });
    expect(responsesIn(transcript)).toContainEqual({
      answers: { q1: { answers: ["Na escrita"] } },
    });
    await runtime.close();
  });

  it("should surface an ask_operator question and hand the answers back to the agent", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/tool/call", {
          callId: "call-1",
          tool: "ask_operator",
          arguments: {
            questions: [
              {
                id: "q1",
                header: "Escopo",
                question: "Vale para o app mobile?",
                recommendation: "Só web: o mobile não consome esse endpoint.",
                evidence: ["core-api · src/routes/commissions.ts"],
              },
            ],
          },
        }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("investigue"), { q1: ["Não, só web"] });

    expect(events[0]).toMatchObject({
      type: "question",
      question: {
        questions: [
          {
            id: "q1",
            header: "Escopo",
            allowFreeText: true,
            recommendation: "Só web: o mobile não consome esse endpoint.",
            evidence: ["core-api · src/routes/commissions.ts"],
          },
        ],
      },
    });
    expect(responsesIn(transcript)).toContainEqual({
      success: true,
      contentItems: [
        { type: "inputText", text: expect.stringContaining("Não, só web") as unknown as string },
      ],
    });
    await runtime.close();
  });

  it("should refuse an ask_operator question that comes with no recommendation", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/tool/call", {
          callId: "call-1",
          tool: "ask_operator",
          arguments: {
            questions: [
              {
                id: "q1",
                header: "Cache",
                question: "Onde o cache invalida?",
                evidence: ["core-api · src/cache.ts"],
              },
            ],
          },
        }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("grelhe"));

    // Pergunta sem recomendação é fato disfarçado: não chega na sala.
    expect(events.some((event) => event.type === "question")).toBe(false);
    expect(responsesIn(transcript)).toContainEqual({
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: expect.stringContaining("recommendation") as unknown as string,
        },
      ],
    });
    await runtime.close();
  });

  it("should refuse an ask_operator question that comes with no evidence", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/tool/call", {
          callId: "call-1",
          tool: "ask_operator",
          arguments: {
            questions: [
              {
                id: "q1",
                header: "Cache",
                question: "Onde o cache invalida?",
                recommendation: "Na escrita.",
                evidence: [],
              },
            ],
          },
        }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("grelhe"));

    expect(events.some((event) => event.type === "question")).toBe(false);
    expect(responsesIn(transcript)).toContainEqual({
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: expect.stringContaining("evidence") as unknown as string,
        },
      ],
    });
    await runtime.close();
  });

  it("should refuse a tool the runtime never declared", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/tool/call", {
          callId: "call-1",
          tool: "deploy_para_producao",
          arguments: {},
        }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("investigue"));

    expect(events.some((event) => event.type === "question")).toBe(false);
    expect(responsesIn(transcript)).toContainEqual({
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: expect.stringContaining("deploy_para_producao") as unknown as string,
        },
      ],
    });
    await runtime.close();
  });

  it("should surface an approval and send the decision back", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/commandExecution/requestApproval", {
          itemId: "item-1",
          startedAtMs: 1,
          command: "rg 'cache' src",
          reason: "precisa de acesso à rede",
        }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("investigue"));

    expect(events[0]).toMatchObject({
      type: "approval",
      approval: {
        kind: "command",
        summary: "rg 'cache' src",
        reason: "precisa de acesso à rede",
      },
    });
    expect(responsesIn(transcript)).toContainEqual({ decision: "acceptForSession" });
    await runtime.close();
  });

  it("should surface a file-change approval with the reason the agent gave", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/fileChange/requestApproval", {
          itemId: "item-1",
          startedAtMs: 1,
          reason: "precisa gravar a spec no repo",
          grantRoot: "/repo/docs",
        }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("investigue"));

    expect(events[0]).toMatchObject({
      type: "approval",
      approval: {
        kind: "file-change",
        summary: "/repo/docs",
        reason: "precisa gravar a spec no repo",
      },
    });
    await runtime.close();
  });

  it("should refuse a server request it has no answer for instead of faking one", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/permissions/requestApproval", { itemId: "item-1", startedAtMs: 1 }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    await drain(session.send("investigue"));

    expect(readTranscript(transcript)).toContainEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining("item/permissions/requestApproval") as unknown as string,
        }) as unknown as Record<string, unknown>,
      }),
    );
    await runtime.close();
  });

  it("should decline a question that arrives with no turn running", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      {
        reactions: {
          "thread/start": {
            result: { thread: { id: THREAD_ID } },
            emit: [
              serverRequest("item/tool/requestUserInput", {
                itemId: "item-1",
                questions: [{ id: "q1", header: "Escopo", question: "Só web?", isOther: true }],
              }),
            ],
          },
        },
      },
      transcript,
    );

    await runtime.startSession();
    await expect
      .poll(() => responsesIn(transcript))
      .toContainEqual({ answers: {} });

    await runtime.close();
  });

  it("should interrupt the running turn", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([notify("item/agentMessage/delta", { delta: "em andamento" })]),
      transcript,
    );
    const session = await runtime.startSession();

    const running = session.send("investigue");
    const iterator = running[Symbol.asyncIterator]();
    await iterator.next();
    await session.interrupt();

    await iterator.return?.(undefined);
    expect(
      readTranscript(transcript).filter((message) => message.method === "turn/interrupt"),
    ).toEqual([
      expect.objectContaining({
        params: { threadId: THREAD_ID, turnId: TURN_ID },
      }),
    ]);
    await runtime.close();
  });

  it("should interrupt when cancellation is requested before turn/start returns", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([], [notify("turn/completed", { turn: { id: TURN_ID, status: "interrupted" } })]),
      transcript,
    );
    const session = await runtime.startSession();

    const iterator = session.send("investigue")[Symbol.asyncIterator]();
    const firstEvent = iterator.next();
    await session.interrupt();

    expect(readTranscript(transcript)).toContainEqual(
      expect.objectContaining({
        method: "turn/interrupt",
        params: { threadId: THREAD_ID, turnId: TURN_ID },
      }),
    );
    await expect(firstEvent).resolves.toMatchObject({
      value: { type: "turn-completed", turn: { status: "interrupted" } },
    });

    await runtime.close();
  });

  it("should interrupt an abandoned turn before starting the next one", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      twoTurnScript(
        [notify("item/agentMessage/delta", { delta: "em andamento" })],
        [notify("item/agentMessage/delta", { turnId: NEXT_TURN_ID, delta: "em andamento" })],
        { result: {} },
      ),
      transcript,
    );
    const session = await runtime.startSession();

    const first = session.send("primeiro")[Symbol.asyncIterator]();
    await first.next();
    await first.return?.(undefined);

    const second = session.send("segundo")[Symbol.asyncIterator]();
    await second.next();
    await second.return?.(undefined);

    expect(
      readTranscript(transcript)
        .map((message) => message.method)
        .filter((method) => method === "turn/start" || method === "turn/interrupt"),
    ).toEqual(["turn/start", "turn/interrupt", "turn/start", "turn/interrupt"]);

    await runtime.close();
  });

  it("should release an abandoned turn when its interrupt fails", async () => {
    const { runtime } = await runtimeWith(
      twoTurnScript(
        [notify("item/agentMessage/delta", { delta: "em andamento" })],
        [notify("item/agentMessage/delta", { turnId: NEXT_TURN_ID, delta: "em andamento" })],
        { error: { message: "interrupção indisponível" } },
      ),
    );
    const session = await runtime.startSession();

    const first = session.send("primeiro")[Symbol.asyncIterator]();
    await first.next();
    await expect(first.return!(undefined)).rejects.toThrowError(/interrupção indisponível/);

    const second = session.send("segundo")[Symbol.asyncIterator]();
    await expect(second.next()).resolves.toMatchObject({
      value: { type: "message-delta", text: "em andamento" },
    });
    await expect(second.return!(undefined)).rejects.toThrowError(/interrupção indisponível/);

    await runtime.close();
  });

  it("should ignore a turn/completed that arrives late from an abandoned turn", async () => {
    const { runtime } = await runtimeWith(
      twoTurnScript(
        [notify("item/agentMessage/delta", { delta: "em andamento" })],
        [
          // Rastro do turno abandonado: o codex só o conclui depois que o
          // próximo já começou.
          notify("turn/completed", { turn: { id: TURN_ID, status: "interrupted" } }),
          notify("item/completed", {
            turnId: NEXT_TURN_ID,
            item: { type: "agentMessage", text: "segundo" },
          }),
          notify("turn/completed", {
            turnId: NEXT_TURN_ID,
            turn: { id: NEXT_TURN_ID, status: "completed", durationMs: 7 },
          }),
        ],
        { result: {} },
      ),
    );
    const session = await runtime.startSession();

    const first = session.send("primeiro")[Symbol.asyncIterator]();
    await first.next();
    await first.return?.(undefined);

    const events = await drain(session.send("segundo"));

    expect(events).toEqual([
      { type: "message", text: "segundo" },
      { type: "turn-completed", turn: { id: NEXT_TURN_ID, status: "completed", durationMs: 7 } },
    ]);
    await runtime.close();
  });

  it("should ignore an error that arrives late from an abandoned turn", async () => {
    const { runtime } = await runtimeWith(
      twoTurnScript(
        [notify("item/agentMessage/delta", { delta: "em andamento" })],
        [
          notify("error", {
            turnId: TURN_ID,
            error: { message: "modelo indisponível" },
            willRetry: false,
          }),
          notify("item/completed", {
            turnId: NEXT_TURN_ID,
            item: { type: "agentMessage", text: "segundo" },
          }),
          notify("turn/completed", {
            turnId: NEXT_TURN_ID,
            turn: { id: NEXT_TURN_ID, status: "completed", durationMs: 7 },
          }),
        ],
        // A interrupção falhar é o que solta a sessão com o turno anterior vivo.
        { error: { message: "interrupção indisponível" } },
      ),
    );
    const session = await runtime.startSession();

    const first = session.send("primeiro")[Symbol.asyncIterator]();
    await first.next();
    await expect(first.return!(undefined)).rejects.toThrowError(/interrupção indisponível/);

    const events = await drain(session.send("segundo"));

    expect(events.map((event) => event.type)).toEqual(["message", "turn-completed"]);
    await runtime.close();
  });

  it("should reject answering the same question twice", async () => {
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/tool/requestUserInput", {
          itemId: "item-1",
          questions: [{ id: "q1", header: "Escopo", question: "Só web?", isOther: true }],
        }),
        turnCompleted,
      ]),
    );
    const session = await runtime.startSession();

    for await (const event of session.send("investigue")) {
      if (event.type !== "question") continue;
      await event.question.answer({ q1: ["sim"] });
      await expect(event.question.answer({ q1: ["sim"] })).rejects.toThrowError(/já foi/);
    }

    await runtime.close();
  });

  it("should decline a pending question when the consumer abandons the stream", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(
      scriptWith([
        serverRequest("item/tool/requestUserInput", {
          itemId: "item-1",
          questions: [{ id: "q1", header: "Escopo", question: "Só web?", isOther: true }],
        }),
        turnCompleted,
      ]),
      transcript,
    );
    const session = await runtime.startSession();

    for await (const event of session.send("investigue")) {
      if (event.type === "question") break;
    }

    await expect.poll(() => responsesIn(transcript)).toContainEqual({ answers: {} });
    await runtime.close();
  });

  it("should end the turn as failed when the agent reports an unrecoverable error", async () => {
    const { runtime } = await runtimeWith(
      scriptWith([
        notify("error", { error: { message: "modelo indisponível" }, willRetry: false }),
      ]),
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("investigue"));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "turn-failed",
      error: expect.objectContaining({ message: "modelo indisponível" }),
    });
    await runtime.close();
  });

  it("should keep streaming when the agent reports a retriable error", async () => {
    const { runtime } = await runtimeWith(
      scriptWith([
        notify("error", { error: { message: "429" }, willRetry: true }),
        notify("item/completed", { item: { type: "agentMessage", text: "pronto" } }),
        turnCompleted,
      ]),
    );
    const session = await runtime.startSession();

    const events = await drain(session.send("investigue"));

    expect(events.map((event) => event.type)).toEqual(["message", "turn-completed"]);
    await runtime.close();
  });

  it("should fail the running turn when the app-server dies", async () => {
    const { runtime } = await runtimeWith(scriptWith([{ exit: 1 }]));
    const session = await runtime.startSession();

    const events = await drain(session.send("investigue"));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "turn-failed" });
  });

  it("should resume an existing session keeping its id", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(scriptWith([turnCompleted]), transcript);

    const session = await runtime.resumeSession(THREAD_ID);
    await drain(session.send("e o que ficou pendente?"));

    expect(session.id).toBe(THREAD_ID);
    expect(readTranscript(transcript)).toContainEqual(
      expect.objectContaining({
        method: "thread/resume",
        params: { threadId: THREAD_ID, excludeTurns: true },
      }),
    );
    await runtime.close();
  });

  it("should declare ask_operator and a read-only sandbox when starting a session", async () => {
    const transcript = transcriptPath();
    const { runtime } = await runtimeWith(scriptWith([turnCompleted]), transcript);

    await runtime.startSession({ instructions: "você investiga User Stories" });

    expect(
      readTranscript(transcript).find((message) => message.method === "thread/start"),
    ).toMatchObject({
      params: {
        sandbox: "read-only",
        developerInstructions: "você investiga User Stories",
        dynamicTools: [{ name: "ask_operator" }],
      },
    });
    await runtime.close();
  });

  it("should log the session and the turn as structured lines", async () => {
    const { runtime, lines } = await runtimeWith(
      scriptWith([
        serverRequest("item/tool/requestUserInput", {
          itemId: "item-1",
          questions: [{ id: "q1", header: "Escopo", question: "Só web?", isOther: true }],
        }),
        turnCompleted,
      ]),
    );
    const session = await runtime.startSession();

    await drain(session.send("investigue"), { q1: ["sim"] });

    expect(lines).toContainEqual(
      expect.objectContaining({ name: "agent-runtime", sessionId: THREAD_ID, msg: "turno iniciado", turnId: TURN_ID }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ msg: "agente pediu input ao humano", sessionId: THREAD_ID }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ msg: "turno concluído", turnId: TURN_ID, durationMs: 42 }),
    );
    await runtime.close();
  });

  it("should refuse a second turn while one is already running", async () => {
    const { runtime } = await runtimeWith(scriptWith([turnCompleted]));
    const session = await runtime.startSession();

    const running = session.send("investigue");
    const iterator = running[Symbol.asyncIterator]();
    await iterator.next();

    await expect(drain(session.send("outra coisa"))).rejects.toThrowError(/turno em andamento/);

    await iterator.return?.(undefined);
    await runtime.close();
  });
});
