import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { dumpMarker } from "./dump-marker";
import { SPEC_MARKER } from "./refinement-status";
import {
  publishChildTasks,
  publishDumpCompletion,
  publishDecisionRecord,
  publishStorySpec,
  readDumpCompletion,
  readIncompleteDumps,
  replaceManagedSpec,
  markdownToAdoHtml,
} from "./publish-refinement";

const AZURE_DEVOPS = { organization: "acme", project: "Plataforma" };
const CREDENTIALS = { pat: "pat-de-teste" };

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeAdo(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

function options(fetch: typeof globalThis.fetch) {
  return { azureDevOps: AZURE_DEVOPS, credentials: CREDENTIALS, fetch };
}

describe("replaceManagedSpec", () => {
  it("should preserve the User Story description while appending the managed block as HTML", () => {
    const description = replaceManagedSpec("<div>Texto do PO</div>", "# Spec");

    expect(description).toContain("<div>Texto do PO</div>");
    expect(description).toContain(SPEC_MARKER);
    expect(description).toContain("<h1>Spec</h1>");
    expect(description).not.toContain("# Spec\n");
  });

  it("should replace the prior managed block without duplicating the marker", () => {
    const first = replaceManagedSpec("Texto do PO", "# Primeira");
    const second = replaceManagedSpec(first, "# Segunda");

    expect(second).toContain("<h1>Segunda</h1>");
    expect(second).not.toContain("Primeira");
    expect(second.split(SPEC_MARKER)).toHaveLength(2);
  });

  it("should refuse a malformed managed block instead of truncating the User Story", () => {
    expect(() =>
      replaceManagedSpec("Texto do PO\n<!-- sprint-griller:spec:start -->\nNão apagar", "# Spec"),
    ).toThrow(/marcador de fechamento/i);
  });
});

describe("markdownToAdoHtml", () => {
  it("should render headings, lists, links and emphasis for work item HTML fields", () => {
    const html = markdownToAdoHtml(
      "# Spec\n\n_intro_\n\n- **item** — [abrir](https://example.test)",
    );

    expect(html).toContain("<h1>Spec</h1>");
    expect(html).toContain("<p><em>intro</em></p>");
    expect(html).toContain("<ul>");
    expect(html).toContain(
      '<li><strong>item</strong> — <a href="https://example.test">abrir</a></li>',
    );
  });

  it("should drop unsafe Markdown link targets instead of writing them into href", () => {
    expect(markdownToAdoHtml("[pular](javascript:evil)")).toBe("<p>pular</p>");
    expect(markdownToAdoHtml("[dados](data:text/html,hi)")).toBe("<p>dados</p>");
    expect(markdownToAdoHtml("[mail](mailto:po@example.test)")).toBe(
      '<p><a href="mailto:po@example.test">mail</a></p>',
    );
  });

  it("should format link labels without rewriting underscores in the href", () => {
    const href = "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211?source=task_preview";

    expect(markdownToAdoHtml(`[**Spec _atual_**](${href})`)).toBe(
      `<p><a href="${href}"><strong>Spec <em>atual</em></strong></a></p>`,
    );
  });

  it("should preserve general Markdown structure in work item HTML", () => {
    const html = markdownToAdoHtml(`1. Primeiro
2. Segundo

> Atenção

\`\`\`ts
const answer = 42;
\`\`\`

| Campo | Valor |
| --- | --- |
| estado | pronto |

![Diagrama](https://example.test/diagram.png)`);

    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<pre><code class="language-ts">const answer = 42;');
    expect(html).toContain("<table>");
    expect(html).toContain('<img src="https://example.test/diagram.png" alt="Diagrama">');
  });

  it("should render unsafe raw HTML and destinations as inert text", () => {
    const html = markdownToAdoHtml([
      "<script>alert(1)</script>",
      "[executar](javascript:alert(1))",
      "[relativo](/segredo)",
      "![roubar](mailto:po@example.test)",
      "![relativa](/imagem.png)",
    ].join("\n\n"));

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<p>executar</p>");
    expect(html).toContain("<p>relativo</p>");
    expect(html).toContain("<p>roubar</p>");
    expect(html).toContain("<p>relativa</p>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('src="mailto:');
    expect(html).not.toContain('src="/imagem.png"');
  });
});

describe("publishDecisionRecord", () => {
  it("should publish the deterministic human decision as a Markdown comment", async () => {
    const ado = fakeAdo((call) => call.init?.method === "GET" ? json({ comments: [] }) : json({ commentId: 91 }));

    await expect(
      publishDecisionRecord(options(ado.fetch), {
        storyId: 4211,
        dumpId: "dump-4211",
        questionSeq: 1,
        question: "O TTL é global?",
        answer: "Sim",
        recommendation: "Global",
        decidedBy: "PO + squad",
        decidedAt: Date.UTC(2026, 7, 6, 14, 30),
      }),
    ).resolves.toEqual({
      commentId: 91,
      url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211#discussion_91",
    });

    const call = ado.calls.at(-1);
    expect(call?.init?.method).toBe("POST");
    expect(call?.url).toContain("format=markdown");
    expect(String(call?.init?.body)).toContain("**Decidido por:** PO + squad");
    expect(String(call?.init?.body)).toContain("2026-08-06T14:30:00.000Z");
    expect(String(call?.init?.body)).toContain("sprint-griller:dump:dump-4211:decision:1");
  });

  it("should reuse a marked decision record instead of posting a duplicate", async () => {
    const ado = fakeAdo(() => json({ comments: [{ commentId: 91, text: "<!-- sprint-griller:dump:dump-4211:decision:1 -->" }] }));

    await expect(publishDecisionRecord(options(ado.fetch), {
      storyId: 4211,
      dumpId: "dump-4211",
      questionSeq: 1,
      question: "O TTL é global?",
      answer: "Sim",
      recommendation: "Global",
      decidedBy: "PO + squad",
      decidedAt: Date.UTC(2026, 7, 6, 14, 30),
    })).resolves.toEqual({
      commentId: 91,
      url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211#discussion_91",
    });

    expect(ado.calls).toHaveLength(1);
  });

  it("should reuse a marked decision record from a later comments page", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("continuationToken=next-page")) {
        return json({
          comments: [{ commentId: 91, text: "<!-- sprint-griller:dump:dump-4211:decision:1 -->" }],
          continuationToken: null,
        });
      }
      if (call.init?.method === "GET") {
        return json({ comments: [], continuationToken: "next-page" });
      }
      return json({ commentId: 999 });
    });

    await expect(publishDecisionRecord(options(ado.fetch), {
      storyId: 4211,
      dumpId: "dump-4211",
      questionSeq: 1,
      question: "O TTL é global?",
      answer: "Sim",
      recommendation: "Global",
      decidedBy: "PO + squad",
      decidedAt: Date.UTC(2026, 7, 6, 14, 30),
    })).resolves.toMatchObject({ commentId: 91 });
  });
});

