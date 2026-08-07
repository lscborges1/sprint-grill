import type {
  AgentQuestion,
  AgentRuntime,
  AgentSession,
  PendingQuestion,
} from "@sprint-griller/agent-runtime";
import type { Logger, SquadConfig } from "@sprint-griller/core";
import { CeremonyError } from "./ceremony-error";
import { runConsultation } from "./consulta";
import { readPalco } from "./palco";
import { ceremonyInstructions, ceremonyOpeningPrompt, ceremonyResumePrompt } from "./prompt";
import type { CeremonyStory } from "./prompt";
import type { CeremonyStore, RecordDecisionInput } from "./store";
import type {
  CeremonyConsultation,
  CeremonyDecision,
  CeremonyQuestion,
  CeremonySession,
  ConsultationOutcome,
  PalcoState,
} from "./types";

export interface CreateCeremonyOptions {
  readonly runtime: AgentRuntime;
  readonly store: CeremonyStore;
  readonly repos: SquadConfig["repos"];
  readonly logger?: Logger;
  /** Avisa que o Palco desta sessão mudou — é o gatilho do SSE. */
  readonly onChange?: (sessionId: string) => void;
}

export interface StartCeremonyInput {
  readonly story: CeremonyStory;
  readonly investigationMarkdown: string;
}

export interface ConsultInput {
  readonly sessionId: string;
  /** A dúvida de fato, como o Operador escreveu na sala. */
  readonly question: string;
}

export interface Ceremony {
  start(input: StartCeremonyInput): Promise<CeremonySession>;
  decide(input: RecordDecisionInput): Promise<CeremonyDecision>;
  /**
   * Dispara uma Consulta factual e devolve na hora — a resposta chega ao Palco
   * pelo `onChange`, como todo o resto. A sala não fica olhando request pendurada.
   */
  consult(input: ConsultInput): CeremonyConsultation;
  resume(sessionId: string): Promise<void>;
  palco(sessionId: string): PalcoState | undefined;
}

/** Resposta a uma pergunta que o agente mandou sem recomendação. */
export const NAO_E_DECISAO =
  "Isto não é decisão da sala: sem recomendação sua, é fato que você mesmo tem que " +
  "buscar nos repos. Leia o código e volte com a decisão e a recomendação.";

/** Turno vivo neste processo. Some no crash — é o que separa `pensando` de `retomavel`. */
interface LiveTurn {
  running: boolean;
  pending: PendingQuestion | undefined;
  answers: Record<string, readonly string[]>;
}

/**
 * A cerimônia: junta o turno do agente com o estado gravado. Uma instância por
 * processo, várias sessões dentro dela.
 *
 * O agente nunca decide: ele só pergunta. `decide` é o único caminho que grava
 * Registro de decisão, e ele exige quem decidiu — do laço de eventos aqui de
 * dentro não dá para chegar nele.
 */
