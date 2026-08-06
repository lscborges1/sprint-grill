import { createLogger } from "@sprint-griller/core";
import type { Logger } from "@sprint-griller/core";
import type { AppServerClient, ServerRequest } from "./codex/app-server";
import { connectAppServer } from "./codex/app-server";
import type { DynamicToolCallResponse, RequestId } from "./codex/protocol";
import {
  ASK_OPERATOR_TOOL_NAME,
  agentMessageDeltaSchema,
  approvalParamsSchema,
  askOperatorArgumentsSchema,
  askOperatorToolSpec,
  dynamicToolCallParamsSchema,
  errorNotificationSchema,
  itemCompletedSchema,
  requestUserInputParamsSchema,
  threadResponseSchema,
  turnCompletedSchema,
  turnStartResponseSchema,
} from "./codex/protocol";
import type { EventQueue } from "./event-queue";
import { createEventQueue } from "./event-queue";
import { AgentRuntimeError } from "./types";
import type {
  AgentEvent,
  AgentQuestion,
  AgentRuntime,
  AgentSession,
  ApprovalDecision,
  PendingQuestion,
  StartSessionOptions,
} from "./types";

export interface CreateAgentRuntimeOptions {
  /** Repositório que o agente enxerga por padrão. */
  readonly cwd: string;
  readonly logger?: Logger;
  /** Seam de teste: o binário e os argumentos do processo do agente. */
  readonly command?: readonly [string, ...string[]];
}

type QuestionAnswers = Readonly<Record<string, readonly string[]>>;

interface PendingHumanRequest {
  /** Resposta neutra quando ninguém respondeu — senão o agente fica parado para sempre. */
  readonly decline: () => void;
}

interface QuestionHandlers extends PendingHumanRequest {
  readonly reply: (answers: QuestionAnswers) => void;
}

interface ActiveTurn {
  readonly queue: EventQueue<AgentEvent>;
  readonly pending: Map<RequestId, PendingHumanRequest>;
  readonly logger: Logger;
  turnId: string | null;
}

interface SessionState {
  readonly id: string;
  readonly logger: Logger;
  activeTurn: ActiveTurn | null;
}

/**
 * Fronteira entre o produto e o runtime de agente. Fala JSON-RPC com o
 * `codex app-server` por baixo (ADR 0001) e entrega eventos do domínio por
 * cima: o consumidor nunca vê `threadId`, `turn/start` ou request id.
 */
