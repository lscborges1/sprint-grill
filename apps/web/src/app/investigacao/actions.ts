"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { startInvestigation } from "@/lib/investigations";

const storyIdSchema = z.coerce.number().int().positive();

/**
 * O clique do picker: dispara a Investigação e manda o Operador para o preview.
 * Não espera o turno — a partir daqui ele pode fechar a tela (AFK).
 */
export async function startInvestigationAction(formData: FormData): Promise<void> {
  const storyId = storyIdSchema.parse(formData.get("storyId"));

  startInvestigation(storyId);
  redirect(`/investigacao/${storyId}`);
}
