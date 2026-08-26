import { INVESTIGATION_MARKER } from "../refinement/refinement-status";
import { commentSchema } from "../refinement/publish-refinement";
import { codeChip } from "../refinement/dump-marker";
import { COMMENTS_API_VERSION, createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions } from "../rest/ado-rest";

/** A Investigação já publicada — onde ela ficou, para o Operador ir conferir. */
export interface PublishedInvestigation {
  readonly commentId: number;
  /** A US no board, que é onde o comment aparece. */
  readonly url: string;
}

/** O relatório pronto para gravar. O Markdown vem renderizado por código. */
export interface InvestigationToPublish {
  readonly storyId: number;
  readonly markdown: string;
}

/** O contrato da rota de comments: `id` hoje, `commentId` em versões antigas. */

/**
 * O `format` dos comments usa o enum `CommentFormat` da API 7.1: `markdown` ou
 * `html`. Sem ele o relatório chega à US como texto cru, com os `#` e os
 * backticks aparecendo.
 */
const MARKDOWN_FORMAT = "markdown";

/**
 * Publica a Investigação aprovada como comment na própria US — onde a squad e o
 * PO já trabalham, e não numa tela nossa que ninguém abre (ADR 0003).
 *
 * O texto chega pronto: o LLM redigiu o conteúdo, o `investigation` renderizou o
 * Markdown, e aqui só se grava (ADR 0002). Nenhum modelo executa esta chamada.
 */
export async function publishInvestigation(
  options: AdoClientOptions,
  investigation: InvestigationToPublish,
): Promise<PublishedInvestigation> {
  const rest = createAdoRest(options);
  const { storyId, markdown } = investigation;

  const comment = await rest.request({
    operation: "a publicação da Investigação",
    path: `_apis/wit/workItems/${storyId}/comments`,
    apiVersion: COMMENTS_API_VERSION,
    query: { format: MARKDOWN_FORMAT },
    schema: commentSchema,
    write: true,
    // O chip vem primeiro: é o que o picker procura depois para mostrar a US
    // como "investigada" — e sobrevive à sanitização que o ADO aplica ao texto
    // do comment (comentários HTML não sobrevivem).
    body: { text: `${codeChip(INVESTIGATION_MARKER)}\n\n${markdown}` },
    notFound:
      `O Azure DevOps não encontrou a US #${storyId} no projeto configurado — ` +
      "nada foi publicado.",
  });

  return { commentId: comment.commentId, url: rest.workItemUrl(storyId) };
}