describe("readDumpCompletion", () => {
  it("should return completion dump ids from the User Story description", async () => {
    const ado = fakeAdo(() =>
      json({
        id: 4211,
        rev: 3,
        fields: {
          "System.Description": "<!-- sprint-griller:dump:dump-4211:complete -->",
          "System.WorkItemType": "User Story",
        },
      }),
    );

    await expect(readDumpCompletion(options(ado.fetch), 4211)).resolves.toEqual(["dump-4211"]);
  });
});

describe("readIncompleteDumps", () => {
  it("should return dump ids that left artifacts without a completion marker", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("/comments")) {
        return json({
          comments: [{ commentId: 91, text: "<!-- sprint-griller:dump:dump-parcial:decision:1 -->" }],
        });
      }
      return json({
        id: 4211,
        rev: 3,
        fields: {
          "System.Description": `${SPEC_MARKER}\n<!-- sprint-griller:dump:dump-parcial:spec -->`,
          "System.WorkItemType": "User Story",
        },
      });
    });

    await expect(readIncompleteDumps(options(ado.fetch), 4211)).resolves.toEqual(["dump-parcial"]);
  });

  it("should ignore dumps that already have a completion marker", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("/comments")) {
        return json({
          comments: [{ commentId: 91, text: "<!-- sprint-griller:dump:dump-ok:decision:1 -->" }],
        });
      }
      return json({
        id: 4211,
        rev: 3,
        fields: {
          "System.Description": "<!-- sprint-griller:dump:dump-ok:complete -->",
          "System.WorkItemType": "User Story",
        },
      });
    });

    await expect(readIncompleteDumps(options(ado.fetch), 4211)).resolves.toEqual([]);
  });
});

