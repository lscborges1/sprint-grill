import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { AdoError } from "../ado-error";
import { fetchRolloverBaseline } from "./rollover";

const AZURE_DEVOPS = { organization: "acme", project: "Plataforma" };
const CREDENTIALS = { pat: "pat-de-teste" };

/** Os testes exercitam a fronteira, não o log — que iria para o stdout do runner. */
const SILENT_LOGGER = createLogger({
  destination: new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }),
  level: "fatal",
});

/** Depois da última sprint dos fixtures: tudo abaixo já fechou. */
const NOW = new Date("2026-03-02T00:00:00Z");

/** Estados do processo Agile, com a categoria que o ADO devolve para cada um. */
const AGILE_STATES = {
  New: "Proposed",
  Active: "InProgress",
  Resolved: "Resolved",
  Closed: "Completed",
  Removed: "Removed",
} as const;

interface FakeSprint {
  readonly name: string;
  readonly startDate: string;
  readonly finishDate: string;
  /** Ids UNDER o path da sprint no snapshot de abertura. */
  readonly atStart?: readonly number[];
  /** Ids UNDER o path no fechamento; sem isto, os mesmos da abertura. */
  readonly atFinish?: readonly number[];
  /** Estado no fechamento da sprint, por id. Sem entrada, a US está `Active`. */
  readonly statesAtFinish?: Readonly<Record<number, string>>;
  /**
   * Estado na meia-noite que *abre* o último dia da sprint. Só os testes de
   * limite preenchem; sem isto, o dia inteiro tem o estado do fechamento.
   */
  readonly statesAtLastDayStart?: Readonly<Record<number, string>>;
}

/**
 * O ADO data o `finishDate` na meia-noite que abre o último dia da sprint — o
 * fechamento de verdade é 24h depois, e é ali que o fixture responde.
 */
function closesAt(sprint: FakeSprint): string {
  return new Date(
    new Date(sprint.finishDate).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
}

interface FakeAdoState {
  readonly sprints?: readonly FakeSprint[];
  readonly backlogItemTypes?: readonly string[];
  /**
   * Categorias por tipo de item. Sem isto, todos os tipos usam o Agile padrão.
   * Serve para exercitar o caso em que o mesmo rótulo de estado tem categorias
   * distintas em tipos diferentes.
   */
  readonly statesByType?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  /** Tipo do work item por id; sem entrada, cai no primeiro tipo de backlog. */
  readonly workItemTypesById?: Readonly<Record<number, string>>;
}

function sprintPath(name: string): string {
  return `Plataforma\\${name}`;
}

/** Uma sprint fechada em janeiro, para os testes que só olham uma. */
function oneSprint(sprint: Omit<FakeSprint, "name" | "startDate" | "finishDate">): FakeSprint {
  return {
    name: "Sprint 41",
    startDate: "2026-01-19T00:00:00Z",
    finishDate: "2026-01-30T00:00:00Z",
    ...sprint,
  };
}

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** Azure DevOps de mentira: responde com snapshots ASOF por sprint. */
function fakeAdo(state: FakeAdoState = {}) {
  const sprints = state.sprints ?? [oneSprint({})];
  const backlogItemTypes = state.backlogItemTypes ?? ["User Story"];
  const requests: RecordedRequest[] = [];

  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body: unknown =
        init?.body === undefined ? undefined : JSON.parse(String(init.body));
      requests.push({ method: init?.method ?? "GET", url, body });

      if (url.includes("/_apis/work/teamsettings/iterations?")) {
        return json({
          value: sprints.map((sprint, index) => ({
            id: `it-${index}`,
            name: sprint.name,
            path: sprintPath(sprint.name),
            attributes: {
              startDate: sprint.startDate,
              finishDate: sprint.finishDate,
              timeFrame: "past",
            },
          })),
        });
      }

      if (url.includes("/_apis/wit/workitemtypecategories/")) {
        return json({
          workItemTypes: backlogItemTypes.map((name) => ({ name })),
        });
      }

      const typeStates = /\/_apis\/wit\/workitemtypes\/([^/]+)\/states/.exec(url);
      if (typeStates) {
        const type = decodeURIComponent(typeStates[1] ?? "");
        const categories = state.statesByType?.[type] ?? AGILE_STATES;
        return json({
          value: Object.entries(categories).map(([name, category]) => ({
            name,
            category,
          })),
        });
      }

      if (url.includes("/_apis/wit/wiql")) {
        const query = String((body as { query: string }).query);
        const sprint = sprintIn(sprints, query);
        const asOf = /ASOF '([^']+)'/.exec(query)?.[1];
        const ids = sameInstant(asOf, sprint.startDate)
          ? (sprint.atStart ?? [])
          : (sprint.atFinish ?? sprint.atStart ?? []);
        return json({ workItems: ids.map((id) => ({ id })) });
      }

      if (url.includes("/_apis/wit/workitemsbatch")) {
        const batch = body as { ids: number[]; asOf: string; fields: string[] };
        const states = statesAt(sprints, batch.asOf);
        const defaultType = backlogItemTypes[0] ?? "User Story";

        return json({
          value: batch.ids.map((id) => ({
            id,
            fields: {
              "System.State": states[id] ?? "Active",
              "System.WorkItemType":
                state.workItemTypesById?.[id] ?? defaultType,
            },
          })),
        });
      }

      throw new Error(`rota não esperada no ADO de mentira: ${url}`);
    },
  );

  return Object.assign(fetchMock, { requests });
}

