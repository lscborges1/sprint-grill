import type { CeremonyStore } from "./store";
import type { CeremonySession, PalcoState, PersistedCeremonyQuestion } from "./types";

/**
 * O que a sala vê, projetado do que está gravado. Nada aqui vem de memória do
 * processo — é por isso que dar F5 no meio da cerimônia volta no mesmo ponto.
 *
 * `live` é a única coisa que o banco não sabe: se existe turno de agente vivo
 * neste processo. Sem ele, uma sessão aberta é uma cerimônia parada por crash.
 */
export function readPalco(
  store: CeremonyStore,
  sessionId: string,
  live: boolean,
): PalcoState | undefined {
  const session = store.getSession(sessionId);
  if (!session) return undefined;

  const decisions = store.listDecisions(sessionId);
  const pendingQuestions = store.listOpenQuestions(sessionId);

  return {
    sessionId,
    story: { id: session.storyId, title: session.storyTitle, url: session.storyUrl },
    refinement: session.refinement,
    completionProposal: store.getRefinementCompletionProposal(sessionId),
    agenda: store.listRefinementItems(sessionId),
    decisionCount: decisions.length,
    decisions,
    pendingQuestions,
    lastDecision: decisions.at(-1) ?? null,
    consultation: store.lastConsultation(sessionId) ?? null,
    pending: store.unansweredQuestions(sessionId).map((asked) => ({
      id: asked.id,
      question: asked.question,
    })),
    live,
    current: phaseOf(session, live, pendingQuestions[0]),
  };
}

function phaseOf(
  session: CeremonySession,
  live: boolean,
  currentQuestion: PersistedCeremonyQuestion | undefined,
): PalcoState["current"] {
  if (session.status === "falhou") {
    return { phase: "falhou", message: session.failureMessage ?? "A cerimônia parou." };
  }
  if (session.status === "encerrada") return { phase: "encerrada" };

  if (currentQuestion) return { phase: "perguntando", question: currentQuestion };

  return live ? { phase: "pensando" } : { phase: "retomavel" };
}
