import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Logger } from "@sprint-griller/core";
import { AgentRuntimeError } from "../types";
import type { IncomingMessage, RequestId } from "./protocol";
import { CLIENT_NAME, CLIENT_VERSION, parseIncomingMessage } from "./protocol";

/**
 * O `requestUserInput` nativo vive atrás deste feature flag. Ligar aqui é
 * barato; se a versão instalada do codex não conhecer o flag, o HITL ainda
 * chega pela `ask_operator` (ver `protocol.ts`).
 */
export const DEFAULT_APP_SERVER_COMMAND = [
  "codex",
  "app-server",
  "-c",
  "features.default_mode_request_user_input=true",
] as const satisfies readonly [string, ...string[]];

export interface ServerRequest {
  readonly id: RequestId;
  readonly method: string;
  readonly params: unknown;
}

export interface ConnectAppServerOptions {
  readonly logger: Logger;
  /** Seam de teste: o binário e os argumentos do processo do agente. */
  readonly command?: readonly [string, ...string[]];
  readonly onNotification: (method: string, params: unknown) => void;
  readonly onServerRequest: (request: ServerRequest) => void;
  /** Processo encerrado. `error` é `null` quando foi um `close()` nosso. */
  readonly onClose: (error: AgentRuntimeError | null) => void;
}

export interface AppServerClient {
  request(method: string, params: unknown): Promise<unknown>;
  respond(id: RequestId, result: unknown): void;
  /** Recusa um request do servidor cuja resposta a gente não sabe montar. */
  respondError(id: RequestId, message: string): void;
  close(): Promise<void>;
}

/** JSON-RPC "method not found" — o único código que o cliente precisa emitir. */
const METHOD_NOT_FOUND = -32601;

interface PendingRequest {
  readonly method: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: AgentRuntimeError) => void;
}

/**
 * Cliente JSON-RPC sobre o `codex app-server` (JSONL em stdio). Fino de
 * propósito: não sabe o que é sessão, turno ou pergunta — só entrega mensagens.
 */
export async function connectAppServer(
  options: ConnectAppServerOptions,
): Promise<AppServerClient> {
  const [command, ...args] = options.command ?? DEFAULT_APP_SERVER_COMMAND;
  const { logger } = options;

  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let closing = false;
  let hasExited = false;
  let exitError: AgentRuntimeError | null = null;

  // stdin morre junto com o processo; sem este listener o EPIPE sobe como
  // exceção não tratada e derruba o app inteiro.
  child.stdin.on("error", (error) => {
    logger.debug({ err: error }, "stdin do app-server fechado");
  });

  function send(message: Record<string, unknown>): void {
    if (hasExited) {
      throw exitError ?? new AgentRuntimeError("codex app-server já foi encerrado.");
    }
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      try {
        send({ id, method, params });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  function handleMessage(line: string): void {
    let message: IncomingMessage | null;
    try {
      message = parseIncomingMessage(line);
    } catch (error) {
      logger.warn({ err: error }, "linha ilegível do app-server");
      return;
    }
    if (!message) return;

    switch (message.kind) {
      case "notification":
        options.onNotification(message.method, message.params);
        return;
      case "server-request":
        options.onServerRequest(message);
        return;
      case "response":
      case "error-response": {
        const id = typeof message.id === "number" ? message.id : Number(message.id);
        const waiting = pending.get(id);
        if (!waiting) {
          logger.warn({ requestId: message.id }, "resposta sem request correspondente");
          return;
        }
        pending.delete(id);
        if (message.kind === "response") {
          waiting.resolve(message.result);
        } else {
          waiting.reject(
            new AgentRuntimeError(`codex app-server recusou ${waiting.method}: ${message.message}`),
          );
        }
      }
    }
  }

  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.trim() !== "") handleMessage(line);
  });

  createInterface({ input: child.stderr }).on("line", (line) => {
    logger.debug({ line }, "stderr do app-server");
  });

  const spawnFailed = new Promise<never>((_resolve, reject) => {
    child.on("error", (error) => {
      reject(
        new AgentRuntimeError(
          `não foi possível iniciar \`${command}\`. Instale o Codex CLI e garanta que ele está no PATH.`,
          { cause: error },
        ),
      );
    });
  });

  child.on("exit", (code, signal) => {
    hasExited = true;
    exitError = closing
      ? null
      : new AgentRuntimeError(
          `codex app-server encerrou inesperadamente (code=${code}, signal=${signal}).`,
        );

    if (exitError) {
      logger.error({ code, signal, err: exitError }, "app-server encerrou inesperadamente");
    } else {
      logger.info({ code, signal }, "app-server encerrado");
    }

    const failure =
      exitError ??
      new AgentRuntimeError("codex app-server foi encerrado enquanto a chamada corria.");
    for (const [id, waiting] of pending) {
      pending.delete(id);
      waiting.reject(failure);
    }
    options.onClose(exitError);
  });

  const client: AppServerClient = {
    request,
    respond(id, result) {
      send({ id, result });
    },
    respondError(id, message) {
      send({ id, error: { code: METHOD_NOT_FOUND, message } });
    },
    async close() {
      if (closing || hasExited) return;
      closing = true;
      const stopped = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await stopped;
    },
  };

  await Promise.race([
    request("initialize", {
      clientInfo: { name: CLIENT_NAME, title: "Sprint Griller", version: CLIENT_VERSION },
      capabilities: { experimentalApi: true, requestAttestation: false },
    }),
    spawnFailed,
  ]);
  send({ method: "initialized" });

  return client;
}