export function createCeremony(options: CreateCeremonyOptions): Ceremony {
  const { runtime, store, repos } = options;
  const lives = new Map<string, LiveTurn>();
  /**
   * Escape hatch quando o banco não aceita nem o `falhou`: sem isto a sala
   * fica eternamente em "buscando" neste processo. Some no crash — como o turno.
   */
  const writeFailures = new Map<string, CeremonyConsultation>();

  function changed(sessionId: string): void {
    options.onChange?.(sessionId);
  }

  function sessionLogger(sessionId: string): Logger | undefined {
    return options.logger?.child({ sessionId });
  }

  function consultationInFlight(sessionId: string): boolean {
    const last = store.lastConsultation(sessionId);
    if (last?.status !== "buscando") return false;
    const failed = writeFailures.get(sessionId);
    return !(failed && failed.id === last.id);
  }

  function sessionPalco(sessionId: string): PalcoState | undefined {
    const state = readPalco(store, sessionId, lives.get(sessionId)?.running === true);
    if (!state) return undefined;

    const failed = writeFailures.get(sessionId);
    if (
      failed &&
      state.consultation?.id === failed.id &&
      state.consultation.status === "buscando"
    ) {
      return { ...state, consultation: failed };
    }
    return state;
  }

  /** Persiste o desfecho; se a gravação cair, a sala ainda vê um estado terminal. */
  function settleConsultation(
    sessionId: string,
    consultation: CeremonyConsultation,
    outcome: ConsultationOutcome,
  ): void {
    try {
      store.answerConsultation(consultation.id, outcome);
      writeFailures.delete(sessionId);
      return;
    } catch (error) {
      sessionLogger(sessionId)?.error({ err: error }, "não foi possível gravar a consulta");
    }

    const failed: CeremonyConsultation = {
      id: consultation.id,
      question: consultation.question,
      askedAt: consultation.askedAt,
      status: "falhou",
      message: "Não foi possível gravar a resposta. Pergunte de novo.",
      answeredAt: Date.now(),
    };

    try {
      store.answerConsultation(consultation.id, {
        status: "falhou",
        message: failed.message,
      });
      writeFailures.delete(sessionId);
    } catch (persistError) {
      sessionLogger(sessionId)?.error(
        { err: persistError },
        "consulta ficou sem estado terminal no banco — Palco usa falha em memória",
      );
      writeFailures.set(sessionId, failed);
    }
  }

  /** Solta o turno: a request que dispara não espera a cerimônia inteira. */
  function kick(agentSession: AgentSession, prompt: string): void {
    const sessionId = agentSession.id;
    const live: LiveTurn = { running: true, pending: undefined, answers: {} };
    lives.set(sessionId, live);

    void consume(agentSession, prompt, live).catch((error: unknown) => {
      sessionLogger(sessionId)?.error({ err: error }, "cerimônia morreu fora do fluxo de erro");
      store.finishSession(sessionId, {
        status: "falhou",
        message: "A cerimônia parou por um erro inesperado.",
      });
      live.running = false;
      live.pending = undefined;
      changed(sessionId);
    });
  }

  async function consume(
    agentSession: AgentSession,
    prompt: string,
    live: LiveTurn,
  ): Promise<void> {
    const sessionId = agentSession.id;
    const logger = sessionLogger(sessionId);

    try {
      for await (const event of agentSession.send(prompt)) {
        switch (event.type) {
          case "message-delta":
            break;

          case "message":
            store.appendEvent(sessionId, { kind: "mensagem", text: event.text });
            changed(sessionId);
            break;

          case "question":
            await receiveQuestion(sessionId, live, event.question);
            break;

          case "approval":
            // A cerimônia é leitura: sair do sandbox nunca é decisão da sala.
            logger?.warn({ kind: event.approval.kind }, "aprovação recusada na cerimônia");
            await event.approval.decide("decline");
            break;

          case "turn-completed":
            store.appendEvent(sessionId, { kind: "turno-encerrado" });
            store.finishSession(sessionId, { status: "encerrada" });
            logger?.info("cerimônia encerrada pelo agente");
            break;

          case "turn-failed":
            store.appendEvent(sessionId, { kind: "turno-falhou", message: event.error.message });
            store.finishSession(sessionId, { status: "falhou", message: event.error.message });
            logger?.error({ err: event.error }, "turno da cerimônia falhou");
            break;
        }
      }
    } finally {
      live.running = false;
      live.pending = undefined;
      changed(sessionId);
    }
  }

  async function receiveQuestion(
    sessionId: string,
    live: LiveTurn,
    pending: PendingQuestion,
  ): Promise<void> {
    /**
     * Rodada inteira ou nada: as duas origens de pergunta são homogêneas — a
     * `ask_operator` só passa com recomendação (o zod do runtime recusa antes),
     * e o HITL nativo do codex nunca tem onde carregar uma. Rodada misturada
     * não existe, e tratar meia rodada seria maquinário para caso impossível.
     */
    const semRecomendacao = pending.questions.filter((question) => question.recommendation === null);

    if (semRecomendacao.length > 0) {
      for (const question of semRecomendacao) {
        store.appendEvent(sessionId, {
          kind: "pergunta-recusada",
          question: question.question,
          motivo: "veio sem recomendação",
        });
      }
      sessionLogger(sessionId)?.warn(
        { questionIds: semRecomendacao.map((question) => question.id) },
        "pergunta sem recomendação devolvida ao agente",
      );
      await pending.answer(
        Object.fromEntries(pending.questions.map((question) => [question.id, [NAO_E_DECISAO]])),
      );
      return;
    }

    // O filtro acima já provou que nenhuma é nula; aqui o tipo acompanha.
    store.askQuestions(
      sessionId,
      pending.questions
        .filter((question): question is RecommendedQuestion => question.recommendation !== null)
        .map(toCeremonyQuestion),
    );
    live.pending = pending;
    live.answers = {};
    changed(sessionId);
  }

  async function resumeFrom(sessionId: string): Promise<void> {
    // As perguntas do turno morto morreram com ele: perguntar de novo é ruído na sala.
    store.abandonPendingQuestions(sessionId);
    store.appendEvent(sessionId, { kind: "retomada" });

    const agentSession = await runtime.resumeSession(sessionId);
    sessionLogger(sessionId)?.info("cerimônia retomada");
    kick(agentSession, ceremonyResumePrompt(store.listDecisions(sessionId)));
  }

  return {
    async start({ story, investigationMarkdown }) {
      const agentSession = await runtime.startSession({
        instructions: ceremonyInstructions(repos),
      });

      const session = store.createSession({
        id: agentSession.id,
        storyId: story.id,
        storyTitle: story.title,
        storyUrl: story.url,
        investigationMarkdown,
      });

      sessionLogger(session.id)?.info({ storyId: story.id }, "cerimônia iniciada");
      kick(agentSession, ceremonyOpeningPrompt(story, investigationMarkdown));
      return session;
    },

    async decide(input) {
      const decision = store.recordDecision(input);
      const live = lives.get(input.sessionId);
      changed(input.sessionId);

      if (!live?.running || !live.pending) {
        // O turno que perguntou morreu com o processo: a decisão está gravada,
        // e é ela que volta para o agente na retomada. Se a retomada falhar, a
        // decisão não vai junto: perder o que a sala inteira decidiu é o único
        // erro que esta cerimônia não pode cometer. O Palco volta a "retomável".
        try {
          await resumeFrom(input.sessionId);
        } catch (error) {
          sessionLogger(input.sessionId)?.error(
            { err: error },
            "decisão gravada, mas a cerimônia não retomou",
          );
          changed(input.sessionId);
        }
        return decision;
      }

      live.answers = { ...live.answers, [input.questionId]: [decision.answer] };
      const round = live.pending;
      if (round.questions.every((question) => question.id in live.answers)) {
        const answers = live.answers;
        live.pending = undefined;
        live.answers = {};
        await round.answer(answers);
      }

      return decision;
    },

    consult({ sessionId, question }) {
      const session = store.getSession(sessionId);
      if (!session) throw new CeremonyError(`cerimônia ${sessionId} não existe.`);
      // O formulário some do Palco quando a cerimônia acaba, mas a server action
      // continua sendo porta aberta: sala fechada não faz pergunta.
      if (session.status !== "ativa") {
        throw new CeremonyError(`a cerimônia da US #${session.storyId} já está encerrada.`);
      }
      // O Palco só projeta a última consulta: se outra entrar enquanto esta ainda
      // busca, a resposta da primeira some da tela (fica só no transcript).
      if (consultationInFlight(sessionId)) {
        throw new CeremonyError(
          "espere a consulta em andamento terminar antes de perguntar de novo.",
        );
      }

      writeFailures.delete(sessionId);
      const consultation = store.openConsultation(sessionId, question);
      changed(sessionId);

      // Solta a busca: a sala vê "buscando" e a resposta chega pelo SSE. O turno
      // do grilling continua parado na decisão da vez — é sessão à parte.
      const logger = sessionLogger(sessionId);
      void runConsultation({
        runtime,
        repos,
        story: { id: session.storyId, title: session.storyTitle },
        question: consultation.question,
        ...(logger ? { logger } : {}),
      })
        .catch((error: unknown) => {
          sessionLogger(sessionId)?.error({ err: error }, "consulta factual morreu fora do fluxo");
          return {
            status: "falhou",
            message: "A consulta parou por um erro inesperado.",
          } as const;
        })
        .then((outcome) => {
          settleConsultation(sessionId, consultation, outcome);
          changed(sessionId);
        });

      return consultation;
    },

    async resume(sessionId) {
      const session = store.getSession(sessionId);
      if (!session) throw new CeremonyError(`cerimônia ${sessionId} não existe.`);
      if (session.status !== "ativa") {
        throw new CeremonyError(`a cerimônia da US #${session.storyId} já está encerrada.`);
      }
      if (lives.get(sessionId)?.running) return;

      await resumeFrom(sessionId);
    },

    palco(sessionId) {
      return sessionPalco(sessionId);
    },
  };
}

/** Pergunta que já provou ter recomendação — a única que o Palco aceita exibir. */
type RecommendedQuestion = AgentQuestion & { readonly recommendation: string };

function toCeremonyQuestion(question: RecommendedQuestion): CeremonyQuestion {
  return {
    id: question.id,
    header: question.header,
    question: question.question,
    recommendation: question.recommendation,
    evidence: question.evidence,
    options: question.options,
    allowFreeText: question.allowFreeText,
  };
}
