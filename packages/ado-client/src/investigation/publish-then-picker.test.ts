import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { fetchCurrentIteration } from "../iteration/current-iteration";
import { publishInvestigation } from "./publish-investigation";

/**
 * O ciclo que a ferramenta promete e nenhum dos dois lados prova sozinho:
 * publicar a Investigação e a US aparecer como "investigada" no picker. Testar
 * só o corpo enviado seria tautologia — o marcador tem que sobreviver à volta
 * pela leitura dos comments, que é onde as duas metades podem discordar.
 */

const AZURE_DEVOPS = { organization: "acme", project: "Plataforma" };
const CREDENTIALS = { pat: "pat-de-teste" };
const STORY_ID = 4211;

const SILENT_LOGGER = createLogger({
  destination: new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }),
  level: "fatal",
});

/**
 * Azure DevOps de mentira com memória: guarda o que a publicação grava e
 * devolve isso na leitura dos comments, como o de verdade faria.
 */
function fakeAdo() {
  const comments: string[] = [];

  return vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);

      if (/\/workItems\/\d+\/comments/i.test(url)) {
        if (init?.method === "POST") {
          const { text } = JSON.parse(String(init.body)) as { text: string };
          comments.push(text);
          return json({ id: comments.length, workItemId: STORY_ID });
        }

        return json({ comments: comments.map((text) => ({ text })) });
      }

      if (url.includes("/_apis/work/teamsettings/iterations?")) {
        return json({
          value: [{ name: "Sprint 42", path: "Plataforma\\Sprint 42" }],
        });
      }

      if (url.includes("/_apis/wit/workitemtypecategories/")) {
        return json({ workItemTypes: [{ name: "User Story" }] });
      }

      if (url.includes("/_apis/wit/wiql")) {
        return json({ workItems: [{ id: STORY_ID }] });
      }

      if (url.includes("/_apis/wit/workitemsbatch")) {
        return json({
          value: [
            {
              id: STORY_ID,
              fields: {
                "System.Title": "TTL de sessão configurável",
                "System.WorkItemType": "User Story",
                "System.State": "New",
                "System.CommentCount": comments.length,
              },
            },
          ],
        });
      }

      throw new Error(`rota não esperada no ADO de mentira: ${url}`);
    },
  );
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("publicar a Investigação e voltar ao picker", () => {
  it("should leave the US sem-investigacao while nothing has been published", async () => {
    const iteration = await fetchCurrentIteration({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: fakeAdo(),
    });

    expect(iteration?.stories[0]?.refinement).toBe("sem-investigacao");
  });

  it("should show the US as investigada once the Investigação is published", async () => {
    const options = {
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      logger: SILENT_LOGGER,
      fetch: fakeAdo(),
    };

    await publishInvestigation(options, {
      storyId: STORY_ID,
      markdown: "# Investigação — US #4211\n\nO TTL hoje é fixo.\n",
    });
    const iteration = await fetchCurrentIteration(options);

    expect(iteration?.stories[0]?.refinement).toBe("investigada");
  });
});
