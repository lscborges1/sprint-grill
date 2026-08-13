"use server";

import { AgentRuntimeError } from "@sprint-griller/agent-runtime";
import { CeremonyError } from "@sprint-griller/ceremony";
import { AdoError } from "@sprint-griller/ado-client";
import { ConfigError } from "@sprint-griller/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import type {
  DiscardSpecDraftActionState,
  DumpActionState,
  SaveSpecDraftActionState,
} from "./spec-draft-action-state";
import {
  askFact,
  consultationSchema,
  decisionSchema,
  discardSpecDraft,
  discardSpecDraftSchema,
  dumpCeremony,
  dumpCeremonySchema,
  resumeCeremony,
  saveSpecDraft,
  sessionIdSchema,
  specDraftSchema,
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

/**
 * A assinatura do Operador sobre o Markdown do despejo. Nada aqui vai para o
 * Azure DevOps: é rascunho gravado na sessão, para sobreviver ao F5 e chegar
 * revisado no despejo.
 */
export async function saveSpecDraftAction(
  _previous: SaveSpecDraftActionState,
  formData: FormData,
): Promise<SaveSpecDraftActionState> {
  const parsed = specDraftSchema.safeParse({
    sessionId: formData.get("sessionId"),
    markdown: formData.get("markdown"),
    base: formData.get("base") ?? "",
    expectedSavedAt: formData.get("expectedSavedAt") ?? "",
    overwrite: formData.get("overwrite") ?? false,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Documento inválido." };
  }

  try {
    const draft = saveSpecDraft(parsed.data);
    return { status: "success", savedAt: draft.savedAt };
  } catch (error) {
    if (!(error instanceof CeremonyError)) throw error;
    logger.error({ err: error, sessionId: parsed.data.sessionId }, "edição do Dossiê recusada");
    return { status: "error", message: error.message };
  }
}

/** Joga a edição fora e volta ao documento gerado do que a cerimônia gravou. */
export async function discardSpecDraftAction(
  _previous: DiscardSpecDraftActionState,
  formData: FormData,
): Promise<DiscardSpecDraftActionState> {
  const requestId = formData.get("requestId");
  const parsed = discardSpecDraftSchema.extend({ requestId: z.string().min(1).max(128) }).safeParse({
    sessionId: formData.get("sessionId"),
    expectedSavedAt: formData.get("expectedSavedAt") ?? "",
    requestId,
  });

  if (!parsed.success) {
    return {
      status: "error",
      requestId: typeof requestId === "string" ? requestId : "",
      message: parsed.error.issues[0]?.message ?? "Edição inválida.",
    };
  }

  try {
    discardSpecDraft(parsed.data);
    return { status: "success", requestId: parsed.data.requestId };
  } catch (error) {
    if (!(error instanceof CeremonyError)) throw error;
    logger.error({ err: error, sessionId: parsed.data.sessionId }, "descarte do Dossiê recusado");
    return { status: "error", requestId: parsed.data.requestId, message: error.message };
  }
}

/** A tela coleta a confirmação; o servidor confere o Dossiê antes de escrever. */
export async function dumpCeremonyAction(
  _previous: DumpActionState,
  formData: FormData,
): Promise<DumpActionState> {
  const parsed = dumpCeremonySchema.safeParse({
    sessionId: formData.get("sessionId"),
    markdown: formData.get("markdown"),
    base: formData.get("base"),
    tasksMarkdown: formData.get("tasksMarkdown"),
    estimate: formData.get("estimate"),
    confirmPending: formData.get("confirmPending") === "true",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Despejo inválido." };
  }

  try {
    await dumpCeremony(parsed.data);
    return { status: "success" };
  } catch (error) {
    if (!(error instanceof CeremonyError) && !(error instanceof AdoError) && !(error instanceof ConfigError)) {
      throw error;
    }
    logger.error({ err: error, sessionId: parsed.data.sessionId }, "despejo da cerimônia recusado");
    return { status: "error", message: error.message };
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
