import { z } from "zod";
import { INVESTIGATION_MARKER } from "../refinement/refinement-status";
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

const commentSchema = z.object({ id: z.number() });

/**
 * O `format` dos comments é numérico, não o nome: `0` é Markdown e `1` é HTML
 * (`CommentFormat` no `azure-devops-node-api`, e é assim que o MCP oficial da
 * Microsoft monta a query). Sem ele o relatório chega à US como texto cru, com
 * os `#` e os backticks aparecendo.
 */
const MARKDOWN_FORMAT = "0";

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
    // O marcador vem primeiro e é invisível para quem lê no ADO. É o que o
    // picker procura depois para mostrar a US como "investigada".
    body: { text: `${INVESTIGATION_MARKER}\n\n${markdown}` },
    notFound:
      `O Azure DevOps não encontrou a US #${storyId} no projeto configurado — ` +
      "nada foi publicado.",
  });

  return { commentId: comment.id, url: rest.workItemUrl(storyId) };
}
