import { createLogger } from "@sprint-griller/core";
import type { Logger } from "@sprint-griller/core";
import type { AppServerClient, ServerRequest } from "./codex/app-server";
import { connectAppServer } from "./codex/app-server";
import type { AgentToolName, DynamicToolCallResponse, RequestId } from "./codex/protocol";
import {
  ASK_OPERATOR_TOOL_NAME,
  COMPLETION_PROPOSAL_TOOL_NAME,
  SPEC_SUBMISSION_TOOL_NAME,
  TICKETS_SUBMISSION_TOOL_NAME,
  agentMessageDeltaSchema,
  approvalParamsSchema,
  askOperatorArgumentsSchema,
  askOperatorToolSpec,
  completionProposalArgumentsSchema,
  completionProposalToolSpec,
  dynamicToolCallParamsSchema,
  errorNotificationSchema,
  itemCompletedSchema,
  requestUserInputParamsSchema,
  refinementSpecSubmissionSchema,
  refinementSpecSubmissionToolSpec,
  refinementTicketsSubmissionSchema,
  refinementTicketsSubmissionToolSpec,
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
  AgentSubmissionVerdict,
  PendingAgentSubmission,
  PendingQuestion,
  ResumeSessionOptions,
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
  readonly turnIdReady: Promise<string | null>;
  readonly resolveTurnId: (turnId: string | null) => void;
  turnId: string | null;
  terminal: boolean;
  interrupted: boolean;
  interrupting: Promise<void> | null;
}

interface SessionState {
  readonly id: string;
  readonly logger: Logger;
  readonly enabledTools: ReadonlySet<string>;
  activeTurn: ActiveTurn | null;
  /**
   * Turnos largados sem `turn/completed` — a interrupção pode ter falhado, ou o
   * codex ainda não a processou. Enquanto o id estiver aqui, o que chegar por
   * ele é rastro do turno velho, não do turno da vez (que talvez ainda nem saiba
   * o próprio id). Ids de turno são únicos por turno (UUIDv7 do codex), então
   * marcar um id nunca cala o turno seguinte.
   */
  readonly abandonedTurnIds: Set<string>;
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

  /**
   * O turno da vez, se o evento for mesmo dele. `threadId` sozinho não basta: a
   * thread sobrevive ao turno, então um evento atrasado terminaria ou quebraria
   * o turno seguinte.
   */
  function activeTurnOf(threadId: string, turnId: string): ActiveTurn | null {
    const session = sessions.get(threadId);
    const active = session?.activeTurn;
    if (!active) return null;

    // `active.turnId` nulo é a janela entre registrar o turno e o `turn/start`
    // responder: aí quem separa os dois é a lista de abandonados.
    const current = active.turnId === null || active.turnId === turnId;
    if (current && !session.abandonedTurnIds.has(turnId)) return active;

    session.logger.debug({ turnId, activeTurnId: active.turnId }, "evento de outro turno descartado");
    return null;
  }

  /** O turno abandonado morreu de fato: o rastro dele acabou aqui. */
  function forgetAbandonedTurn(threadId: string, turnId: string): void {
    sessions.get(threadId)?.abandonedTurnIds.delete(turnId);
  }

