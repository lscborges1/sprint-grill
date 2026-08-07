"use server";

import { redirect } from "next/navigation";
import {
  publishInvestigation,
  startInvestigation,
  storyIdSchema,
} from "@/lib/investigations";

/**
 * O clique do picker: dispara a Investigação e manda o Operador para o preview.
 * Não espera o turno — a partir daqui ele pode fechar a tela (AFK).
 */
export async function startInvestigationAction(formData: FormData): Promise<void> {
  const storyId = storyIdSchema.parse(formData.get("storyId"));

  startInvestigation(storyId);
  redirect(`/investigacao/${storyId}`);
}

/**
 * O clique que fecha o ciclo: a Investigação aprovada vira comment na US, e o
 * picker passa a mostrar a US como investigada. Aqui a request espera — é uma
 * chamada REST, não um turno de agente — e o resultado (inclusive a falha) fica
 * no run, que é o que a tela relê ao re-renderizar.
 */
export async function publishInvestigationAction(
  formData: FormData,
): Promise<void> {
  const storyId = storyIdSchema.parse(formData.get("storyId"));

  await publishInvestigation(storyId);
}
