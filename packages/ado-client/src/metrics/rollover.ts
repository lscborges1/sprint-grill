import { z } from "zod";
import { createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions, AdoRest } from "../rest/ado-rest";
import { asOfLiteral, escapeWiql, wiqlIdsSchema } from "../rest/wiql";
import {
  fetchBacklogItemTypes,
  fetchStateCategories,
} from "../work-items/work-item-types";
import type { StateCategory } from "../work-items/work-item-types";

/** Quantas sprints encerradas a baseline retroativa olha para trás. */
const DEFAULT_SPRINTS = 6;

export interface RolloverCounts {
  /** US que entraram na sprint, sem as que foram removidas do processo. */
  readonly scope: number;
  readonly completed: number;
  readonly rolled: number;
  readonly removed: number;
  /**
   * `rolled / scope`, ou `undefined` quando nenhuma US entrou — 0 de 0 não é
   * 0% de rolagem, e uma sprint vazia não pode maquiar a média da baseline.
   */
  readonly rate: number | undefined;
}

export interface SprintRollover extends RolloverCounts {
  readonly name: string;
  readonly path: string;
  readonly startDate: Date;
  readonly finishDate: Date;
}

export interface RolloverBaseline {
  /** Da sprint mais antiga para a mais recente. */
  readonly sprints: readonly SprintRollover[];
  readonly total: RolloverCounts;
}

export interface RolloverBaselineOptions extends AdoClientOptions {
  /** Quantas sprints encerradas olhar para trás (padrão: seis). */
  readonly sprints?: number;
  /** Injetado pelos testes; em produção é o relógio. */
  readonly now?: Date;
}

const iterationsSchema = z.object({
  value: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      attributes: z
        .object({
          startDate: z.string().nullish(),
          finishDate: z.string().nullish(),
        })
        .nullish(),
    }),
  ),
});

const statesBatchSchema = z.object({
  value: z.array(
    z.object({
      id: z.number(),
      fields: z.object({ "System.State": z.string() }),
    }),
  ),
});