describe("publishDumpCompletion", () => {
  it("should append the final completion marker with a revision guard", async () => {
    const ado = fakeAdo((call) => call.init?.method === "PATCH"
      ? json({ id: 4211 })
      : json({ id: 4211, rev: 7, fields: { "System.Description": "Spec publicada", "System.WorkItemType": "User Story" } }));

    await publishDumpCompletion(options(ado.fetch), { storyId: 4211, dumpId: "dump-4211" });

    expect(JSON.parse(String(ado.calls.at(-1)?.init?.body))).toEqual([
      { op: "test", path: "/rev", value: 7 },
      expect.objectContaining({ value: expect.stringContaining("sprint-griller:dump:dump-4211:complete") }),
    ]);
  });
});

describe("publishStorySpec", () => {
  it("should PATCH only the managed description block with a revision guard", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("/workitemtypes/") && call.url.includes("/fields")) {
        return json({ value: [{ referenceName: "Microsoft.VSTS.Scheduling.StoryPoints" }] });
      }
      return call.init?.method === "PATCH"
        ? json({ id: 4211 })
        : json({
          id: 4211,
          rev: 7,
          fields: { "System.Description": "<p>Texto do PO</p>", "System.WorkItemType": "User Story" },
        });
    });

    await publishStorySpec(options(ado.fetch), { storyId: 4211, dumpId: "dump-4211", markdown: "# Spec assinada", estimate: 8 });

    const patch = ado.calls[2];
    expect(patch?.init?.method).toBe("PATCH");
    expect(patch?.init?.headers).toEqual(
      expect.objectContaining({ "content-type": "application/json-patch+json" }),
    );
    expect(JSON.parse(String(patch?.init?.body))).toEqual([
      { op: "test", path: "/rev", value: 7 },
      expect.objectContaining({
        op: "add",
        path: "/fields/System.Description",
        value: expect.stringContaining("<h1>Spec assinada</h1>"),
      }),
      { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StoryPoints", value: 8 },
    ]);
  });

  it("should skip rewriting a Spec that already carries this dump marker", async () => {
    const ado = fakeAdo(() =>
      json({
        id: 4211,
        rev: 7,
        fields: {
          "System.Description": `${dumpMarker("dump-4211", "spec")}\n<p>Editada no ADO</p>`,
          "System.WorkItemType": "User Story",
        },
      }),
    );

    await publishStorySpec(options(ado.fetch), {
      storyId: 4211,
      dumpId: "dump-4211",
      markdown: "# Spec local",
      estimate: 8,
    });

    expect(ado.calls.some((call) => call.init?.method === "PATCH")).toBe(false);
  });

  it("should report a revision conflict as safe to retry", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("/workitemtypes/") && call.url.includes("/fields")) {
        return json({ value: [{ referenceName: "Microsoft.VSTS.Scheduling.StoryPoints" }] });
      }
      return call.init?.method === "PATCH"
        ? json({ message: "revision changed" }, 409)
        : json({ id: 4211, rev: 7, fields: { "System.WorkItemType": "User Story" } });
    });

    await expect(
      publishStorySpec(options(ado.fetch), { storyId: 4211, dumpId: "dump-4211", markdown: "# Spec", estimate: 5 }),
    ).rejects.toMatchObject({ kind: "conflict", message: expect.stringContaining("não foi gravada") });
  });

  it("should log write metadata without retaining the signed spec", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({
      name: "ado-client",
      destination: new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
          done();
        },
      }),
    });
    const ado = fakeAdo((call) => {
      if (call.url.includes("/workitemtypes/") && call.url.includes("/fields")) {
        return json({ value: [{ referenceName: "Microsoft.VSTS.Scheduling.StoryPoints" }] });
      }
      return call.init?.method === "PATCH"
        ? json({ id: 4211 })
        : json({ id: 4211, rev: 7, fields: { "System.WorkItemType": "User Story" } });
    });

    await publishStorySpec(
      { ...options(ado.fetch), logger },
      { storyId: 4211, dumpId: "dump-4211", markdown: "segredo da spec", estimate: 3 },
    );

    expect(JSON.stringify(lines)).not.toContain("segredo da spec");
  });
});

