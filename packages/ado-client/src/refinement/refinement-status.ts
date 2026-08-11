/**
 * Onde a US está no fluxo de refinamento. Não é estado nosso: cada valor é
 * apenas o nome do artefato mais avançado que a ferramenta já gravou no ADO
 * (ADR 0003 — o Azure DevOps é a fonte da verdade).
 */
export type RefinementStatus = "sem-investigacao" | "investigada" | "refinada";

/**
 * Marcador que o `ado-client` embute na Investigação publicada como comment na
 * US. Sobrevive porque a leitura devolve o Markdown como foi gravado (`text`; o
 * HTML renderizado é o `renderedText`, que não pedimos), e o renderizador do
 * ADO não mostra comentário HTML — o suficiente para o picker inferir o status
 * sem manter banco próprio.
 */
export const INVESTIGATION_MARKER = "<!-- sprint-griller:investigacao -->";

/**
 * Marcador da Spec da US gravada pelo despejo. Procurado também na description
 * porque a Spec pode viver no corpo da US, não só como comment.
 */
export const SPEC_MARKER = "<!-- sprint-griller:spec -->";

/** Só é gravado após Spec, Tasks, Registros e ata terminarem no ADO. */
export const DUMP_COMPLETION_MARKER_PREFIX = "<!-- sprint-griller:dump:";

/** Textos da US que podem carregar artefatos da ferramenta. */
export interface WorkItemArtifacts {
  readonly description: string | undefined;
  readonly comments: readonly string[];
}

export function inferRefinementStatus(
  artifacts: WorkItemArtifacts,
): RefinementStatus {
  if (hasCompletionMarker(artifacts)) return "refinada";
  if (hasMarker(artifacts, INVESTIGATION_MARKER)) return "investigada";
  return "sem-investigacao";
}

function hasCompletionMarker(artifacts: WorkItemArtifacts): boolean {
  return [artifacts.description ?? "", ...artifacts.comments].some((text) =>
    /<!-- sprint-griller:dump:[^:]+:complete -->/.test(text),
  );
}

function hasMarker(artifacts: WorkItemArtifacts, marker: string): boolean {
  return [artifacts.description ?? "", ...artifacts.comments].some((text) =>
    text.includes(marker),
  );
}