interface ClosedSprint {
  readonly name: string;
  readonly path: string;
  readonly startDate: Date;
  readonly finishDate: Date;
  /**
   * O instante em que a sprint de fato acabou. O `finishDate` do ADO é a
   * meia-noite que *abre* o último dia: fotografar ali contaria como rolada toda
   * US concluída no último dia — justo o dia em que a squad mais fecha coisa.
   */
  readonly closesAt: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Taxa de rolagem — % de US que entram numa sprint e não concluem nela — das
 * últimas sprints encerradas, direto do ADO cru via WIQL `ASOF`.
 *
 * A conta é deliberadamente agregada por sprint: nada aqui pergunta ao ADO de
 * quem é a US, porque a baseline existe para a squad julgar o processo, não
 * para o processo julgar a squad. É também somente leitura — nenhuma rota
 * usada abaixo escreve no tracker.
 */
export async function fetchRolloverBaseline(
  options: RolloverBaselineOptions,
): Promise<RolloverBaseline> {
  const rest = createAdoRest(options);
  const closed = await closedSprints(
    rest,
    options.now ?? new Date(),
    options.sprints ?? DEFAULT_SPRINTS,
  );

  if (closed.length === 0) {
    rest.logger.info("nenhuma sprint encerrada no Azure DevOps");
    return emptyBaseline();
  }

  const types = await fetchBacklogItemTypes(rest);
  if (types.length === 0) return emptyBaseline();

  const categories = await fetchStateCategories(rest, types);

  // Sequencial de propósito: são poucas sprints e o ADO limita requisições por
  // minuto — a baseline não tem pressa, e um 429 no meio custa a demo.
  const sprints: SprintRollover[] = [];
  for (const sprint of closed) {
    sprints.push(await sprintRollover(rest, sprint, types, categories));
  }

  const total = totalOf(sprints);
  rest.logger.info(
    { sprints: sprints.length, scope: total.scope, rate: total.rate },
    "baseline de rolagem calculada",
  );

  return { sprints, total };
}

function emptyBaseline(): RolloverBaseline {
  return { sprints: [], total: totalOf([]) };
}

/**
 * As últimas `count` iterations do time que já fecharam, da mais antiga para a
 * mais recente. A sprint em curso fica de fora: a rolagem dela ainda não
 * aconteceu, e contá-la marcaria como rolada toda US que ainda está em dia.
 */
async function closedSprints(
  rest: AdoRest,
  now: Date,
  count: number,
): Promise<readonly ClosedSprint[]> {
  const { value } = await rest.request({
    operation: "as iterations do time",
    path: "_apis/work/teamsettings/iterations",
    schema: iterationsSchema,
  });

  return value
    .map((iteration) => {
      const startDate = parseDate(iteration.attributes?.startDate);
      const finishDate = parseDate(iteration.attributes?.finishDate);
      if (!startDate || !finishDate) return undefined;
      return {
        name: iteration.name,
        path: iteration.path,
        startDate,
        finishDate,
        closesAt: new Date(finishDate.getTime() + ONE_DAY_MS),
      } satisfies ClosedSprint;
    })
    .filter((sprint) => sprint !== undefined)
    .filter(({ closesAt }) => closesAt.getTime() <= now.getTime())
    .sort((a, b) => a.finishDate.getTime() - b.finishDate.getTime())
    .slice(-count);
}

/**
 * O escopo da sprint é a **união** de dois snapshots: quem estava nela na
 * abertura e quem estava no fechamento. Só a abertura perderia as US puxadas no
 * meio; só o fechamento perderia as que saíram antes do fim — e essas são
 * exatamente as que rolaram.
 */
async function sprintRollover(
  rest: AdoRest,
  sprint: ClosedSprint,
  types: readonly string[],
  categories: ReadonlyMap<string, StateCategory>,
): Promise<SprintRollover> {
  const [atStart, atFinish] = await Promise.all([
    backlogItemsAsOf(rest, sprint, types, sprint.startDate),
    backlogItemsAsOf(rest, sprint, types, sprint.closesAt),
  ]);

  const ids = [...new Set([...atStart, ...atFinish])];
  const states = await statesAsOf(rest, ids, sprint.closesAt);

  let completed = 0;
  let removed = 0;
  const unknown: string[] = [];
  for (const id of ids) {
    const state = states.get(id);
    const category = state === undefined ? undefined : categories.get(state);
    if (category === "Completed") completed += 1;
    else if (category === "Removed") removed += 1;
    else if (category === undefined) unknown.push(state ?? "(sem estado)");
  }

  // Numa baseline retroativa isto acontece: estado aposentado do processo desde
  // então não volta em `workitemtypes/{type}/states`, e a US cai em "rolou" sem
  // ninguém saber. O número que a retro discute não pode ter buraco silencioso.
  if (unknown.length > 0) {
    rest.logger.warn(
      { sprint: sprint.name, states: [...new Set(unknown)].sort() },
      "estado fora do processo atual contado como rolagem",
    );
  }

  return {
    name: sprint.name,
    path: sprint.path,
    startDate: sprint.startDate,
    finishDate: sprint.finishDate,
    ...counts({ scope: ids.length - removed, completed, removed }),
  };
}

/** As US que estavam sob o path da sprint num instante — WIQL crua, sem detalhe. */
async function backlogItemsAsOf(
  rest: AdoRest,
  sprint: ClosedSprint,
  types: readonly string[],
  instant: Date,
): Promise<readonly number[]> {
  const typeList = types.map((type) => `'${escapeWiql(type)}'`).join(", ");

  const { workItems } = await rest.request({
    operation: `as US de ${sprint.name}`,
    path: "_apis/wit/wiql",
    schema: wiqlIdsSchema,
    body: {
      query:
        "SELECT [System.Id] FROM WorkItems " +
        `WHERE [System.IterationPath] UNDER '${escapeWiql(sprint.path)}' ` +
        `AND [System.WorkItemType] IN (${typeList}) ` +
        `ASOF ${asOfLiteral(instant)}`,
    },
  });

  return workItems.map(({ id }) => id);
}

/** Teto de ids por `workitemsbatch` — passar disso o ADO recusa com 400. */
const BATCH_LIMIT = 200;

/**
 * O estado de cada US como estava no fechamento da sprint. Só `System.State`
 * sai do ADO: título e responsável não entram numa métrica agregada.
 */
async function statesAsOf(
  rest: AdoRest,
  ids: readonly number[],
  instant: Date,
): Promise<ReadonlyMap<number, string>> {
  const states = new Map<number, string>();

  for (let from = 0; from < ids.length; from += BATCH_LIMIT) {
    const { value } = await rest.request({
      operation: "os estados das US no fechamento da sprint",
      path: "_apis/wit/workitemsbatch",
      schema: statesBatchSchema,
      body: {
        ids: ids.slice(from, from + BATCH_LIMIT),
        fields: ["System.State"],
        asOf: instant.toISOString(),
      },
    });

    for (const item of value) {
      states.set(item.id, item.fields["System.State"]);
    }
  }

  return states;
}

function counts(raw: Omit<RolloverCounts, "rolled" | "rate">): RolloverCounts {
  const rolled = raw.scope - raw.completed;
  return {
    ...raw,
    rolled,
    rate: raw.scope === 0 ? undefined : rolled / raw.scope,
  };
}

function totalOf(sprints: readonly RolloverCounts[]): RolloverCounts {
  return counts(
    sprints.reduce(
      (sum, sprint) => ({
        scope: sum.scope + sprint.scope,
        completed: sum.completed + sprint.completed,
        removed: sum.removed + sprint.removed,
      }),
      { scope: 0, completed: 0, removed: 0 },
    ),
  );
}

/** Iteration sem data não entra na baseline: não dá para dizer quando fechou. */
function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
