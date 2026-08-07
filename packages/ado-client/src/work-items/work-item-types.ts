import { z } from "zod";
import type { AdoRest } from "../rest/ado-rest";

/**
 * Categoria de processo que o ADO usa para "o que é item de backlog": resolve
 * para User Story (Agile), Product Backlog Item (Scrum) ou Requirement (CMMI)
 * conforme o projeto. Perguntar sai mais barato que chutar o nome do tipo.
 */
const BACKLOG_ITEM_CATEGORY = "Microsoft.RequirementCategory";

const backlogItemTypesSchema = z.object({
  workItemTypes: z.array(z.object({ name: z.string() })),
});

/** Como o processo do projeto chama "item de backlog" — não dá para hardcodar. */
export async function fetchBacklogItemTypes(
  rest: AdoRest,
): Promise<readonly string[]> {
  const { workItemTypes } = await rest.request({
    operation: "os tipos de item de backlog",
    path: `_apis/wit/workitemtypecategories/${BACKLOG_ITEM_CATEGORY}`,
    schema: backlogItemTypesSchema,
  });

  if (workItemTypes.length === 0) {
    rest.logger.warn(
      { category: BACKLOG_ITEM_CATEGORY },
      "o processo do projeto não declara nenhum tipo de item de backlog",
    );
  }

  return workItemTypes.map(({ name }) => name);
}

/**
 * Como o ADO agrupa os estados de um work item. Só a categoria é estável entre
 * processos: `Done` (Scrum) e `Closed` (Agile) são ambos `Completed`, e quem
 * comparar pelo nome do estado erra a conta assim que a squad troca de template.
 */
export const STATE_CATEGORIES = [
  "Proposed",
  "InProgress",
  "Resolved",
  "Completed",
  "Removed",
] as const;

export type StateCategory = (typeof STATE_CATEGORIES)[number];

const statesSchema = z.object({
  value: z.array(
    z.object({
      name: z.string(),
      category: z.enum(STATE_CATEGORIES),
    }),
  ),
});

/**
 * Mapa `estado do board` → categoria, unindo todos os tipos de item de backlog
 * do processo. Estado que o ADO não declarar fica de fora do mapa — quem
 * consulta decide o que fazer com o desconhecido, em vez de virar `Completed`
 * por engano.
 */
export async function fetchStateCategories(
  rest: AdoRest,
  types: readonly string[],
): Promise<ReadonlyMap<string, StateCategory>> {
  const perType = await Promise.all(
    types.map((type) =>
      rest.request({
        operation: `os estados de ${type}`,
        path: `_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`,
        schema: statesSchema,
      }),
    ),
  );

  return new Map(
    perType.flatMap(({ value }) =>
      value.map(({ name, category }) => [name, category] as const),
    ),
  );
}
