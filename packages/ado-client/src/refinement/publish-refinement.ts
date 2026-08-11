import { z } from "zod";
import { AdoError } from "../ado-error";
import { SPEC_MARKER } from "./refinement-status";
import { COMMENTS_API_VERSION, createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions } from "../rest/ado-rest";

const SPEC_BLOCK_START = "<!-- sprint-griller:spec:start -->";
const SPEC_BLOCK_END = "<!-- sprint-griller:spec:end -->";
const MARKDOWN_FORMAT = "markdown";

export interface DecisionRecordToPublish {
  readonly storyId: number;
  readonly question: string;
  readonly answer: string;
  readonly recommendation: string;
  readonly decidedBy: string;
  readonly decidedAt: number;
}

export interface PublishedDecisionRecord {
  readonly commentId: number;
  /** A tela do work item é a superfície navegável onde o comment mora. */
  readonly url: string;
}

export interface StorySpecToPublish {
  readonly storyId: number;
  /** Markdown que o Operador assinou, já com o bloco de rastreabilidade. */
  readonly markdown: string;
}

const commentSchema = z.object({ commentId: z.number().int().positive() });
const storySchema = z.object({
  id: z.number().int().positive(),
  rev: z.number().int().nonnegative(),
  fields: z.object({ "System.Description": z.string().optional() }),
});
const updatedStorySchema = z.object({ id: z.number().int().positive() });

/** Renderização determinística do Registro — o LLM nunca participa da escrita. */
export function renderDecisionRecordMarkdown(record: Omit<DecisionRecordToPublish, "storyId">): string {
  return [
    "# Registro de decisão",
    `**Pergunta:** ${record.question}`,
    `**Decisão:** ${record.answer}`,
    `**Recomendação do agente:** ${record.recommendation}`,
    `**Decidido por:** ${record.decidedBy}`,
    `**Quando:** ${new Date(record.decidedAt).toISOString()}`,
  ].join("\n\n");
}

/** Cria o comment que é o Registro de decisão de uma resposta humana da sessão. */
export async function publishDecisionRecord(
  options: AdoClientOptions,
  record: DecisionRecordToPublish,
): Promise<PublishedDecisionRecord> {
  const rest = createAdoRest(options);
  const comment = await rest.request({
    operation: "o Registro de decisão",
    path: `_apis/wit/workItems/${record.storyId}/comments`,
    apiVersion: COMMENTS_API_VERSION,
    query: { format: MARKDOWN_FORMAT },
    schema: commentSchema,
    write: true,
    body: { text: renderDecisionRecordMarkdown(record) },
    notFound: `O Azure DevOps não encontrou a US #${record.storyId} no projeto configurado — nada foi publicado.`,
  });

  return { commentId: comment.commentId, url: rest.workItemUrl(record.storyId) };
}

/** Atualiza só o bloco do Sprint Griller, sem tocar no texto da US do PO. */
export async function publishStorySpec(
  options: AdoClientOptions,
  spec: StorySpecToPublish,
): Promise<void> {
  const rest = createAdoRest(options);
  const story = await rest.request({
    operation: "a descrição atual da US",
    path: `_apis/wit/workitems/${spec.storyId}`,
    schema: storySchema,
    notFound: `O Azure DevOps não encontrou a US #${spec.storyId} no projeto configurado — nada foi publicado.`,
  });
  const description = replaceManagedSpec(story.fields["System.Description"] ?? "", spec.markdown);

  await rest.request({
    operation: "a Spec da US",
    path: `_apis/wit/workitems/${spec.storyId}`,
    schema: updatedStorySchema,
    method: "PATCH",
    contentType: "application/json-patch+json",
    write: true,
    conflict:
      "A US mudou enquanto o despejo era preparado. Recarregue o Dossiê e confirme de novo; a Spec não foi gravada.",
    body: [
      { op: "test", path: "/rev", value: story.rev },
      { op: "add", path: "/fields/System.Description", value: description },
    ],
  });
}

/** Exportado para cobrir o contrato de preservação do texto já escrito na US. */
export function replaceManagedSpec(description: string, markdown: string): string {
  const block = `${SPEC_MARKER}\n${SPEC_BLOCK_START}\n${markdown}\n${SPEC_BLOCK_END}`;
  const start = description.indexOf(SPEC_BLOCK_START);
  if (start === -1) return description === "" ? block : `${description}\n\n${block}`;

  const end = description.indexOf(SPEC_BLOCK_END, start);
  if (end === -1) {
    throw new AdoError(
      "unexpected",
      "A Spec anterior do Sprint Griller está sem o marcador de fechamento. " +
        "Corrija a descrição da US antes de despejar; a Spec não foi gravada.",
    );
  }

  const markerStart = description.lastIndexOf(SPEC_MARKER, start);
  const replaceStart = markerStart === -1 ? start : markerStart;
  return `${description.slice(0, replaceStart)}${block}${description.slice(end + SPEC_BLOCK_END.length)}`;
}
