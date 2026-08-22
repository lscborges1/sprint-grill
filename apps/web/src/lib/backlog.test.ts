import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadBacklog } from "./backlog";

/**
 * A config da squad é lida uma vez por processo, então o sandbox é montado uma
 * vez para todo o arquivo — o que varia entre os testes é a resposta do ADO.
 */
beforeAll(() => {
  const workspace = mkdtempSync(path.join(tmpdir(), "sprint-griller-picker-"));
  const repoPath = path.join(workspace, "core-api");
  mkdirSync(repoPath, { recursive: true });

  const configPath = path.join(workspace, "sprint-griller.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      azureDevOps: { organization: "acme", project: "Plataforma" },
      repos: { primary: { name: "core-api", path: repoPath } },
    }),
  );

  vi.stubEnv("SPRINT_GRILLER_CONFIG", configPath);
  vi.stubEnv("AZURE_DEVOPS_PAT", "pat-de-teste");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Azure DevOps de mentira com um backlog de uma US só. */
function adoServesOneStory() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);

      if (url.includes("/_apis/wit/workitemtypecategories/")) {
        return json({ workItemTypes: [{ name: "User Story" }] });
      }
      if (url.includes("/_apis/wit/workitemtypes/") && url.includes("/fields")) {
        return json({
          value: [{ referenceName: "Microsoft.VSTS.Common.BacklogPriority" }],
        });
      }
      if (url.includes("/_apis/wit/wiql")) {
        return json({ workItems: [{ id: 4321 }] });
      }
      if (url.includes("/_apis/wit/workitemsbatch")) {
        return json({
          value: [
            {
              id: 4321,
              fields: {
                "System.Title": "Exportar relatório em CSV",
                "System.WorkItemType": "User Story",
                "System.State": "New",
                "System.CommentCount": 0,
              },
            },
          ],
        });
      }

      throw new Error(`rota não esperada no ADO de mentira: ${url}`);
    }),
  );
}

function adoFailsWith(status: number) {
  vi.stubGlobal("fetch", vi.fn(async () => json({}, status)));
}

describe("loadBacklog", () => {
  it("should hand the picker the backlog stories when Azure DevOps answers", async () => {
    adoServesOneStory();

    const result = await loadBacklog();

    expect(result).toEqual({
      status: "ok",
      stories: [
        {
          id: 4321,
          title: "Exportar relatório em CSV",
          type: "User Story",
          state: "New",
          assignedTo: undefined,
          url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4321",
          refinement: "sem-investigacao",
        },
      ],
    });
  });

  it("should turn a refused credential into a readable message instead of throwing", async () => {
    adoFailsWith(401);

    const result = await loadBacklog();

    expect(result).toMatchObject({ status: "error" });
    expect(result.status === "error" && result.message).toMatch(
      /AZURE_DEVOPS_PAT/,
    );
  });

  it("should turn a missing credential into a readable message instead of a broken screen", async () => {
    adoServesOneStory();
    vi.stubEnv("AZURE_DEVOPS_PAT", "");

    const result = await loadBacklog();
    vi.stubEnv("AZURE_DEVOPS_PAT", "pat-de-teste");

    expect(result).toMatchObject({ status: "error" });
    expect(result.status === "error" && result.message).toMatch(
      /AZURE_DEVOPS_PAT/,
    );
  });
});
