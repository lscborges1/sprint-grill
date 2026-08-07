"use server";

import { AgentRuntimeError } from "@sprint-griller/agent-runtime";
import { CeremonyError } from "@sprint-griller/ceremony";
import { redirect } from "next/navigation";
import {
  askFact,
  consultationSchema,
  decisionSchema,
  resumeCeremony,
  sessionIdSchema,
  startCeremony,
  submitDecision,
} from "@/lib/ceremonies";
import { storyIdSchema } from "@/lib/investigations";
import { logger } from "@/lib/logger";

/**
 * Abre o Palco de uma US investigada. Espera só a sessão nascer — o turno do
 * grilling segue solto, como a Investigação.
 */
export async function startCeremonyAction(formData: FormData): Promise<void> {
  const storyId = storyIdSchema.parse(formData.get("storyId"));
  const session = await startCeremony(storyId);

  redirect(`/cerimonia/${session.id}`);
}

/**
 * A única porta de entrada de um Registro de decisão. O que chega aqui veio do
 * formulário do Palco, com a sala na frente: não existe caminho que grave
 * decisão sem passar por uma pessoa.
 */
export async function submitDecisionAction(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const parsed = decisionSchema.safeParse({
    sessionId: formData.get("sessionId"),
    questionId: formData.get("questionId"),
    // O botão da opção manda `answer`; o campo aberto, `answerLivre`.
    answer: formData.get("answer") ?? formData.get("answerLivre") ?? "",
    decidedBy: formData.get("decidedBy") ?? "",
  });

  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Resposta inválida.";
  }

  try {
    await submitDecision(parsed.data);
    return null;
  } catch (error) {
    if (!(error instanceof CeremonyError)) throw error;
    logger.error({ err: error, sessionId: parsed.data.sessionId }, "decisão recusada");
    return error.message;
  }
}

/**
 * A dúvida de fato que surgiu na sala. Nada aqui vira Registro de decisão: o
 * agente vai ler o código e a resposta entra no transcript como fato.
 */
export async function askFactAction(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const parsed = consultationSchema.safeParse({
    sessionId: formData.get("sessionId"),
    question: formData.get("question") ?? "",
  });

  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Pergunta inválida.";
  }

  try {
    await askFact(parsed.data);
    return null;
  } catch (error) {
    // Agente fora do ar é erro de sala, não tela branca: o Operador tenta de novo.
    if (!(error instanceof CeremonyError) && !(error instanceof AgentRuntimeError)) throw error;
    logger.error({ err: error, sessionId: parsed.data.sessionId }, "consulta factual recusada");
    return error.message;
  }
}

/** Retoma uma cerimônia cujo turno morreu com o processo. */
export async function resumeCeremonyAction(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const sessionId = sessionIdSchema.parse(formData.get("sessionId"));

  try {
    await resumeCeremony(sessionId);
    return null;
  } catch (error) {
    // Agente fora do ar é erro de sala, não tela branca: o Operador tenta de novo.
    if (!(error instanceof CeremonyError) && !(error instanceof AgentRuntimeError)) throw error;
    logger.error({ err: error, sessionId }, "não foi possível retomar a cerimônia");
    return error.message;
  }
}
