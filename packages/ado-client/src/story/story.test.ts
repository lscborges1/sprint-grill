import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { AdoError } from "../ado-error";
import { fetchStory } from "./story";

const AZURE_DEVOPS = { organization: "acme", project: "Plataforma" };
const CREDENTIALS = { pat: "pat-de-teste" };

const SILENT_LOGGER = createLogger({
  destination: new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }),
  level: "fatal",
});

function fakeAdo(fields: Record<string, unknown>, status = 200) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (!url.includes("/_apis/wit/workitems/4211")) {
      throw new Error(`rota não esperada no ADO de mentira: ${url}`);
    }

    return new Response(JSON.stringify({ id: 4211, fields }), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

function storyFrom(fields: Record<string, unknown>, status?: number) {
  return fetchStory(
    {
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: fakeAdo(fields, status),
    },
    4211,
  );
}

describe("fetchStory", () => {
  it("should return the story with its description and a link to the ADO board", async () => {
    const story = await storyFrom({
      "System.Title": "TTL de sessão configurável",
      "System.WorkItemType": "User Story",
      "System.State": "New",
      "System.Description": "<div>O TTL hoje é fixo.</div>",
    });

    expect(story).toEqual({
      id: 4211,
      title: "TTL de sessão configurável",
      type: "User Story",
      state: "New",
      rev: 1,
      description: "<div>O TTL hoje é fixo.</div>",
      url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
      wikiContext: {
        references: [],
        omitted: [],
        attempts: 0,
        contentCharacters: 0,
      },
    });
  });

  it("should leave the description undefined when the PO wrote none", async () => {
    const story = await storyFrom({
      "System.Title": "US crua",
      "System.WorkItemType": "User Story",
      "System.State": "New",
    });

    expect(story.description).toBeUndefined();
  });

  it("should fail with an actionable error when the story does not exist", async () => {
    await expect(
      storyFrom({ "System.Title": "sumiu" }, 404),
    ).rejects.toBeInstanceOf(AdoError);
  });

  it("should load Wiki context only after validating the story response", async () => {
    const routes: string[] = [];
    const doFetch = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      routes.push(url.pathname);
      if (url.pathname.endsWith("/_apis/wit/workitems/4211")) {
        return new Response(JSON.stringify({
          id: 4211,
          fields: {
            "System.Title": "Com Wiki",
            "System.WorkItemType": "User Story",
            "System.State": "New",
            "System.Description":
              "https://dev.azure.com/acme/Docs/_wiki/wikis/Produto.wiki/8/Contrato",
          },
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith("/acme/Docs/_apis/wiki/wikis/Produto.wiki/pages/8")) {
        return new Response(JSON.stringify({ id: 8, path: "/Contrato", content: "conteúdo" }), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`rota inesperada: ${url}`);
    });

    const story = await fetchStory({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: doFetch,
    }, 4211);

    expect({
      routes,
      wikiStatus: story.wikiContext.references[0]?.status,
    }).toEqual({
      routes: [
        "/acme/Plataforma/_apis/wit/workitems/4211",
        "/acme/Docs/_apis/wiki/wikis/Produto.wiki/pages/8",
      ],
      wikiStatus: "loaded",
    });
  });
});
