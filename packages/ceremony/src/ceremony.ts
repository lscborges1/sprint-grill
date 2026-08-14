import type {
  AgentEvent,
  AgentQuestion,
  AgentRuntime,
  AgentSession,
  PendingQuestion,
} from "@sprint-griller/agent-runtime";
import type { Logger, SquadConfig } from "@sprint-griller/core";
import { CeremonyError } from "./ceremony-error";
import { runConsultation } from "./consulta";
import { readPalco } from "./palco";
import {
  ceremonyContinuationPrompt,
  ceremonyInstructions,
  ceremonyOpeningPrompt,
  ceremonyResumePrompt,
  investigationAgenda,
} from "./prompt";
import type { CeremonyStory } from "./prompt";
import type { CeremonyStore, RecordDecisionInput } from "./store";
import type {
  CeremonyConsultation,
  CeremonyDecision,
  CeremonyQuestion,
  CeremonySession,
  ConsultationOutcome,
  PalcoState,
  RefinementItemTransition,
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

const CEREMONY_AGENT_TOOLS = [
  "ask_operator",
  "propose_refinement_completion",
  "submit_refinement_spec",
  "submit_refinement_tickets",
] as const;

/** Turno vivo neste processo. Some no crash — é o que separa `pensando` de `retomavel`. */
interface LiveTurn {
  running: boolean;
  pending: PendingQuestion | undefined;
  answers: Record<string, readonly string[]>;
  progressed: boolean;
  noProgressCompletions: number;
}

/**
 * A cerimônia: junta o turno do agente com o estado gravado. Uma instância por
 * processo, várias sessões dentro dela.
 *
 * O agente nunca decide: ele só pergunta. `decide` é o único caminho que grava
 * uma escolha coletiva da sala — do laço de eventos aqui de dentro não dá para
 * chegar nele.
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
  ): ConsultationOutcome {
    try {
      store.answerConsultation(consultation.id, outcome);
      writeFailures.delete(sessionId);
      return outcome;
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
      return { status: "falhou", message: failed.message };
    } catch (persistError) {
      sessionLogger(sessionId)?.error(
        { err: persistError },
        "consulta ficou sem estado terminal no banco — Palco usa falha em memória",
      );
      writeFailures.set(sessionId, failed);
      return { status: "falhou", message: failed.message };
    }
  }

  /** Solta o turno: a request que dispara não espera a cerimônia inteira. */
  function kick(agentSession: AgentSession, prompt: string): void {
    const sessionId = agentSession.id;
    const live: LiveTurn = {
      running: true,
      pending: undefined,
      answers: {},
      progressed: false,
      noProgressCompletions: 0,
    };
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
      let nextPrompt = prompt;
      while (true) {
        live.progressed = false;
        let completed = false;

        for await (const event of agentSession.send(nextPrompt)) {
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

            case "completion-proposal":
              if (await receiveCompletionProposal(sessionId, event.proposal)) {
                live.progressed = true;
              }
              break;

            case "spec-submission":
            case "tickets-submission":
              await event.submission.respond({
                accepted: false,
                message: "Esta submissão não pertence à fase Refinar.",
              });
              break;

            case "approval":
              // A cerimônia é leitura: sair do sandbox nunca é decisão da sala.
              logger?.warn({ kind: event.approval.kind }, "aprovação recusada na cerimônia");
              await event.approval.decide("decline");
              break;

            case "turn-completed":
              store.appendEvent(sessionId, { kind: "turno-encerrado" });
              completed = true;
              break;

            case "turn-failed":
              store.appendEvent(sessionId, {
                kind: "turno-falhou",
                message: event.error.message,
              });
              store.finishSession(sessionId, { status: "falhou", message: event.error.message });
              logger?.error({ err: event.error }, "turno da cerimônia falhou");
              break;
          }
        }

        if (!completed || store.getSession(sessionId)?.refinement.phase !== "refinando") return;

        if (live.progressed) live.noProgressCompletions = 0;
        else live.noProgressCompletions += 1;

        if (live.noProgressCompletions >= 2) {
          store.appendEvent(sessionId, {
            kind: "mensagem",
            text:
              "O agente terminou duas vezes sem avançar a Agenda. Retome a cerimônia para tentar de novo.",
          });
          logger?.warn("cerimônia ficou retomável após dois turnos sem progresso");
          return;
        }

        logger?.info("turno terminou sem proposta aceita; continuação automática iniciada");
        nextPrompt = ceremonyContinuationPrompt();
      }
    } finally {
      live.running = false;
      live.pending = undefined;
      changed(sessionId);
    }
  }

  async function receiveCompletionProposal(
    sessionId: string,
    proposal: Extract<AgentEvent, { readonly type: "completion-proposal" }>["proposal"],
  ): Promise<boolean> {
    const open = store
      .listRefinementItems(sessionId)
      .filter((item) => item.status !== "resolvido" && item.status !== "fora-de-escopo");
    if (open.length > 0) {
      await proposal.respond({
        accepted: false,
        message: `A conclusão foi recusada: ${open.length} item(ns) da Agenda continuam abertos.`,
      });
      return false;
    }

    const session = store.getSession(sessionId);
    if (!session || session.refinement.phase !== "refinando") {
      await proposal.respond({
        accepted: false,
        message: "A conclusão só pode ser proposta durante a fase Refinar.",
      });
      return false;
    }

    store.updateRefinementPhase({
      sessionId,
      phase: "aguardando-confirmacao",
      expectedRevision: session.refinement.revision,
    });
    await proposal.respond({
      accepted: true,
      message: "Agenda encerrada. A sala agora precisa confirmar o avanço.",
    });
    changed(sessionId);
    return true;
  }

  async function receiveQuestion(
    sessionId: string,
    live: LiveTurn,
    pending: PendingQuestion,
  ): Promise<void> {
    if (pending.questions.length !== 1) {
      await pending.answer(
        Object.fromEntries(
          pending.questions.map((question) => [
            question.id,
            ["Envie exatamente uma pergunta por vez para a sala."],
          ]),
        ),
      );
      return;
    }
    // A ask_operator já exige recomendação; o HITL nativo não tem esse campo.
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

    const agentQuestion = pending.questions[0];
    if (!agentQuestion || agentQuestion.agendaItemId === null) {
      await pending.answer({
        [agentQuestion?.id ?? "pergunta"]: ["Vincule a pergunta a um agendaItemId persistido."],
      });
      return;
    }

    const agendaItem = store
      .listRefinementItems(sessionId)
      .find((item) => item.id === agentQuestion.agendaItemId);
    if (!agendaItem || agendaItem.status === "resolvido" || agendaItem.status === "fora-de-escopo") {
      await pending.answer({
        [agentQuestion.id]: ["O agendaItemId não identifica um item aberto desta Agenda."],
      });
      return;
    }
    if (store.currentQuestion(sessionId)) {
      await pending.answer({
        [agentQuestion.id]: ["Já existe uma pergunta ativa. Espere a sala resolvê-la."],
      });
      return;
    }

    const session = store.getSession(sessionId);
    if (!session) throw new CeremonyError(`cerimônia ${sessionId} não existe.`);
    store.transitionRefinementItem({
      sessionId,
      itemId: agendaItem.id,
      status: "aguardando-sala",
      expectedRevision: session.refinement.revision,
    });

    // O filtro acima já provou que nenhuma é nula; aqui o tipo acompanha.
    store.askQuestions(
      sessionId,
      pending.questions
        .filter((question): question is RecommendedQuestion => question.recommendation !== null)
        .map(toCeremonyQuestion),
    );
    live.pending = pending;
    live.answers = {};
    live.progressed = true;
    changed(sessionId);
  }

  async function resumeFrom(sessionId: string): Promise<void> {
    const deadAgentQuestions = store
      .listOpenQuestions(sessionId)
      .filter((question) => question.source === "agent");
    // A pergunta do turno morreu, mas seu item volta a aberto com a mesma identidade.
    store.abandonPendingQuestions(sessionId);
    for (const question of deadAgentQuestions) {
      const item = store
        .listRefinementItems(sessionId)
        .find((candidate) => candidate.id === question.agendaItemId);
      if (item?.status === "aguardando-sala") {
        transitionAgenda(sessionId, { itemId: item.id, status: "aberto" });
      }
    }
    store.appendEvent(sessionId, { kind: "retomada" });

    const agentSession = await runtime.resumeSession(sessionId, {
      tools: CEREMONY_AGENT_TOOLS,
    });
    sessionLogger(sessionId)?.info("cerimônia retomada");
    kick(
      agentSession,
      ceremonyResumePrompt(
        store.listDecisions(sessionId),
        store.listRefinementItems(sessionId),
      ),
    );
  }

  return {
    async start({ story, investigationMarkdown }) {
      const agentSession = await runtime.startSession({
        instructions: ceremonyInstructions(repos),
        tools: CEREMONY_AGENT_TOOLS,
      });

      const session = store.createSession({
        id: agentSession.id,
        storyId: story.id,
        storyTitle: story.title,
        storyUrl: story.url,
        investigationMarkdown,
        timeZone: currentTimeZone(),
      });

      const agenda = store.seedRefinementItems(
        session.id,
        investigationAgenda(investigationMarkdown),
      );

      sessionLogger(session.id)?.info({ storyId: story.id }, "cerimônia iniciada");
      kick(agentSession, ceremonyOpeningPrompt(story, investigationMarkdown, agenda));
      const started = store.getSession(session.id);
      if (!started) throw new CeremonyError(`cerimônia ${session.id} não existe.`);
      return started;
    },

    async decide(input) {
      const asked = store.currentQuestion(input.sessionId);
      if (!asked || asked.id !== input.questionId) {
        throw new CeremonyError(`a pergunta ${input.questionId} não é a pergunta atual da sala.`);
      }
      const decision = store.recordDecision(input);
      const live = lives.get(input.sessionId);
      if (asked) {
        resolveAgendaChoice(
          input.sessionId,
          asked.agendaItemId,
          decision.answer,
          asked.recommendation,
        );
      }
      if (live) live.progressed = true;
      changed(input.sessionId);

      if (!live?.running) {
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

      // Uma escolha vinda da Consulta pode ser respondida enquanto o agente principal pensa.
      if (!live.pending) return decision;

      const agentQuestion = live.pending.questions.find(
        (question) => question.agendaItemId === asked?.agendaItemId,
      );
      if (!agentQuestion) return decision;

      live.answers = { ...live.answers, [agentQuestion.id]: [decision.answer] };
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
      openDoubtAgenda(sessionId, consultation.id, consultation.question);
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
          const persisted = settleConsultation(sessionId, consultation, outcome);
          try {
            settleDoubtAgenda(sessionId, consultation.id, persisted);
            if (persisted.status === "precisa-sala") {
              queueRoomChoice(sessionId, consultation.id, persisted);
            }
          } catch (error) {
            logger?.error(
              { err: error, consultationId: consultation.id },
              "não foi possível atualizar a Agenda depois da consulta",
            );
            try {
              transitionAgenda(sessionId, {
                itemId: `duvida-${consultation.id}`,
                status: "aberto",
              });
            } catch (recoveryError) {
              logger?.error(
                { err: recoveryError, consultationId: consultation.id },
                "não foi possível recuperar o item da Agenda depois da consulta",
              );
            }
          }
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

  function resolveAgendaChoice(
    sessionId: string,
    itemId: string,
    answer: string,
    recommendation: string,
  ): void {
    const item = store.listRefinementItems(sessionId).find((candidate) => candidate.id === itemId);
    const session = store.getSession(sessionId);
    if (!item || !session || item.status === "resolvido" || item.status === "fora-de-escopo") return;

    store.transitionRefinementItem({
      sessionId,
      itemId,
      status: "resolvido",
      resolution: { kind: "escolha", answer, recommendation },
      expectedRevision: session.refinement.revision,
    });
  }

  function queueRoomChoice(
    sessionId: string,
    consultationId: string,
    outcome: Extract<ConsultationOutcome, { readonly status: "precisa-sala" }>,
  ): void {
    const itemId = `duvida-${consultationId}`;
    store.askQuestions(sessionId, [
      {
        id: itemId,
        agendaItemId: itemId,
        source: "room-doubt",
        header: "Dúvida da sala",
        question: outcome.question,
        recommendation: outcome.recommendation,
        evidence: outcome.evidence,
        options: outcome.options,
        allowFreeText: outcome.allowFreeText,
      },
    ]);
  }

  function openDoubtAgenda(sessionId: string, consultationId: string, question: string): void {
    const itemId = `duvida-${consultationId}`;
    store.seedRefinementItems(sessionId, [{ id: itemId, question }]);
    transitionAgenda(sessionId, {
      itemId,
      status: "pesquisando",
    });
  }

  function settleDoubtAgenda(
    sessionId: string,
    consultationId: string,
    outcome: ConsultationOutcome,
  ): void {
    const itemId = `duvida-${consultationId}`;
    if (outcome.status === "respondida") {
      transitionAgenda(sessionId, {
        itemId,
        status: "resolvido",
        resolution: { kind: "fato", answer: outcome.answer, citations: outcome.citations },
      });
      return;
    }
    if (outcome.status === "precisa-sala") {
      transitionAgenda(sessionId, { itemId, status: "aguardando-sala" });
      return;
    }
    transitionAgenda(sessionId, { itemId, status: "aberto" });
  }

  function transitionAgenda(sessionId: string, transition: RefinementItemTransition): void {
    const session = store.getSession(sessionId);
    if (!session) throw new CeremonyError(`cerimônia ${sessionId} não existe.`);
    store.transitionRefinementItem({
      sessionId,
      expectedRevision: session.refinement.revision,
      ...transition,
    });
    const live = lives.get(sessionId);
    if (live) live.progressed = true;
  }
}

function currentTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timeZone) {
    throw new CeremonyError("não foi possível determinar o fuso horário da sessão.");
  }
  return timeZone;
}

/** Pergunta que já provou ter recomendação — a única que o Palco aceita exibir. */
type RecommendedQuestion = AgentQuestion & { readonly recommendation: string };

function toCeremonyQuestion(question: RecommendedQuestion): CeremonyQuestion {
  return {
    id: question.id,
    agendaItemId: question.agendaItemId ?? question.id,
    source: "agent",
    header: question.header,
    question: question.question,
    recommendation: question.recommendation,
    evidence: question.evidence,
    options: question.options,
    allowFreeText: question.allowFreeText,
  };
}
