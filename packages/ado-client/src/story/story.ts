import { z } from "zod";
import { createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions } from "../rest/ado-rest";

/** Uma US lida inteira — o que a Investigação manda para o agente ler. */
export interface StoryDetails {
  readonly id: number;
  readonly title: string;
  readonly type: string;
  readonly state: string;
  /** Como o PO escreveu: HTML, na maioria dos processos do ADO. */
  readonly description: string | undefined;
  readonly url: string;
}

const workItemSchema = z.object({
  id: z.number(),
  fields: z.object({
    "System.Title": z.string(),
    "System.WorkItemType": z.string().default(""),
    "System.State": z.string().default(""),
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

  return {
    id: item.id,
    title: item.fields["System.Title"],
    type: item.fields["System.WorkItemType"],
    state: item.fields["System.State"],
    description: item.fields["System.Description"],
    url: rest.workItemUrl(item.id),
  };
}