export async function createAgentRuntime(
  options: CreateAgentRuntimeOptions,
): Promise<AgentRuntime> {
  const logger = options.logger ?? createLogger({ name: "agent-runtime" });
  const sessions = new Map<string, SessionState>();

  // Os handlers abaixo são registrados na conexão e, portanto, existem antes
  // dela. Esta caixa evita usar o cliente antes de ele existir.
  const connection: { current: AppServerClient | null } = { current: null };

  function callAppServer(method: string, params: unknown): Promise<unknown> {
    if (!connection.current) {
      throw new AgentRuntimeError("o runtime de agente ainda não está conectado.");
    }
    return connection.current.request(method, params);
  }

  function respond(id: RequestId, result: unknown): void {
    connection.current?.respond(id, result);
  }

  /**
   * Payload que não casa com o schema é queda de compatibilidade com o codex, e
   * o sintoma seria um turno mudo. Nunca é silencioso.
   */
  function dropped(method: string, params: unknown): void {
    logger.warn(
      { method, keys: typeof params === "object" && params ? Object.keys(params) : [] },
      "payload do app-server fora do formato esperado — evento descartado",
    );
  }

  function activeTurnOf(threadId: string): ActiveTurn | null {
    return sessions.get(threadId)?.activeTurn ?? null;
  }

  function handleNotification(method: string, params: unknown): void {
    switch (method) {
      case "item/agentMessage/delta": {
        const parsed = agentMessageDeltaSchema.safeParse(params);
        if (!parsed.success) return dropped(method, params);
        activeTurnOf(parsed.data.threadId)?.queue.push({
          type: "message-delta",
          text: parsed.data.delta,
        });
        return;
      }

      case "item/completed": {
        const parsed = itemCompletedSchema.safeParse(params);
        if (!parsed.success) return dropped(method, params);
        // Comandos, tool calls e reasoning viram evento na UI de sessão (LSC-58);
        // aqui o stream é só a conversa.
        if (parsed.data.item.type !== "agentMessage") return;
        const active = activeTurnOf(parsed.data.threadId);
        const text = parsed.data.item.text ?? "";
        active?.logger.debug({ length: text.length }, "mensagem do agente concluída");
        active?.queue.push({ type: "message", text });
        return;
      }

      case "turn/completed": {
        const parsed = turnCompletedSchema.safeParse(params);
        if (!parsed.success) return dropped(method, params);
        const { turn } = parsed.data;
        const active = activeTurnOf(parsed.data.threadId);
        if (!active || turn.status === "inProgress") return;

        if (turn.status === "failed") {
          finishWithFailure(active, new AgentRuntimeError(turn.error?.message ?? "turno falhou."));
          return;
        }

        active.logger.info(
          { turnId: turn.id, status: turn.status, durationMs: turn.durationMs },
          "turno concluído",
        );
        active.queue.push({
          type: "turn-completed",
          turn: { id: turn.id, status: turn.status, durationMs: turn.durationMs ?? null },
        });
        active.queue.finish();
        return;
      }

      case "error": {
        const parsed = errorNotificationSchema.safeParse(params);
        if (!parsed.success) return dropped(method, params);
        const active = activeTurnOf(parsed.data.threadId);
        if (!active) return;

        // Com retry o codex continua sozinho: é aviso, não fim de turno.
        if (parsed.data.willRetry) {
          active.logger.warn({ reason: parsed.data.error.message }, "erro no turno, com retry");
          return;
        }
        finishWithFailure(active, new AgentRuntimeError(parsed.data.error.message));
        return;
      }

      default:
        // O protocolo do codex cresce a cada release: método novo é ignorado.
        return;
    }
  }

  function finishWithFailure(active: ActiveTurn, error: AgentRuntimeError): void {
    active.logger.error({ turnId: active.turnId, err: error }, "turno falhou");
    active.queue.push({ type: "turn-failed", error });
    active.queue.finish();
  }

  function handleServerRequest(request: ServerRequest): void {
    switch (request.method) {
      case "item/tool/requestUserInput":
        return handleRequestUserInput(request);
      case "item/tool/call":
        return handleDynamicToolCall(request);
      case "item/commandExecution/requestApproval":
        return handleApproval(request, "command");
      case "item/fileChange/requestApproval":
        return handleApproval(request, "file-change");
      case "currentTime/read":
        return respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
      default:
        // Request sem resposta trava o agente, mas inventar um payload que ele
        // não entende é pior: `permissions/requestApproval` e as elicitations de
        // MCP exigem formatos que este runtime não sabe montar. Recusar explícito
        // deixa o codex seguir e o log conta o que faltou tratar.
        logger.warn({ method: request.method }, "request do app-server sem tratamento");
        return connection.current?.respondError(
          request.id,
          `sprint-griller não trata ${request.method}.`,
        );
    }
  }

  /** HITL nativo do codex — experimental, pode não existir na versão instalada. */
  function handleRequestUserInput(request: ServerRequest): void {
    const parsed = requestUserInputParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      logger.warn({ method: request.method }, "pergunta do agente em formato desconhecido");
      respond(request.id, { answers: {} });
      return;
    }

    const questions: AgentQuestion[] = parsed.data.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      options: question.options ?? [],
      allowFreeText: question.isOther,
    }));

    registerQuestion(request, parsed.data.threadId, questions, {
      reply: (answers) =>
        respond(request.id, {
          answers: Object.fromEntries(
            Object.entries(answers).map(([id, values]) => [id, { answers: [...values] }]),
          ),
        }),
      decline: () => respond(request.id, { answers: {} }),
    });
  }

  /** HITL pela `ask_operator`: superfície estável, declarada por nós. */
  function handleDynamicToolCall(request: ServerRequest): void {
    const parsed = dynamicToolCallParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      dropped(request.method, request.params);
      respond(request.id, toolFailure("chamada de ferramenta ilegível."));
      return;
    }

    if (parsed.data.tool !== ASK_OPERATOR_TOOL_NAME) {
      logger.warn({ tool: parsed.data.tool }, "ferramenta desconhecida chamada pelo agente");
      respond(request.id, toolFailure(`a ferramenta ${parsed.data.tool} não existe neste runtime.`));
      return;
    }

    const args = askOperatorArgumentsSchema.safeParse(parsed.data.arguments);
    if (!args.success) {
      logger.warn({ tool: parsed.data.tool }, "argumentos inválidos na pergunta do agente");
      respond(
        request.id,
        toolFailure(
          `argumentos inválidos para ${ASK_OPERATOR_TOOL_NAME}: informe de 1 a 3 perguntas com id, header e question.`,
        ),
      );
      return;
    }

    const questions: AgentQuestion[] = args.data.questions;

    registerQuestion(request, parsed.data.threadId, questions, {
      reply: (answers) => respond(request.id, toolAnswer(formatAnswers(questions, answers))),
      decline: () => respond(request.id, toolFailure("a sala não respondeu.")),
    });
  }

  function registerQuestion(
    request: ServerRequest,
    threadId: string,
    questions: readonly AgentQuestion[],
    handlers: QuestionHandlers,
  ): void {
    const active = activeTurnOf(threadId);
    if (!active) {
      handlers.decline();
      return;
    }

    const question: PendingQuestion = {
      questions,
      async answer(answers) {
        consumePending(active, request.id);
        handlers.reply(answers);
        active.logger.info(
          { turnId: active.turnId, questionIds: questions.map((item) => item.id) },
          "resposta do humano enviada ao agente",
        );
      },
    };

    active.pending.set(request.id, { decline: handlers.decline });
    active.logger.info(
      { turnId: active.turnId, questionIds: questions.map((item) => item.id) },
      "agente pediu input ao humano",
    );
    active.queue.push({ type: "question", question });
  }

  function handleApproval(request: ServerRequest, kind: "command" | "file-change"): void {
    const parsed = approvalParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      logger.warn({ method: request.method }, "aprovação em formato desconhecido");
      respond(request.id, { decision: "decline" });
      return;
    }

    const decline = (): void => respond(request.id, { decision: "decline" });
    const active = activeTurnOf(parsed.data.threadId);
    if (!active) {
      decline();
      return;
    }

    const summary =
      kind === "command"
        ? (parsed.data.command ?? "comando sem descrição")
        : (parsed.data.grantRoot ?? "alteração de arquivos no workspace");

    active.pending.set(request.id, { decline });
    active.logger.info({ turnId: active.turnId, kind, summary }, "agente pediu aprovação");
    active.queue.push({
      type: "approval",
      approval: {
        kind,
        summary,
        reason: parsed.data.reason ?? null,
        async decide(decision) {
          consumePending(active, request.id);
          respond(request.id, { decision: toCodexDecision(decision) });
          active.logger.info({ turnId: active.turnId, kind, decision }, "aprovação decidida");
        },
      },
    });
  }

  function handleClose(error: AgentRuntimeError | null): void {
    for (const session of sessions.values()) {
      const active = session.activeTurn;
      if (!active) continue;
      // O processo morreu: não há para quem recusar as pendências.
      active.pending.clear();
      if (error) {
        finishWithFailure(active, error);
        continue;
      }
      active.queue.finish();
    }
  }

  connection.current = await connectAppServer({
    logger,
    ...(options.command === undefined ? {} : { command: options.command }),
    onNotification: handleNotification,
    onServerRequest: handleServerRequest,
    onClose: handleClose,
  });

  function registerSession(threadId: string): AgentSession {
    const state: SessionState = {
      id: threadId,
      logger: logger.child({ sessionId: threadId }),
      activeTurn: null,
    };
    sessions.set(threadId, state);

    return {
      id: threadId,

      async *send(prompt: string): AsyncGenerator<AgentEvent> {
        if (state.activeTurn) {
          throw new AgentRuntimeError("já existe um turno em andamento nesta sessão.");
        }

        const active: ActiveTurn = {
          queue: createEventQueue(),
          pending: new Map(),
          logger: state.logger,
          turnId: null,
        };
        // Registrado antes do `turn/start` porque as notificações do turno podem
        // chegar antes da resposta dele.
        state.activeTurn = active;

        try {
          const started = turnStartResponseSchema.safeParse(
            await callAppServer("turn/start", {
              threadId,
              input: [{ type: "text", text: prompt, text_elements: [] }],
            }),
          );
          if (!started.success) {
            throw new AgentRuntimeError("resposta inesperada de turn/start do codex app-server.");
          }

          active.turnId = started.data.turn.id;
          state.logger.info({ turnId: active.turnId }, "turno iniciado");

          yield* active.queue.stream();
        } finally {
          declinePending(active);
          state.activeTurn = null;
        }
      },

      async interrupt(): Promise<void> {
        const turnId = state.activeTurn?.turnId;
        if (turnId === undefined || turnId === null) return;

        await callAppServer("turn/interrupt", { threadId, turnId });
        state.logger.info({ turnId }, "turno interrompido");
      },
    };
  }

  function declinePending(active: ActiveTurn): void {
    for (const [id, handlers] of active.pending) {
      active.pending.delete(id);
      try {
        handlers.decline();
        active.logger.warn({ turnId: active.turnId }, "pendência HITL recusada sem resposta");
      } catch (error) {
        logger.debug({ err: error }, "não foi possível recusar a pendência HITL");
      }
    }
  }

  return {
    async startSession(sessionOptions: StartSessionOptions = {}): Promise<AgentSession> {
      const threadId = readThreadId(
        await callAppServer("thread/start", {
          cwd: options.cwd,
          // A Investigação lê repositórios; escrita no ADO é do `ado-client`.
          sandbox: "read-only",
          approvalPolicy: "on-request",
          dynamicTools: [askOperatorToolSpec],
          ...(sessionOptions.instructions === undefined
            ? {}
            : { developerInstructions: sessionOptions.instructions }),
        }),
        "thread/start",
      );

      logger.info({ sessionId: threadId }, "sessão iniciada");
      return registerSession(threadId);
    },

    // `dynamicTools` só existe em `thread/start`, mas o codex persiste as
    // ferramentas na thread: verificado que a `ask_operator` continua disponível
    // depois de um `thread/resume` (codex-cli 0.146.1).
    async resumeSession(sessionId: string): Promise<AgentSession> {
      const threadId = readThreadId(
        await callAppServer("thread/resume", { threadId: sessionId, excludeTurns: true }),
        "thread/resume",
      );

      logger.info({ sessionId: threadId }, "sessão retomada");
      return registerSession(threadId);
    },

    async close(): Promise<void> {
      await connection.current?.close();
      sessions.clear();
    },
  };
}