describe("publishChildTasks", () => {
  const childTasks = {
    storyId: 4211,
    dumpId: "dump-4211",
    tasks: [{
      title: "Criar endpoint",
      bodyMarkdown: "Entrega o CSV.\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211)\n\n### Critérios de aceite\n\n- Retorna o CSV.",
      blockedBy: [],
    }],
  } as const;

  it("should publish only the signed Task body plus its deterministic marker", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("workitemtypecategories/Microsoft.TaskCategory")) {
        return json({ workItemTypes: [{ name: "Task" }] });
      }
      if (call.url.includes("/_apis/wit/wiql")) return json({ workItems: [] });
      return json({ id: 900 });
    });
    await publishChildTasks(options(ado.fetch), {
      storyId: 4211,
      dumpId: "dump-4211",
      tasks: [{
        title: "Criar endpoint",
        bodyMarkdown: `    pnpm test

Entrega o CSV.

### Contexto técnico

Preservar clientes antigos.

### Critérios de aceite

- Retorna o CSV.
`,
        blockedBy: [],
      }],
    });

    const taskBody = String(
      ado.calls.find((call) => call.url.includes("/_apis/wit/workitems/$Task"))?.init?.body,
    );
    expect(taskBody).toContain("<h3>Contexto técnico</h3>");
    expect(taskBody).toContain("<pre><code>pnpm test\\n</code></pre>");
    expect(taskBody).toContain("Preservar clientes antigos.");
    expect(taskBody).not.toContain("Spec da US");
    expect(taskBody).toContain("sprint-griller:dump:dump-4211:task:1");
  });

  it("should create child Tasks with acceptance criteria, a Spec link, and native blockers", async () => {
    let nextId = 900;
    const ado = fakeAdo((call) => {
      if (call.url.includes("workitemtypecategories/Microsoft.TaskCategory")) {
        return json({ workItemTypes: [{ name: "Task" }] });
      }
      if (call.url.includes("/_apis/wit/wiql")) return json({ workItems: [] });
      if (call.url.includes("/_apis/wit/workitems/$Task")) {
        if (call.init?.method !== "POST") {
          throw new Error(`a criação de Task deve usar POST, recebeu ${call.init?.method}`);
        }
        return json({ id: nextId++ });
      }
      if (call.url.includes("/workitems/")) {
        if (call.init?.method !== "PATCH") {
          throw new Error(`a dependência de Task deve usar PATCH, recebeu ${call.init?.method}`);
        }
        return json({ id: nextId++ });
      }
      throw new Error(`requisição inesperada: ${call.url}`);
    });

    await publishChildTasks(options(ado.fetch), {
      storyId: 4211,
      dumpId: "dump-4211",
      tasks: [
        {
          title: "Criar endpoint",
          bodyMarkdown: "Entrega o CSV.\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211)\n\n### Critérios de aceite\n\n- Retorna o CSV.",
          blockedBy: [],
        },
        {
          title: "Mostrar link",
          bodyMarkdown: "Mostra o link no portal.\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211)\n\n### Critérios de aceite\n\n- Exibe o link.\n\n### Bloqueada por\n\n- Criar endpoint",
          blockedBy: ["Criar endpoint"],
        },
      ],
    });

    const bodies = ado.calls.map((call) => String(call.init?.body));
    expect(bodies.join("\n")).toContain("System.LinkTypes.Hierarchy-Reverse");
    expect(bodies.join("\n")).toContain("<h3>Critérios de aceite</h3>");
    expect(bodies.join("\n")).toContain("Spec da US");
    expect(bodies.join("\n")).toContain("System.LinkTypes.Dependency-Reverse");
    expect(bodies.join("\n")).not.toContain("## Critérios de aceite");
    expect(ado.calls.some((call) => call.url.includes("/_apis/wit/workitems/$Task"))).toBe(true);
    expect(ado.calls.find((call) => call.url.includes("/_apis/wit/workitems/$Task"))?.init?.method)
      .toBe("POST");
  });

  it("should not include operator-authored Task titles in structured logs", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({
      name: "ado-client",
      destination: new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
          done();
        },
      }),
    });
    const ado = fakeAdo((call) =>
      call.url.includes("workitemtypecategories/Microsoft.TaskCategory")
        ? json({ workItemTypes: [{ name: "Task" }] })
        : call.url.includes("/_apis/wit/wiql")
          ? json({ workItems: [] })
        : json({ id: 900 }),
    );

    await publishChildTasks({ ...options(ado.fetch), logger }, {
      storyId: 4211,
      dumpId: "dump-4211",
      tasks: [{
        title: "Transferir dados pessoais de Maria",
        bodyMarkdown: "Transfere os dados solicitados.\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211)\n\n### Critérios de aceite\n\n- Concluído.",
        blockedBy: [],
      }],
    });

    expect(JSON.stringify(lines)).not.toContain("Transferir dados pessoais de Maria");
  });

  it("should reuse a marked child Task instead of creating it again", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("workitemtypecategories/Microsoft.TaskCategory")) {
        return json({ workItemTypes: [{ name: "Task" }] });
      }
      if (call.url.includes("/_apis/wit/wiql")) return json({ workItems: [{ id: 900 }] });
      if (call.url.includes("/_apis/wit/workitemsbatch")) {
        return json({
          value: [{
            id: 900,
            fields: {
              "System.Title": "Criar endpoint",
              "System.Description": "<!-- sprint-griller:dump:dump-4211:task:1 -->",
            },
            relations: [],
          }],
        });
      }
      throw new Error(`escrita inesperada: ${call.url}`);
    });

    await publishChildTasks(options(ado.fetch), childTasks);

    expect(ado.calls.some((call) => call.init?.method === "PATCH")).toBe(false);
    const batchBody = JSON.parse(
      String(ado.calls.find((call) => call.url.includes("/_apis/wit/workitemsbatch"))?.init?.body),
    ) as { fields?: unknown; $expand?: string };
    expect(batchBody.fields).toBeUndefined();
    expect(batchBody.$expand).toBe("Relations");
  });

  it("should skip Dependency links that already exist when retrying a partial dump", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("workitemtypecategories/Microsoft.TaskCategory")) {
        return json({ workItemTypes: [{ name: "Task" }] });
      }
      if (call.url.includes("/_apis/wit/wiql")) return json({ workItems: [{ id: 900 }, { id: 901 }] });
      if (call.url.includes("/_apis/wit/workitemsbatch")) {
        return json({
          value: [
            {
              id: 900,
              fields: {
                "System.Title": "Criar endpoint",
                "System.Description": "<!-- sprint-griller:dump:dump-4211:task:1 -->",
              },
              relations: [],
            },
            {
              id: 901,
              fields: {
                "System.Title": "Mostrar link",
                "System.Description": "<!-- sprint-griller:dump:dump-4211:task:2 -->",
              },
              relations: [{
                rel: "System.LinkTypes.Dependency-Reverse",
                url: "https://dev.azure.com/acme/_apis/wit/workitems/900",
              }],
            },
          ],
        });
      }
      throw new Error(`escrita inesperada: ${call.url}`);
    });

    await publishChildTasks(options(ado.fetch), {
      ...childTasks,
      tasks: [
        ...childTasks.tasks,
        {
          title: "Mostrar link",
          bodyMarkdown: "Mostra o link no portal.\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211)\n\n### Critérios de aceite\n\n- Exibe o link.\n\n### Bloqueada por\n\n- Criar endpoint",
          blockedBy: ["Criar endpoint"],
        },
      ],
    });

    expect(ado.calls.some((call) => call.init?.method === "PATCH")).toBe(false);
  });

  it("should report a category lookup failure as safe to retry", async () => {
    const ado = fakeAdo(() => {
      throw new TypeError("network down");
    });

    await expect(publishChildTasks(options(ado.fetch), childTasks)).rejects.toMatchObject({
      kind: "connection",
      writeMayHaveSucceeded: false,
    });
  });

  it("should report a Task write connection failure as uncertain", async () => {
    const ado = fakeAdo((call) => {
      if (call.url.includes("workitemtypecategories/Microsoft.TaskCategory")) {
        return json({ workItemTypes: [{ name: "Task" }] });
      }
      if (call.url.includes("/_apis/wit/wiql")) return json({ workItems: [] });
      throw new TypeError("network down");
    });

    await expect(publishChildTasks(options(ado.fetch), childTasks)).rejects.toMatchObject({
      kind: "connection",
      writeMayHaveSucceeded: true,
    });
  });

  it("should report a definite later failure as uncertain after an earlier Task was created", async () => {
    let writes = 0;
    const ado = fakeAdo((call) => {
      if (call.url.includes("workitemtypecategories/Microsoft.TaskCategory")) {
        return json({ workItemTypes: [{ name: "Task" }] });
      }
      if (call.url.includes("/_apis/wit/wiql")) return json({ workItems: [] });
      writes += 1;
      return writes === 1 ? json({ id: 900 }) : json({ message: "invalid Task" }, 400);
    });

    await expect(publishChildTasks(options(ado.fetch), {
      ...childTasks,
      tasks: [
        ...childTasks.tasks,
        {
          title: "Mostrar link",
          bodyMarkdown: "Mostra o link no portal.\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211)\n\n### Critérios de aceite\n\n- Exibe o link.",
          blockedBy: [],
        },
      ],
    })).rejects.toMatchObject({
      kind: "unexpected",
      writeMayHaveSucceeded: true,
    });
  });
});