/**
 * Os estados do board no instante pedido: a linha do tempo do fixture tem duas
 * fotos por sprint — a meia-noite que abre o último dia e o fechamento, 24h
 * depois. Pedir qualquer outro instante é bug do client, não do fixture.
 */
function statesAt(
  sprints: readonly FakeSprint[],
  asOf: string,
): Readonly<Record<number, string>> {
  const atClose = sprints.find((sprint) => sameInstant(asOf, closesAt(sprint)));
  if (atClose) return atClose.statesAtFinish ?? {};

  const atLastDayStart = sprints.find((sprint) =>
    sameInstant(asOf, sprint.finishDate),
  );
  if (atLastDayStart) {
    return atLastDayStart.statesAtLastDayStart ?? atLastDayStart.statesAtFinish ?? {};
  }

  throw new Error(`estado pedido fora do fechamento de alguma sprint: ${asOf}`);
}

/** O client manda `toISOString()`; o fixture escreve o mesmo instante sem os ms. */
function sameInstant(one: string | undefined, other: string): boolean {
  return one !== undefined && new Date(one).getTime() === new Date(other).getTime();
}

function sprintIn(
  sprints: readonly FakeSprint[],
  query: string,
): FakeSprint {
  const path = /UNDER '([^']+)'/.exec(query)?.[1];
  const sprint = sprints.find((candidate) => sprintPath(candidate.name) === path);
  if (!sprint) throw new Error(`WIQL sem sprint conhecida: ${query}`);
  return sprint;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Logger que guarda as linhas, para os testes que checam o que foi avisado. */
function capturingLogger() {
  const lines: { level: string; msg: string; states?: string[] }[] = [];

  const logger = createLogger({
    level: "trace",
    destination: new Writable({
      write(chunk, _encoding, done) {
        lines.push(JSON.parse(String(chunk)));
        done();
      },
    }),
  });

  return Object.assign(logger, { lines });
}

/** Aponta a baseline para o ADO de mentira, com o resto da config preenchido. */
function baselineAgainst(
  state: FakeAdoState = {},
  options: { readonly sprints?: number; readonly before?: Date } = {},
) {
  return fetchRolloverBaseline({
    azureDevOps: AZURE_DEVOPS,
    credentials: CREDENTIALS,
    logger: SILENT_LOGGER,
    fetch: fakeAdo(state),
    now: NOW,
    ...options,
  });
}