  function handleNotification(method: string, params: unknown): void {
    switch (method) {
      case "item/agentMessage/delta": {
        const parsed = agentMessageDeltaSchema.safeParse(params);
        if (!parsed.success) return dropped(method, params);
        activeTurnOf(parsed.data.threadId, parsed.data.turnId)?.queue.push({
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
        const active = activeTurnOf(parsed.data.threadId, parsed.data.turnId);
        const text = parsed.data.item.text ?? "";
        active?.logger.debug({ length: text.length }, "mensagem do agente concluída");
        active?.queue.push({ type: "message", text });
        return;
      }

      case "turn/completed": {
        const parsed = turnCompletedSchema.safeParse(params);
        if (!parsed.success) return dropped(method, params);
        const { turn } = parsed.data;
        if (turn.status === "inProgress") return;

        // O id do turno aqui vem em `turn.id`, não no `turnId` das demais.
        const active = activeTurnOf(parsed.data.threadId, turn.id);
        forgetAbandonedTurn(parsed.data.threadId, turn.id);
        if (!active) return;

        if (turn.status === "failed") {
          finishWithFailure(active, new AgentRuntimeError(turn.error?.message ?? "turno falhou."));
          return;
        }

        active.logger.info(
          { turnId: turn.id, status: turn.status, durationMs: turn.durationMs },
          "turno concluído",
        );
        active.terminal = true;
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
        const active = activeTurnOf(parsed.data.threadId, parsed.data.turnId);
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
    active.terminal = true;
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
      agendaItemId: null,
      header: question.header,
      question: question.question,
      recommendation: null,
      evidence: [],
      options: question.options ?? [],
      allowFreeText: question.isOther,
    }));

    registerQuestion(request, parsed.data, questions, {
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

    if (!sessions.get(parsed.data.threadId)?.enabledTools.has(parsed.data.tool)) {
      logger.warn({ tool: parsed.data.tool }, "ferramenta indisponível nesta sessão");
      respond(
        request.id,
        toolFailure(`a ferramenta ${parsed.data.tool} não está disponível nesta sessão.`),
      );
      return;
    }

    if (parsed.data.tool === COMPLETION_PROPOSAL_TOOL_NAME) {
      return registerSubmission(
        request,
        parsed.data,
        completionProposalArgumentsSchema,
        "completion-proposal",
        (proposal) => ({ type: "completion-proposal", proposal }),
      );
    }
    if (parsed.data.tool === SPEC_SUBMISSION_TOOL_NAME) {
      return registerSubmission(
        request,
        parsed.data,
        refinementSpecSubmissionSchema,
        "spec-submission",
        (submission) => ({ type: "spec-submission", submission }),
      );
    }
    if (parsed.data.tool === TICKETS_SUBMISSION_TOOL_NAME) {
      return registerSubmission(
        request,
        parsed.data,
        refinementTicketsSubmissionSchema,
        "tickets-submission",
        (submission) => ({ type: "tickets-submission", submission }),
      );
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
          `argumentos inválidos para ${ASK_OPERATOR_TOOL_NAME}: informe exatamente uma pergunta com ` +
            `id, agendaItemId, header, question, recommendation e ao menos uma evidence; e deixe a sala ` +
            `responder (opções e/ou allowFreeText). Sem recommendation a pergunta é um fato que ` +
            `você mesmo tem que buscar no código — não é decisão da sala.`,
        ),
      );
      return;
    }

    const questions: AgentQuestion[] = args.data.questions;

    registerQuestion(request, parsed.data, questions, {
      reply: (answers) => respond(request.id, toolAnswer(formatAnswers(questions, answers))),
      decline: () => respond(request.id, toolFailure("a sala não respondeu.")),
    });
  }

  function registerSubmission<TSubmission>(
    request: ServerRequest,
    origin: {
      readonly threadId: string;
      readonly turnId: string;
      readonly tool: string;
      readonly arguments: unknown;
    },
    schema: { safeParse(value: unknown): { success: true; data: TSubmission } | { success: false } },
    kind: "completion-proposal" | "spec-submission" | "tickets-submission",
    event: (submission: PendingAgentSubmission<TSubmission>) => AgentEvent,
  ): void {
    const parsed = schema.safeParse(origin.arguments);
    if (!parsed.success) {
      logger.warn({ tool: origin.tool }, "submissão estruturada inválida");
      respond(request.id, toolFailure(`argumentos inválidos para ${origin.tool}.`));
      return;
    }

    const active = activeTurnOf(origin.threadId, origin.turnId);
    if (!active) {
      respond(request.id, toolFailure("o turno que fez a submissão não está mais ativo."));
      return;
    }

    const pending: PendingAgentSubmission<TSubmission> = {
      submission: parsed.data,
      async respond(verdict: AgentSubmissionVerdict) {
        consumePending(active, request.id);
        respond(
          request.id,
          verdict.accepted ? toolAnswer(verdict.message) : toolFailure(verdict.message),
        );
      },
    };
    active.pending.set(request.id, {
      decline: () => respond(request.id, toolFailure("a cerimônia não avaliou a submissão.")),
    });
    active.logger.info({ turnId: active.turnId, kind }, "agente enviou submissão estruturada");
    active.queue.push(event(pending));
  }

  function registerQuestion(
    request: ServerRequest,
    origin: { readonly threadId: string; readonly turnId: string },
    questions: readonly AgentQuestion[],
    handlers: QuestionHandlers,
  ): void {
    const active = activeTurnOf(origin.threadId, origin.turnId);
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
    const active = activeTurnOf(parsed.data.threadId, parsed.data.turnId);
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
      active.terminal = true;
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

  function registerSession(threadId: string, enabledTools: readonly AgentToolName[]): AgentSession {
    const state: SessionState = {
      id: threadId,
      logger: logger.child({ sessionId: threadId }),
      enabledTools: new Set(enabledTools),
      activeTurn: null,
      abandonedTurnIds: new Set(),
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
          terminal: false,
          interrupted: false,
          interrupting: null,
          ...createTurnIdWaiter(),
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
          active.resolveTurnId(active.turnId);
          state.logger.info({ turnId: active.turnId }, "turno iniciado");

          yield* active.queue.stream();
        } catch (error) {
          active.resolveTurnId(null);
          throw error;
        } finally {
          try {
            if (active.turnId !== null && !active.terminal) {
              await interruptTurn(active, threadId);
            }
          } finally {
            // Interrompido ou não, o turno só está calado quando o
            // `turn/completed` dele chega — até lá o id fica marcado para o que
            // ele ainda emitir não cair no turno seguinte.
            if (active.turnId !== null && !active.terminal) {
              state.abandonedTurnIds.add(active.turnId);
            }
            declinePending(active);
            if (state.activeTurn === active) state.activeTurn = null;
          }
        }
      },

      async interrupt(): Promise<void> {
        const active = state.activeTurn;
        if (!active) return;

        await interruptTurn(active, threadId);
      },
    };
  }