function readThreadId(result: unknown, method: string): string {
  const parsed = threadResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new AgentRuntimeError(`resposta inesperada de ${method} do codex app-server.`);
  }
  return parsed.data.thread.id;
}

function consumePending(active: ActiveTurn, id: RequestId): void {
  if (!active.pending.delete(id)) {
    throw new AgentRuntimeError("esta pendência já foi respondida.");
  }
}

function toCodexDecision(decision: ApprovalDecision): "accept" | "acceptForSession" | "decline" {
  return decision === "accept-for-session" ? "acceptForSession" : decision;
}

function toolAnswer(text: string): DynamicToolCallResponse {
  return { contentItems: [{ type: "inputText", text }], success: true };
}

function toolFailure(text: string): DynamicToolCallResponse {
  return { contentItems: [{ type: "inputText", text }], success: false };
}

/** O agente lê isto de volta como saída da ferramenta, então precisa ser legível. */
function formatAnswers(
  questions: readonly AgentQuestion[],
  answers: QuestionAnswers,
): string {
  return questions
    .map((question) => {
      const given = answers[question.id] ?? [];
      const text = given.length > 0 ? given.join("; ") : "(sem resposta)";
      return `${question.header}: ${question.question}\n> ${text}`;
    })
    .join("\n\n");
}

