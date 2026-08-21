import { z } from "zod";
import { inferRefinementStatus } from "../refinement/refinement-status";
import type { RefinementStatus } from "../refinement/refinement-status";
import { COMMENTS_API_VERSION, createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions, AdoRest } from "../rest/ado-rest";
import { escapeWiql, wiqlIdsSchema } from "../rest/wiql";
import { fetchBacklogItemTypes } from "../work-items/work-item-types";

/** Uma US do backlog como o picker precisa dela: identidade + onde ela está. */
export interface BacklogStory {
  readonly id: number;
  readonly title: string;
  readonly type: string;
  /** Estado do board (`New`, `Active`…) — do ADO, não do refinamento. */
  readonly state: string;
  readonly assignedTo: string | undefined;
  readonly url: string;
  readonly refinement: RefinementStatus;
}

/**
 * O backlog inteiro não cabe (nem deveria caber) numa tela de escolha: o topo
 * é onde o Operador escolhe o que refinar para a próxima sprint.
 */
const BACKLOG_LIMIT = 100;

/**
 * Campos de ordem de backlog por processo: Scrum/CMMI gravam
 * `BacklogPriority`, Agile gravava `StackRank`. Um existe, o outro não —
 * ordenar por um campo inexistente faz a WIQL inteira falhar.
 */
const PRIORITY_FIELD_CANDIDATES = [
  "Microsoft.VSTS.Common.BacklogPriority",
  "Microsoft.VSTS.Common.StackRank",
] as const;

const workItemsBatchSchema = z.object({
  value: z.array(
    z.object({
      id: z.number(),
      fields: z.object({
        "System.Title": z.string(),
        "System.WorkItemType": z.string(),
        "System.State": z.string(),
        "System.CommentCount": z.number().default(0),
        "System.Description": z.string().optional(),
        "System.AssignedTo": z.object({ displayName: z.string() }).optional(),
      }),
    }),
  ),
});

const commentsSchema = z.object({
  comments: z.array(z.object({ text: z.string() })).default([]),
});

const typeFieldsSchema = z.object({
  value: z.array(z.object({ referenceName: z.string() })),
});

/**
 * As US do backlog do produto — qualquer iteration, sem as `Removed` — cada uma
 * com o status de refinamento inferido dos artefatos que existem (ou não) no
 * próprio ADO. Backlog sempre existe: vazio é lista vazia, não caso especial.
 */
export async function fetchBacklog(
  options: AdoClientOptions,
): Promise<readonly BacklogStory[]> {
  const rest = createAdoRest(options);

  const types = await fetchBacklogItemTypes(rest);
  if (types.length === 0) return [];

  const stories = await fetchStories(rest, types);

  rest.logger.info({ stories: stories.length }, "backlog lido");

  return stories;
}

async function fetchStories(
  rest: AdoRest,
  types: readonly string[],
): Promise<readonly BacklogStory[]> {
  const priorityField = await resolvePriorityField(rest, types);

  const { workItems } = await rest.request({
    operation: "as US do backlog",
    path: "_apis/wit/wiql",
    query: { $top: String(BACKLOG_LIMIT) },
    schema: wiqlIdsSchema,
    body: { query: backlogItemsQuery(types, priorityField) },
  });

  const ids = workItems.map(({ id }) => id);
  if (ids.length === 0) return [];

  const batch = await rest.request({
    operation: "os detalhes das US",
    path: "_apis/wit/workitemsbatch",
    schema: workItemsBatchSchema,
    body: {
      ids,
      fields: [
        "System.Title",
        "System.WorkItemType",
        "System.State",
        "System.CommentCount",
        "System.Description",
        "System.AssignedTo",
      ],
    },
  });

  const byId = new Map(batch.value.map((item) => [item.id, item]));

  return Promise.all(
    ids
      .map((id) => byId.get(id))
      .filter((item) => item !== undefined)
      .map(async (item) => {
        const fields = item.fields;
        const comments =
          fields["System.CommentCount"] > 0
            ? await fetchComments(rest, item.id)
            : [];

        return {
          id: item.id,
          title: fields["System.Title"],
          type: fields["System.WorkItemType"],
          state: fields["System.State"],
          assignedTo: fields["System.AssignedTo"]?.displayName,
          url: rest.workItemUrl(item.id),
          refinement: inferRefinementStatus({
            description: fields["System.Description"],
            comments,
          }),
        } satisfies BacklogStory;
      }),
  );
}

/**
 * O campo de ordem de backlog do processo, lido dos campos do primeiro tipo de
 * item de backlog: os tipos da RequirementCategory compartilham os campos de
 * prioridade. Sem nenhum candidato, ordena por `[System.Id]` e segue.
 */
async function resolvePriorityField(
  rest: AdoRest,
  types: readonly string[],
): Promise<string | undefined> {
  const [firstType] = types;
  if (firstType === undefined) return undefined;

  const { value } = await rest.request({
    operation: "os campos do tipo de item de backlog",
    path: `_apis/wit/workitemtypes/${encodeURIComponent(firstType)}/fields`,
    schema: typeFieldsSchema,
  });

  const declared = new Set(value.map(({ referenceName }) => referenceName));
  return PRIORITY_FIELD_CANDIDATES.find((field) => declared.has(field));
}

/**
 * Uma requisição por US com comment — o custo de não manter banco próprio.
 * ponytail: teto de 200 comments (os mais novos primeiro, que é onde os
 * artefatos da ferramenta estão). Se uma US passar disso, paginar pelo
 * `continuationToken` da resposta.
 */
async function fetchComments(
  rest: AdoRest,
  workItemId: number,
): Promise<readonly string[]> {
  const { comments } = await rest.request({
    operation: "os comments da US",
    path: `_apis/wit/workItems/${workItemId}/comments`,
    apiVersion: COMMENTS_API_VERSION,
    query: { $top: "200", order: "desc" },
    schema: commentsSchema,
  });

  return comments.map(({ text }) => text);
}

/**
 * Todo o backlog do produto, não só a sprint corrente: o refinamento acontece
 * antes do planejamento, com a US ainda fora de sprint. `Removed` é a única
 * exclusão — o status de refinamento, não o estado do board, diz ao Operador
 * o que falta refinar. Só itens de backlog: tasks e test cases são o ruído que
 * o picker não lista. Aspas simples são escapadas dobrando, como manda a WIQL.
 */
function backlogItemsQuery(
  types: readonly string[],
  priorityField: string | undefined,
): string {
  const typeList = types.map((type) => `'${escapeWiql(type)}'`).join(", ");
  const orderBy =
    priorityField === undefined
      ? "ORDER BY [System.Id]"
      : `ORDER BY [${priorityField}] ASC, [System.Id] ASC`;

  return (
    "SELECT [System.Id] FROM WorkItems " +
    `WHERE [System.WorkItemType] IN (${typeList}) ` +
    "AND [System.State] <> 'Removed' " +
    orderBy
  );
}
