import { Writable } from "node:stream";
import type {
  AgentRuntime,
  AgentSession,
} from "@sprint-griller/agent-runtime";
import { createLogger } from "@sprint-griller/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAgentRuntime = vi.hoisted(() =>
  vi.fn<typeof import("@sprint-griller/agent-runtime").createAgentRuntime>(),
);

vi.mock("@sprint-griller/agent-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/agent-runtime")>()),
  createAgentRuntime,
}));
vi.mock("./squad-config", () => ({
  getSquadConfig: () => ({
    azureDevOps: { organization: "acme", project: "Plataforma" },
    repos: {
      primary: { name: "core-api", path: "/dev/core-api" },
      related: [],
    },
  }),
}));
vi.mock("./logger", () => ({
  logger: createLogger({
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
    level: "fatal",
  }),
}));

const { getInvestigation, publishInvestigation, startInvestigation } =
  await import("./investigations");

const STORY_ID = 987_654_321;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("AZURE_DEVOPS_PAT", "pat-de-teste");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Wiki context investigation pipeline", () => {
  it("should publish Wiki acquisition gaps after providing loaded context to the agent", async () => {
    const prompts: string[] = [];
    let publishedComment = "";
    const report = {
      summary: "A US precisa respeitar o contrato documentado.",
      gaps: [],
      impacts: [],
      externalRepos: [],
      unverified: [],
    };
    const session: AgentSession = {
      id: "session-wiki-integration",
      send(prompt) {
        prompts.push(prompt);
        return (async function* () {
          yield {
            type: "message" as const,
            text: `\`\`\`json\n${JSON.stringify(report)}\n\`\`\``,
          };
        })();
      },
      interrupt: async () => undefined,
    };
    const runtime: AgentRuntime = {
      startSession: async () => session,
      resumeSession: async () => session,
      close: async () => undefined,
    };
    createAgentRuntime.mockResolvedValue(runtime);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/_apis/wit/workitems/${STORY_ID}`)) {
          return json({
            id: STORY_ID,
            fields: {
              "System.Title": "TTL de sessão configurável",
              "System.WorkItemType": "User Story",
              "System.State": "New",
              "System.Description": [
                "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Arquitetura/42/Expiracao",
                "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Arquitetura/43/Indisponivel",
              ].join("\n"),
            },
          });
        }
        if (url.pathname.endsWith("/_apis/wiki/wikis/Arquitetura/pages/42")) {
          return json({
            id: 42,
            path: "/Sessões/Expiração",
            content: "O TTL padrão é 3.600 segundos.",
          });
        }
        if (url.pathname.endsWith("/_apis/wiki/wikis/Arquitetura/pages/43")) {
          return json({}, 404);
        }
        if (
          url.pathname.endsWith(
            `/_apis/wit/workItems/${STORY_ID}/comments`,
          ) &&
          init?.method === "POST"
        ) {
          publishedComment = (
            JSON.parse(String(init.body)) as { readonly text: string }
          ).text;
          return json({ commentId: 77 });
        }
        throw new Error(`rota inesperada: ${url}`);
      }),
    );

    startInvestigation(STORY_ID);
    await vi.waitFor(() =>
      expect(getInvestigation(STORY_ID)?.status).toBe("aprovado"),
    );
    const publication = await publishInvestigation(STORY_ID);

    expect({
      publication,
      promptHasLoadedWiki: prompts[0]?.includes(
        "O TTL padrão é 3.600 segundos.",
      ),
      commentHasWikiGap:
        publishedComment.includes("Qual contexto da Wiki") &&
        publishedComment.includes("não encontrou a página"),
    }).toEqual({
      publication: {
        status: "publicada",
        commentId: 77,
        url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${STORY_ID}`,
      },
      promptHasLoadedWiki: true,
      commentHasWikiGap: true,
    });
  });
});
