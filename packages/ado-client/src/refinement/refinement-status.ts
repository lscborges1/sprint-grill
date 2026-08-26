import { codeChip, codeTag, completedDumpIds } from "./dump-marker";

/**
 * Onde a US está no fluxo de refinamento. Não é estado nosso: cada valor é
 * apenas o nome do artefato mais avançado que a ferramenta já gravou no ADO
 * (ADR 0003 — o Azure DevOps é a fonte da verdade).
 */
export type RefinementStatus = "sem-investigacao" | "investigada" | "refinada";

/**
 * Marcador que o `ado-client` embute na Investigação publicada como comment na
 * US. Viaja como code span porque o ADO remove comentários HTML do texto
 * persistido (confirmado ao vivo em 2026-08-26) — um chip de código sobrevive
 * e continua discreto na discussão.
 */
export const INVESTIGATION_MARKER = "sprint-griller:investigacao";

/**
 * Marcador da Spec da US gravada pelo despejo. Procurado também na description
 * porque a Spec pode viver no corpo da US, não só como comment.
 */
export const SPEC_MARKER = "sprint-griller:spec";

/**
 * Título com que o relatório de Investigação começa. É o fallback para achar
 * Investigações publicadas antes do chip existir: o ADO já tinha removido o
 * comentário HTML delas, e o título é a única parte do artefato que sobrou
 * legível na US. Espelha o renderizador de relatórios do pacote
 * `investigation` — se um mudar, o outro junto.
 */
const INVESTIGATION_HEADING = "# Investigação — US #";

/** Textos da US que podem carregar artefatos da ferramenta. */
export interface WorkItemArtifacts {
  readonly description: string | undefined;
  readonly comments: readonly string[];
}

export function inferRefinementStatus(
  artifacts: WorkItemArtifacts,
): RefinementStatus {
  if (hasCompletionMarker(artifacts)) return "refinada";
  if (hasInvestigation(artifacts)) return "investigada";
  return "sem-investigacao";
}

/** Um texto carrega o marcador da Investigação — para o picker e as métricas. */
export function hasInvestigationMarker(text: string): boolean {
  return (
    carriesArtifact(text, INVESTIGATION_MARKER) ||
    text.includes(INVESTIGATION_HEADING)
  );
}

function hasCompletionMarker(artifacts: WorkItemArtifacts): boolean {
  return completedDumpIds([artifacts.description ?? "", ...artifacts.comments]).length > 0;
}

function hasInvestigation(artifacts: WorkItemArtifacts): boolean {
  return [artifacts.description ?? "", ...artifacts.comments].some(hasInvestigationMarker);
}

/**
 * O marcador de artefato está presente em qualquer forma aceita: code span
 * (comments), `<code>` (descrição) ou o comentário HTML legado de gravações
 * antigas. Token citado em prosa, sem envoltório, não conta.
 */
function carriesArtifact(text: string, token: string): boolean {
  return [codeChip(token), codeTag(token), `<!-- ${token} -->`].some((wrapped) =>
    text.includes(wrapped),
  );
}