describe("fetchRolloverBaseline", () => {
  it("should report how many US entered the sprint and did not finish in it", async () => {
    const baseline = await baselineAgainst({
      sprints: [
        oneSprint({
          atStart: [1, 2, 3, 4],
          statesAtFinish: { 1: "Closed", 2: "Closed", 3: "Active", 4: "New" },
        }),
      ],
    });

    expect(baseline.sprints).toEqual([
      expect.objectContaining({
        name: "Sprint 41",
        path: "Plataforma\\Sprint 41",
        scope: 4,
        completed: 2,
        rolled: 2,
        removed: 0,
        rate: 0.5,
      }),
    ]);
  });

  it("should count a US moved out of the sprint before it closed as rolled over", async () => {
    // Mesmo fechada noutro path antes do fim desta sprint: saiu daqui, rolou.
    const baseline = await baselineAgainst({
      sprints: [
        oneSprint({
          atStart: [1, 2],
          atFinish: [1],
          statesAtFinish: { 1: "Closed", 2: "Closed" },
        }),
      ],
    });

    expect(baseline.total).toMatchObject({ scope: 2, completed: 1, rolled: 1 });
  });

  it("should count a US pulled into the sprint after it started, since it entered too", async () => {
    const baseline = await baselineAgainst({
      sprints: [
        oneSprint({
          atStart: [1],
          atFinish: [1, 2],
          statesAtFinish: { 1: "Closed", 2: "Closed" },
        }),
      ],
    });

    expect(baseline.total).toMatchObject({ scope: 2, completed: 2, rolled: 0, rate: 0 });
  });

  it("should leave a US removed from the sprint out of the rollover rate", async () => {
    const baseline = await baselineAgainst({
      sprints: [
        oneSprint({
          atStart: [1, 2, 3],
          statesAtFinish: { 1: "Closed", 2: "Removed", 3: "Active" },
        }),
      ],
    });

    expect(baseline.total).toMatchObject({
      scope: 2,
      completed: 1,
      rolled: 1,
      removed: 1,
      rate: 0.5,
    });
  });

  it("should treat a US left in Resolved at the sprint close as rolled, not completed", async () => {
    const baseline = await baselineAgainst({
      sprints: [oneSprint({ atStart: [1], statesAtFinish: { 1: "Resolved" } })],
    });

    expect(baseline.total).toMatchObject({ completed: 0, rolled: 1, rate: 1 });
  });

  it("should classify a shared state label by work-item type, not overwrite one category with another", async () => {
    // Dois tipos de backlog com o mesmo rótulo e categorias diferentes: um mapa
    // só por nome sobrescreve o primeiro e corrompe o total da baseline.
    const baseline = await baselineAgainst({
      backlogItemTypes: ["User Story", "Product Backlog Item"],
      statesByType: {
        "User Story": { ...AGILE_STATES, Ready: "Proposed" },
        "Product Backlog Item": { ...AGILE_STATES, Ready: "Completed" },
      },
      workItemTypesById: {
        1: "User Story",
        2: "Product Backlog Item",
      },
      sprints: [
        oneSprint({
          atStart: [1, 2],
          statesAtFinish: { 1: "Ready", 2: "Ready" },
        }),
      ],
    });

    expect(baseline.total).toMatchObject({
      scope: 2,
      completed: 1,
      rolled: 1,
      rate: 0.5,
    });
  });

  it("should ask Azure DevOps for work-item type alongside state when classifying", async () => {
    const ado = fakeAdo({ sprints: [oneSprint({ atStart: [1] })] });

    await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: ado,
      now: NOW,
    });

    const batchFields = ado.requests
      .filter(({ url }) => url.includes("workitemsbatch"))
      .map(({ body }) => (body as { fields: string[] }).fields);

    expect(batchFields).toEqual([
      expect.arrayContaining(["System.State", "System.WorkItemType"]),
    ]);
  });

  it("should count a US closed on the sprint's last day as completed, not rolled", async () => {
    // O `finishDate` do ADO é a meia-noite que abre o último dia: fotografar
    // ali marcaria como rolada toda US fechada no dia em que a squad mais fecha.
    const baseline = await baselineAgainst({
      sprints: [
        oneSprint({
          atStart: [1],
          statesAtLastDayStart: { 1: "Active" },
          statesAtFinish: { 1: "Closed" },
        }),
      ],
    });

    expect(baseline.total).toMatchObject({ completed: 1, rolled: 0, rate: 0 });
  });

  it("should warn when a US sits in a state the process no longer declares, instead of silently counting it as rolled", async () => {
    // Baseline retroativa esbarra nisto: estado aposentado do processo não volta
    // em `workitemtypes/{type}/states` e sumiria dentro do número da retro.
    const logger = capturingLogger();

    const baseline = await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger,
      fetch: fakeAdo({
        sprints: [
          oneSprint({
            atStart: [1, 2],
            statesAtFinish: { 1: "Closed", 2: "Em homologação" },
          }),
        ],
      }),
      now: NOW,
    });

    expect(baseline.total).toMatchObject({ scope: 2, completed: 1, rolled: 1 });
    expect(
      logger.lines.filter(
        ({ level, states }) =>
          level === "warn" && states?.includes("Em homologação"),
      ),
    ).toHaveLength(1);
  });

  it("should ask Azure DevOps in batches of 200, the most ids it accepts at once", async () => {
    const ids = Array.from({ length: 201 }, (_unused, index) => index + 1);
    const ado = fakeAdo({ sprints: [oneSprint({ atStart: ids })] });

    const baseline = await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: ado,
      now: NOW,
    });

    const batches = ado.requests
      .filter(({ url }) => url.includes("workitemsbatch"))
      .map(({ body }) => (body as { ids: number[] }).ids.length);

    expect(batches).toEqual([200, 1]);
    expect(baseline.total.scope).toBe(201);
  });

  it("should look only at the last six closed sprints by default", async () => {
    const baseline = await baselineAgainst({ sprints: eightClosedSprints() });

    expect(baseline.sprints.map(({ name }) => name)).toEqual([
      "Sprint 3",
      "Sprint 4",
      "Sprint 5",
      "Sprint 6",
      "Sprint 7",
      "Sprint 8",
    ]);
  });

  it("should look back as far as asked when the squad wants a different window", async () => {
    const baseline = await baselineAgainst({ sprints: eightClosedSprints() }, { sprints: 2 });

    expect(baseline.sprints.map(({ name }) => name)).toEqual([
      "Sprint 7",
      "Sprint 8",
    ]);
  });

  it("should exclude post-rollout sprints when a cutoff is provided", async () => {
    const baseline = await baselineAgainst(
      { sprints: eightClosedSprints() },
      { before: new Date("2026-01-10T00:00:00Z") },
    );

    expect(baseline.sprints.map(({ name }) => name)).toEqual([
      "Sprint 1",
      "Sprint 2",
      "Sprint 3",
      "Sprint 4",
    ]);
  });

  it("should include the sprint whose close is exactly the cutoff midnight", async () => {
    const baseline = await baselineAgainst(
      {
        sprints: [
          {
            name: "Sprint before rollout",
            startDate: "2026-01-26T00:00:00Z",
            finishDate: "2026-01-31T00:00:00Z",
            atStart: [1],
            statesAtFinish: { 1: "Closed" },
          },
          {
            name: "Sprint after rollout",
            startDate: "2026-02-01T00:00:00Z",
            finishDate: "2026-02-06T00:00:00Z",
            atStart: [2],
            statesAtFinish: { 2: "Closed" },
          },
        ],
      },
      { before: new Date("2026-02-01T00:00:00Z") },
    );

    expect(baseline.sprints.map(({ name }) => name)).toEqual([
      "Sprint before rollout",
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "should reject an invalid sprint window (%s)",
    async (sprints) => {
      await expect(
        baselineAgainst({ sprints: eightClosedSprints() }, { sprints }),
      ).rejects.toThrow(TypeError);
    },
  );

  it("should ignore the running sprint, whose rollover has not happened yet", async () => {
    const baseline = await baselineAgainst({
      sprints: [
        oneSprint({ atStart: [1] }),
        {
          name: "Sprint 42",
          startDate: "2026-02-23T00:00:00Z",
          finishDate: "2026-03-06T00:00:00Z",
          atStart: [2],
        },
      ],
    });

    expect(baseline.sprints.map(({ name }) => name)).toEqual(["Sprint 41"]);
  });

  it("should never ask Azure DevOps who a US is assigned to, so the numbers cannot be read per person", async () => {
    const ado = fakeAdo({ sprints: [oneSprint({ atStart: [1, 2] })] });

    await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: ado,
      now: NOW,
    });

    expect(JSON.stringify(ado.requests)).not.toMatch(/AssignedTo/);
  });

  it("should only read from Azure DevOps, never write", async () => {
    const ado = fakeAdo({ sprints: [oneSprint({ atStart: [1, 2] })] });

    await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: ado,
      now: NOW,
    });

    // Consultas WIQL e batch são POST por causa do corpo; escrita no ADO é
    // PATCH/PUT/DELETE, e nenhuma rota aqui é de escrita.
    expect(
      ado.requests.filter(
        ({ method, url }) =>
          method === "POST" &&
          !/\/_apis\/wit\/(wiql|workitemsbatch)/.test(url),
      ),
    ).toEqual([]);
    expect(ado.requests.map(({ method }) => method)).not.toContain("PATCH");
  });

  it("should report no rate at all for a sprint nobody planned, instead of a flattering zero", async () => {
    const baseline = await baselineAgainst({ sprints: [oneSprint({ atStart: [] })] });

    expect(baseline.sprints[0]).toMatchObject({ scope: 0, rate: undefined });
    expect(baseline.total.rate).toBeUndefined();
  });

  it("should come back empty when the team has no closed sprint to look at", async () => {
    const logger = capturingLogger();
    const baseline = await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger,
      fetch: fakeAdo({
        sprints: [
          {
            name: "Sprint 42",
            startDate: "2026-02-23T00:00:00Z",
            finishDate: "2026-03-06T00:00:00Z",
            atStart: [1],
          },
        ],
      }),
      now: NOW,
    });

    expect(baseline).toEqual({
      sprints: [],
      total: { scope: 0, completed: 0, rolled: 0, removed: 0, rate: undefined },
    });
    expect(logger.lines).toContainEqual(
      expect.objectContaining({
        msg: "nenhuma sprint encerrada no Azure DevOps",
        closedSprints: 0,
      }),
    );
  });

  it("should refuse an off-contract payload instead of showing half a baseline", async () => {
    const failing = await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: vi.fn(async () => json({ value: [{ name: "Sprint 41" }] })),
      now: NOW,
    }).catch((error: unknown) => error);

    expect(failing).toBeInstanceOf(AdoError);
    expect(failing).toMatchObject({ kind: "unexpected-response" });
  });

  it("should refuse a malformed iteration date instead of silently dropping the sprint", async () => {
    const failing = await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/_apis/work/teamsettings/iterations?")) {
          return json({
            value: [
              {
                name: "Sprint 41",
                path: "Plataforma\\Sprint 41",
                attributes: {
                  startDate: "2026-01-19T00:00:00Z",
                  finishDate: "não-é-data",
                },
              },
            ],
          });
        }
        throw new Error(`rota não esperada: ${String(input)}`);
      }),
      now: NOW,
    }).catch((error: unknown) => error);

    expect(failing).toBeInstanceOf(AdoError);
    expect(failing).toMatchObject({ kind: "unexpected-response" });
  });

  it("should refuse an iteration date without an offset instead of using the machine timezone", async () => {
    const failing = await fetchRolloverBaseline({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/_apis/work/teamsettings/iterations?")) {
          return json({
            value: [
              {
                name: "Sprint 41",
                path: "Plataforma\\Sprint 41",
                attributes: {
                  startDate: "2026-01-19T00:00:00Z",
                  finishDate: "2026-01-30T00:00:00",
                },
              },
            ],
          });
        }
        throw new Error(`rota não esperada: ${String(input)}`);
      }),
      now: NOW,
    }).catch((error: unknown) => error);

    expect(failing).toBeInstanceOf(AdoError);
    expect(failing).toMatchObject({ kind: "unexpected-response" });
  });
});

/** Oito sprints fechadas em sequência, para exercitar a janela da baseline. */
function eightClosedSprints(): readonly FakeSprint[] {
  return Array.from({ length: 8 }, (_unused, index) => ({
    name: `Sprint ${index + 1}`,
    startDate: `2026-01-${String(index * 2 + 1).padStart(2, "0")}T00:00:00Z`,
    finishDate: `2026-01-${String(index * 2 + 2).padStart(2, "0")}T00:00:00Z`,
    atStart: [index + 1],
    statesAtFinish: { [index + 1]: "Closed" as const },
  }));
}
