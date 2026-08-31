import { z } from "zod";
import { createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions } from "../rest/ado-rest";
import { fetchWikiContext } from "../wiki/wiki";
import type { WikiContext } from "../wiki/wiki";

/** Uma US lida inteira — o que a Investigação manda para o agente ler. */
export interface StoryDetails {
  readonly id: number;
  readonly title: string;
  readonly type: string;
  readonly state: string;
  /** Revisão do work item — sobe a qualquer edição; invalida análises antigas. */
  readonly rev: number;
  /** Como o PO escreveu: HTML, na maioria dos processos do ADO. */
  readonly description: string | undefined;
  readonly url: string;
  readonly wikiContext: WikiContext;
}

const workItemSchema = z.object({
  id: z.number(),
  fields: z.object({
    "System.Title": z.string(),
    "System.WorkItemType": z.string().default(""),
    "System.State": z.string().default(""),
    "System.Rev": z.number().default(1),
    "System.Description": z.string().optional(),
  }),
});

export async function fetchStory(
  options: AdoClientOptions,
  id: number,
): Promise<StoryDetails> {
  const rest = createAdoRest(options);

  const item = await rest.request({
    operation: "a US",
    path: `_apis/wit/workitems/${id}`,
    schema: workItemSchema,
    notFound: `O Azure DevOps não encontrou a US #${id} no projeto configurado.`,
  });
  const wikiContext = await fetchWikiContext(options, {
    storyId: item.id,
    description: item.fields["System.Description"],
  });

  return {
    id: item.id,
    title: item.fields["System.Title"],
    type: item.fields["System.WorkItemType"],
    state: item.fields["System.State"],
    rev: item.fields["System.Rev"],
    description: item.fields["System.Description"],
    url: rest.workItemUrl(item.id),
    wikiContext,
  };
}
