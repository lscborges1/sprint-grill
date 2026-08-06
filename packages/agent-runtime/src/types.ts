/**
 * Falha na fronteira do runtime de agente: o processo do agente morreu, o
 * protocolo devolveu erro, ou o turno falhou. Distinta de `ConfigError` — esta
 * acontece durante uma cerimônia, não na inicialização.
 */
export class AgentRuntimeError extends Error {
  override readonly name = "AgentRuntimeError";
}

/** Uma pergunta do agente para a sala. O `id` é a chave da resposta. */
export interface AgentQuestion {
  readonly id: string;
  /** Rótulo curto do assunto (ex.: "Escopo do cache"). */
  readonly header: string;
  readonly question: string;
  readonly options: readonly AgentQuestionOption[];
  /** Se o humano pode responder fora das opções. */
  readonly allowFreeText: boolean;
}

export interface AgentQuestionOption {
  readonly label: string;
  readonly description: string;
}

/**
 * Pergunta pendente: o agente está parado esperando. Enquanto `answer` não for
 * chamado, o turno não anda.
 */
export interface PendingQuestion {
  /** De 1 a 3 perguntas, respondidas juntas. */
  readonly questions: readonly AgentQuestion[];
  /** Respostas por `AgentQuestion.id`. Chamar duas vezes é erro. */
  answer(answers: Readonly<Record<string, readonly string[]>>): Promise<void>;
}

export type ApprovalDecision = "accept" | "accept-for-session" | "decline";

/**
 * Aprovação pendente: o agente quer rodar um comando ou escrever um arquivo e
 * está parado esperando. Mesmo contrato de {@link PendingQuestion}.
 */
export interface PendingApproval {
  readonly kind: "command" | "file-change";
  /**
   * O comando a ser executado. Em `file-change` o codex não manda o diff no
   * pedido de aprovação, então aqui vai o que ele der (a raiz pedida) — o
   * detalhe do patch é assunto da UI de sessão.
   */
  readonly summary: string;
  readonly reason: string | null;
  decide(decision: ApprovalDecision): Promise<void>;
}

export interface TurnSummary {
  readonly id: string;
  readonly status: "completed" | "interrupted";
  readonly durationMs: number | null;
}

/**
 * O que a sessão emite enquanto o agente trabalha. Vocabulário do domínio, não
 * do codex — a costura para outro runtime cabe atrás disto (ver ADR 0001).
 */
export type AgentEvent =
  | { readonly type: "message-delta"; readonly text: string }
  | { readonly type: "message"; readonly text: string }
  | { readonly type: "question"; readonly question: PendingQuestion }
  | { readonly type: "approval"; readonly approval: PendingApproval }
  | { readonly type: "turn-completed"; readonly turn: TurnSummary }
  | { readonly type: "turn-failed"; readonly error: AgentRuntimeError };

export interface AgentSession {
  /** Identificador opaco, estável entre execuções: é o que `resumeSession` recebe. */
  readonly id: string;
  /**
   * Envia um prompt e streama o turno até ele terminar. Perguntas e aprovações
   * chegam como eventos e são respondidas de dentro do próprio `for await`.
   */
  send(prompt: string): AsyncIterable<AgentEvent>;
  /**
   * Aborta o turno em andamento. Resolve quando o app-server aceita a interrupção;
   * se o turno ainda está iniciando, espera o ID dele. Sem turno, não faz nada.
   */
  interrupt(): Promise<void>;
}

export interface AgentRuntime {
  startSession(options?: StartSessionOptions): Promise<AgentSession>;
  resumeSession(sessionId: string): Promise<AgentSession>;
  /** Encerra o processo do agente. Sessões abertas param de funcionar. */
  close(): Promise<void>;
}

export interface StartSessionOptions {
  /** Instruções de sistema para a sessão (ex.: o papel do agente na Investigação). */
  readonly instructions?: string;
}
