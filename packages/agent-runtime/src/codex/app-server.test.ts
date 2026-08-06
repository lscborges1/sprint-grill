import { describe, expect, it } from "vitest";
import { AgentRuntimeError } from "../types";
import type { ServerRequest } from "./app-server";
import { connectAppServer } from "./app-server";
import type { FakeScript } from "../testing/fake-app-server";
import {
  createTestLogger,
  fakeAppServerCommand,
  readTranscript,
  transcriptPath,
} from "../testing/fake-app-server";

interface Recorded {
  readonly notifications: { method: string; params: unknown }[];
  readonly serverRequests: ServerRequest[];
  readonly closes: (AgentRuntimeError | null)[];
}

async function connectToFake(script: FakeScript, transcript?: string) {
  const recorded: Recorded = { notifications: [], serverRequests: [], closes: [] };
  const { logger, lines } = createTestLogger();

  const client = await connectAppServer({
    logger,
    command: fakeAppServerCommand(script, transcript),
    onNotification: (method, params) => recorded.notifications.push({ method, params }),
    onServerRequest: (request) => recorded.serverRequests.push(request),
    onClose: (error) => recorded.closes.push(error),
  });

  return { client, recorded, lines };
}

/** Espera até `predicate` valer, para não depender de tempo de processo. */
async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condição não aconteceu a tempo");
}

/**
 * Deixa um request do servidor sem resposta e mata o processo: é a corrida real
 * em que a linha vem bufferizada no stdout e só é lida depois do `exit`.
 */
async function connectWithDeadServer() {
  const context = await connectToFake({
    reactions: {
      "thread/start": {
        result: {},
        emit: [{ request: { method: "item/tool/requestUserInput", params: {} } }],
      },
      "turn/start": { result: {}, emit: [{ exit: 1 }] },
    },
  });

  await context.client.request("thread/start", {});
  await eventually(() => context.recorded.serverRequests.length > 0);
  await context.client.request("turn/start", {});
  await eventually(() => context.recorded.closes.length > 0);

  return { ...context, serverRequestId: context.recorded.serverRequests[0]!.id };
}

describe("connectAppServer", () => {
  it("should complete the initialize handshake before resolving", async () => {
    const transcript = transcriptPath();
    const { client } = await connectToFake({ reactions: {} }, transcript);
    await eventually(() => readTranscript(transcript).length === 2);

    await client.close();

    expect(readTranscript(transcript).map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
    ]);
  });

  it("should announce itself as sprint-griller with experimental methods enabled", async () => {
    const transcript = transcriptPath();
    const { client } = await connectToFake({ reactions: {} }, transcript);
    await eventually(() => readTranscript(transcript).length > 0);

    await client.close();

    expect(readTranscript(transcript)[0]).toMatchObject({
      method: "initialize",
      params: {
        clientInfo: { name: "sprint-griller" },
        capabilities: { experimentalApi: true },
      },
    });
  });

  it("should resolve a request with the result the server sent", async () => {
    const { client } = await connectToFake({
      reactions: { "thread/start": { result: { thread: { id: "t-1" } } } },
    });

    await expect(client.request("thread/start", {})).resolves.toEqual({ thread: { id: "t-1" } });

    await client.close();
  });

  it("should reject with the server message when a request fails", async () => {
    const { client } = await connectToFake({
      reactions: { "turn/start": { error: { message: "thread desconhecida" } } },
    });

    await expect(client.request("turn/start", {})).rejects.toThrowError(/thread desconhecida/);

    await client.close();
  });

  it("should hand notifications to the caller", async () => {
    const { client, recorded } = await connectToFake({
      reactions: {
        "thread/start": {
          result: {},
          emit: [{ notify: { method: "turn/started", params: { turnId: "turn-1" } } }],
        },
      },
    });

    await client.request("thread/start", {});
    await eventually(() => recorded.notifications.length > 0);

    expect(recorded.notifications[0]).toEqual({
      method: "turn/started",
      params: { turnId: "turn-1" },
    });

    await client.close();
  });

  it("should hand server requests to the caller and send the reply back", async () => {
    const transcript = transcriptPath();
    const { client, recorded } = await connectToFake(
      {
        reactions: {
          "turn/start": {
            result: {},
            emit: [{ request: { method: "item/tool/requestUserInput", params: { turnId: "t" } } }],
          },
        },
      },
      transcript,
    );

    await client.request("turn/start", {});
    await eventually(() => recorded.serverRequests.length > 0);

    const [serverRequest] = recorded.serverRequests;
    expect(serverRequest?.method).toBe("item/tool/requestUserInput");

    client.respond(serverRequest!.id, { answers: {} });
    await eventually(() =>
      readTranscript(transcript).some((message) => message.id === serverRequest!.id),
    );

    await client.close();
  });

  it("should ignore an unparseable line instead of crashing", async () => {
    const { client, recorded } = await connectToFake({
      reactions: {
        "thread/start": {
          result: {},
          emit: [
            { raw: "isto não é json" },
            { notify: { method: "turn/started", params: {} } },
          ],
        },
      },
    });

    await client.request("thread/start", {});
    await eventually(() => recorded.notifications.length > 0);

    expect(recorded.notifications).toHaveLength(1);

    await client.close();
  });

  it("should reject in-flight requests when the app-server dies", async () => {
    const { client, recorded } = await connectToFake({
      reactions: {
        "thread/start": { result: {}, emit: [{ exit: 1 }] },
        "turn/start": { result: {} },
      },
    });

    await client.request("thread/start", {});
    await eventually(() => recorded.closes.length > 0);

    await expect(client.request("turn/start", {})).rejects.toThrowError(
      /encerrou inesperadamente/,
    );
    expect(recorded.closes[0]).toBeInstanceOf(AgentRuntimeError);
  });

  it("should report a clean close as expected instead of as a failure", async () => {
    const { client, recorded } = await connectToFake({ reactions: {} });

    await client.close();

    expect(recorded.closes).toEqual([null]);
  });

  it("should drop the reply instead of throwing when the app-server has already exited", async () => {
    const { client, serverRequestId } = await connectWithDeadServer();

    expect(() => client.respond(serverRequestId, { answers: {} })).not.toThrow();
  });

  it("should drop the refusal instead of throwing when the app-server has already exited", async () => {
    const { client, serverRequestId } = await connectWithDeadServer();

    expect(() => client.respondError(serverRequestId, "não tratamos isto")).not.toThrow();
  });

  it("should log the dropped reply with the request id", async () => {
    const { client, lines, serverRequestId } = await connectWithDeadServer();

    client.respond(serverRequestId, { answers: {} });

    expect(lines).toContainEqual(
      expect.objectContaining({
        requestId: serverRequestId,
        msg: "resposta ao app-server descartada",
      }),
    );
  });

  it("should point at the PATH when the codex binary is missing", async () => {
    const { logger } = createTestLogger();

    await expect(
      connectAppServer({
        logger,
        command: ["codex-que-nao-existe", "app-server"],
        onNotification: () => {},
        onServerRequest: () => {},
        onClose: () => {},
      }),
    ).rejects.toThrowError(/PATH/);
  });
});
