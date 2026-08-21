import { AdoError, fetchBacklog } from "@sprint-griller/ado-client";
import type { BacklogStory } from "@sprint-griller/ado-client";
import { ConfigError, loadAdoCredentials } from "@sprint-griller/core";
import { logger } from "./logger";
import { getSquadConfig } from "./squad-config";

/**
 * O picker sempre tem algo para desenhar: o backlog, o vazio, ou o motivo de
 * não ter conseguido ler. ADO fora do ar não vira tela quebrada.
 */
export type BacklogResult =
  | { readonly status: "ok"; readonly stories: readonly BacklogStory[] }
  | { readonly status: "error"; readonly message: string };

export async function loadBacklog(): Promise<BacklogResult> {
  const { azureDevOps } = getSquadConfig();

  try {
    const stories = await fetchBacklog({
      azureDevOps,
      credentials: loadAdoCredentials(),
      logger,
    });
    return { status: "ok", stories };
  } catch (error) {
    // AdoError e ConfigError são escritos para o Operador ler — credencial
    // ausente e credencial recusada dão na mesma tela. O resto (stack, causa,
    // URL) fica no log estruturado; erro inesperado sobe para o error boundary.
    if (!(error instanceof AdoError) && !(error instanceof ConfigError)) {
      throw error;
    }

    logger.error(
      { err: error, ...(error instanceof AdoError && { kind: error.kind }) },
      "não foi possível ler o backlog",
    );
    return { status: "error", message: error.message };
  }
}
