import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { AdoError } from "../ado-error";
import {
  INVESTIGATION_MARKER,
  SPEC_MARKER,
} from "../refinement/refinement-status";
import { fetchCurrentIteration } from "./current-iteration";

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

interface FakeWorkItem {
  readonly id: number;
  readonly title: string;
  readonly type?: string;
  readonly state?: string;
  readonly assignedTo?: string;
  readonly description?: string;
  readonly comments?: readonly string[];
}

interface FakeAdoState {
  readonly iteration?: { readonly name: string; readonly path: string } | null;
  readonly backlogItemTypes?: readonly string[];
  readonly workItems?: readonly FakeWorkItem[];
}

/** Azure DevOps de mentira: responde as rotas que o picker consome. */
function fakeAdo(state: FakeAdoState = {}) {
  const iteration =
    state.iteration === undefined
      ? { name: "Sprint 42", path: "Plataforma\\Sprint 42" }
      : state.iteration;
  const workItems = state.workItems ?? [];
  const wiqlQueries: string[] = [];

  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);

      if (url.includes("/_apis/work/teamsettings/iterations?")) {
        return json({
          count: iteration ? 1 : 0,
          value: iteration
            ? [{ id: "it-1", name: iteration.name, path: iteration.path }]
            : [],
        });
      }

      if (url.includes("/_apis/wit/workitemtypecategories/")) {
        return json({
          workItemTypes: (state.backlogItemTypes ?? ["User Story"]).map(
            (name) => ({ name }),
          ),
        });
      }

      if (url.includes("/_apis/wit/wiql")) {
        wiqlQueries.push(
          String(
            (JSON.parse(String(init?.body)) as { query: unknown }).query,
          ),
        );
        return json({
          workItems: workItems.map(({ id }) => ({ id })),
        });
      }

      if (url.includes("/_apis/wit/workitemsbatch")) {
        return json({
          count: workItems.length,
          value: workItems.map((item) => ({
            id: item.id,
            fields: {
              "System.Title": item.title,
              "System.WorkItemType": item.type ?? "User Story",
              "System.State": item.state ?? "New",
              "System.CommentCount": item.comments?.length ?? 0,
              ...(item.description === undefined
                ? {}
                : { "System.Description": item.description }),
              ...(item.assignedTo === undefined
                ? {}
                : { "System.AssignedTo": { displayName: item.assignedTo } }),
            },
          })),
        });
      }

      const comments = url.match(/\/workItems\/(\d+)\/comments/);
      if (comments) {
        const item = workItems.find(({ id }) => id === Number(comments[1]));
        return json({
          comments: (item?.comments ?? []).map((text, index) => ({
            id: index + 1,
            text,
          })),
        });
      }

      throw new Error(`rota não esperada no ADO de mentira: ${url}`);
    },
  );

  return Object.assign(fetchMock, { wiqlQueries });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Aponta o client para o ADO de mentira, com o resto da config já preenchido. */
function pickerAgainst(state: FakeAdoState = {}) {
  return fetchCurrentIteration({
    azureDevOps: AZURE_DEVOPS,
    credentials: CREDENTIALS,
    logger: SILENT_LOGGER,
    fetch: fakeAdo(state),
  });
}

describe("fetchCurrentIteration", () => {
  it("should return the current iteration's user stories with a link to the ADO board", async () => {
    const iteration = await fetchCurrentIteration({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: fakeAdo({
        workItems: [
          {
            id: 4321,
            title: "Exportar relatório em CSV",
            state: "New",
            assignedTo: "Ana Souza",
          },
        ],
      }),
    });

    expect(iteration).toMatchObject({
      name: "Sprint 42",
      path: "Plataforma\\Sprint 42",
      stories: [
        {
          id: 4321,
          title: "Exportar relatório em CSV",
          type: "User Story",
          state: "New",
          assignedTo: "Ana Souza",
          url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4321",
        },
      ],
    });
  });

  it("should ask only for the backlog item types the project's process declares, not every work item in the sprint", async () => {
    const ado = fakeAdo({ backlogItemTypes: ["Product Backlog Item", "Bug"] });

    await fetchCurrentIteration({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: ado,
    });

    expect(ado.wiqlQueries[0]).toBe(
      "SELECT [System.Id] FROM WorkItems " +
        "WHERE [System.IterationPath] UNDER 'Plataforma\\Sprint 42' " +
        "AND [System.WorkItemType] IN ('Product Backlog Item', 'Bug') " +
        "ORDER BY [System.Id]",
    );
  });

  it("should tell apart the three refinement states from the artifacts on each US", async () => {
    const iteration = await pickerAgainst({
      workItems: [
        { id: 1, title: "Crua" },
        {
          id: 2,
          title: "Já investigada",
          comments: [`${INVESTIGATION_MARKER}\n## Impacto`],
        },
        {
          id: 3,
          title: "Já refinada",
          comments: [`${INVESTIGATION_MARKER}`, `${SPEC_MARKER}\n## Decisões\n<!-- sprint-griller:dump:abc123:complete -->`],
        },
      ],
    });

    expect(iteration?.stories.map((story) => story.refinement)).toEqual([
      "sem-investigacao",
      "investigada",
      "refinada",
    ]);
  });

  it("should return nothing when the team has no current iteration, since that is not a failure", async () => {
    await expect(pickerAgainst({ iteration: null })).resolves.toBeUndefined();
  });

  it("should point at the PAT when Azure DevOps refuses the credential", async () => {
    const error = await pickerFails(async () => json({}, 401));

    expect(error).toMatchObject({ kind: "auth" });
    expect(error.message).toMatch(/AZURE_DEVOPS_PAT/);
  });

  it("should point at the PAT when Azure DevOps answers with a sign-in page instead of data", async () => {
    const error = await pickerFails(
      async () =>
        new Response("<html>sign in</html>", {
          headers: { "content-type": "text/html" },
        }),
    );

    expect(error).toMatchObject({ kind: "auth" });
    expect(error.message).toMatch(/AZURE_DEVOPS_PAT/);
  });

  it("should point at the squad config when Azure DevOps does not know the project", async () => {
    const error = await pickerFails(async () => json({}, 404));

    expect(error).toMatchObject({ kind: "not-found" });
    expect(error.message).toMatch(/azureDevOps\.project/);
  });

  it("should report a readable error when Azure DevOps is unreachable", async () => {
    const error = await pickerFails(async () => {
      throw new TypeError("fetch failed");
    });

    expect(error).toMatchObject({ kind: "connection" });
    expect(error.message).toMatch(/dev\.azure\.com/);
  });

  it("should refuse an off-contract payload instead of showing half a picker", async () => {
    const error = await pickerFails(async () =>
      json({ value: [{ name: "Sprint 42" }] }),
    );

    expect(error).toMatchObject({ kind: "unexpected-response" });
  });
});

/** Roda o picker contra um ADO que falha e devolve o {@link AdoError} resultante. */
async function pickerFails(
  respond: () => Promise<Response>,
): Promise<AdoError> {
  const failing = await fetchCurrentIteration({
    azureDevOps: AZURE_DEVOPS,
    credentials: CREDENTIALS,
    logger: SILENT_LOGGER,
    fetch: vi.fn(respond),
  }).catch((error: unknown) => error);

  expect(failing).toBeInstanceOf(AdoError);
  return failing as AdoError;
}
