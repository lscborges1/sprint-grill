import { z } from "zod";
import { inferRefinementStatus } from "../refinement/refinement-status";
import type { RefinementStatus } from "../refinement/refinement-status";
import { COMMENTS_API_VERSION, createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions, AdoRest } from "../rest/ado-rest";
import { escapeWiql } from "../rest/wiql";
import { fetchBacklogItemTypes } from "../work-items/work-item-types";

/** Uma US da iteration como o picker precisa dela: identidade + onde ela está. */
export interface IterationStory {
  readonly id: number;
  readonly title: string;
  readonly type: string;
  /** Estado do board (`New`, `Active`…) — do ADO, não do refinamento. */
  readonly state: string;
  readonly assignedTo: string | undefined;
  readonly url: string;
  readonly refinement: RefinementStatus;
}

export interface CurrentIteration {
  readonly name: string;
  readonly path: string;
  readonly stories: readonly IterationStory[];
}

const teamIterationsSchema = z.object({
  value: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
    }),
  ),
});

const wiqlSchema = z.object({
  workItems: z.array(z.object({ id: z.number() })).default([]),
});

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

/**
 * As US da iteration atual do time padrão do projeto, cada uma com o status de
 * refinamento inferido dos artefatos que existem (ou não) no próprio ADO.
 * Devolve `undefined` quando o time não tem iteration corrente — ausência de
 * sprint não é falha.
 */
export async function fetchCurrentIteration(
  options: AdoClientOptions,
): Promise<CurrentIteration | undefined> {
  const rest = createAdoRest(options);

  const iterations = await rest.request({
    operation: "a iteration atual",
    path: "_apis/work/teamsettings/iterations",
    query: { $timeframe: "current" },
    schema: teamIterationsSchema,
  });

  const iteration = iterations.value[0];
  if (!iteration) {
    rest.logger.info("nenhuma iteration corrente no Azure DevOps");
    return undefined;
  }

  const stories = await fetchStories(rest, iteration.path);

  rest.logger.info(
    { iteration: iteration.name, stories: stories.length },
    "iteration atual lida",
  );

  return { name: iteration.name, path: iteration.path, stories };
}

async function fetchStories(
  rest: AdoRest,
  iterationPath: string,
): Promise<readonly IterationStory[]> {
  const types = await fetchBacklogItemTypes(rest);
  if (types.length === 0) return [];

  const { workItems } = await rest.request({
    operation: "as US da iteration",
    path: "_apis/wit/wiql",
    schema: wiqlSchema,
    body: { query: backlogItemsQuery(iterationPath, types) },
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
        } satisfies IterationStory;
      }),
  );
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
 * Só itens de backlog: tasks e test cases são o ruído da iteration, o picker
 * lista o que se refina. `UNDER` porque sprints podem ter iterations filhas.
 * Aspas simples são escapadas dobrando, como manda a WIQL.
 */
function backlogItemsQuery(
  iterationPath: string,
  types: readonly string[],
): string {
  const typeList = types.map((type) => `'${escapeWiql(type)}'`).join(", ");

  return (
    "SELECT [System.Id] FROM WorkItems " +
    `WHERE [System.IterationPath] UNDER '${escapeWiql(iterationPath)}' ` +
    `AND [System.WorkItemType] IN (${typeList}) ` +
    "ORDER BY [System.Id]"
  );
}
