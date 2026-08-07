import type { CeremonyStore } from "./store";
import type { CeremonySession, PalcoState } from "./types";

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

  return {
    sessionId,
    story: { id: session.storyId, title: session.storyTitle, url: session.storyUrl },
    decisionCount: store.countDecisions(sessionId),
    lastDecision: store.lastDecision(sessionId) ?? null,
    live,
    current: phaseOf(store, session, live),
  };
}

function phaseOf(
  store: CeremonyStore,
  session: CeremonySession,
  live: boolean,
): PalcoState["current"] {
  if (session.status === "falhou") {
    return { phase: "falhou", message: session.failureMessage ?? "A cerimônia parou." };
  }
  if (session.status === "encerrada") return { phase: "encerrada" };

  const question = store.currentQuestion(session.id);
  if (question) return { phase: "perguntando", question };

  return live ? { phase: "pensando" } : { phase: "retomavel" };
}