  function createTurnIdWaiter(): Pick<ActiveTurn, "turnIdReady" | "resolveTurnId"> {
    let resolveTurnId!: (turnId: string | null) => void;
    const turnIdReady = new Promise<string | null>((resolve) => {
      resolveTurnId = resolve;
    });
    return { turnIdReady, resolveTurnId };
  }

  function interruptTurn(active: ActiveTurn, threadId: string): Promise<void> {
    if (active.terminal || active.interrupted) return Promise.resolve();
    if (active.interrupting) return active.interrupting;

    const interrupting = (async (): Promise<void> => {
      const turnId = await active.turnIdReady;
      if (turnId === null || active.terminal) return;

      await callAppServer("turn/interrupt", { threadId, turnId });
      active.interrupted = true;
      active.logger.info({ turnId }, "turno interrompido");
    })();
    active.interrupting = interrupting;
    void interrupting.catch(() => {
      if (active.interrupting === interrupting) active.interrupting = null;
    });
    return interrupting;
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
      const enabledTools = sessionOptions.tools ?? [];
      const threadId = readThreadId(
        await callAppServer("thread/start", {
          cwd: options.cwd,
          // A Investigação lê repositórios; escrita no ADO é do `ado-client`.
          sandbox: "read-only",
          approvalPolicy: "on-request",
          dynamicTools: enabledTools.map(dynamicToolSpec),
          ...(sessionOptions.instructions === undefined
            ? {}
            : { developerInstructions: sessionOptions.instructions }),
        }),
        "thread/start",
      );

      logger.info({ sessionId: threadId }, "sessão iniciada");
      return registerSession(threadId, enabledTools);
    },

    // `dynamicTools` só existe em `thread/start`, mas o codex persiste as
    // ferramentas na thread: verificado que a `ask_operator` continua disponível
    // depois de um `thread/resume` (codex-cli 0.146.1).
    async resumeSession(
      sessionId: string,
      sessionOptions: ResumeSessionOptions = {},
    ): Promise<AgentSession> {
      const threadId = readThreadId(
        await callAppServer("thread/resume", { threadId: sessionId, excludeTurns: true }),
        "thread/resume",
      );

      logger.info({ sessionId: threadId }, "sessão retomada");
      return registerSession(threadId, sessionOptions.tools ?? []);
    },

    async close(): Promise<void> {
      await connection.current?.close();
      sessions.clear();
    },
  };
}

function dynamicToolSpec(name: AgentToolName) {
  switch (name) {
    case ASK_OPERATOR_TOOL_NAME:
      return askOperatorToolSpec;
    case COMPLETION_PROPOSAL_TOOL_NAME:
      return completionProposalToolSpec;
    case SPEC_SUBMISSION_TOOL_NAME:
      return refinementSpecSubmissionToolSpec;
    case TICKETS_SUBMISSION_TOOL_NAME:
      return refinementTicketsSubmissionToolSpec;
  }
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
