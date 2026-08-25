import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { AdoError } from "../ado-error";
import { fetchWikiContext } from "./wiki";

const AZURE_DEVOPS = { organization: "acme", project: "Plataforma" };
const CREDENTIALS = { pat: "pat-de-teste" };

function wikiPage(id: number, path: string, content = `conteúdo ${id}`): Response {
  return new Response(JSON.stringify({ id, path, content }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function options(fetch: typeof globalThis.fetch) {
  return {
    azureDevOps: AZURE_DEVOPS,
    credentials: CREDENTIALS,
    fetch,
    logger: createLogger({
      destination: new Writable({ write(_chunk, _encoding, done) { done(); } }),
      level: "fatal",
    }),
  } as const;
}

describe("fetchWikiContext", () => {
  it("should load ID and pagePath links from HTML and plain text in textual order", async () => {
    const doFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/pages/17")) return wikiPage(17, "/Login");
      if (url.searchParams.get("path") === "/Runbook & SRE") {
        return wikiPage(23, "/Runbook & SRE");
      }
      if (url.pathname.endsWith("/pages/31")) return wikiPage(31, "/Final");
      throw new Error(`rota inesperada: ${url}`);
    });
    const description = [
      `<a href='https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/17/Login-antigo#trecho'>Login</a>`,
      'https://dev.azure.com/acme/Outro%20Projeto/_wiki/wikis/Opera%C3%A7%C3%A3o.wiki?pagePath=%2FRunbook%20%26%20SRE&amp;view=all',
      `<a href="https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/31/Slug?ignored=1&amp;foo=2#fim">Final</a>`,
    ].join(" depois ");

    const result = await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description,
    });

    expect(result.references.flatMap((reference) =>
      reference.status === "loaded"
        ? [{ target: reference.target, pageId: reference.pageId }]
        : [],
    )).toEqual([
      {
        target: {
          project: "Plataforma",
          wiki: "Produto.wiki",
          canonicalUrl: "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/17",
          page: { kind: "id", id: 17 },
        },
        pageId: 17,
      },
      {
        target: {
          project: "Outro Projeto",
          wiki: "Operação.wiki",
          canonicalUrl: "https://dev.azure.com/acme/Outro%20Projeto/_wiki/wikis/Opera%C3%A7%C3%A3o.wiki?pagePath=%2FRunbook+%26+SRE",
          page: { kind: "path", path: "/Runbook & SRE" },
        },
        pageId: 23,
      },
      {
        target: {
          project: "Plataforma",
          wiki: "Produto.wiki",
          canonicalUrl: "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/31",
          page: { kind: "id", id: 31 },
        },
        pageId: 31,
      },
    ]);
  });

  it("should decode numeric ampersand entities in pagePath links", async () => {
    const doFetch = vi.fn<typeof globalThis.fetch>(async () => wikiPage(9, "/A & B"));

    await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description:
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki?pagePath=%2FA%26B&#38;other=1",
    });

    expect(new URL(String(doFetch.mock.calls[0]?.[0])).searchParams.get("path")).toBe("/A&B");
  });

  it.each([
    { encodedPath: "%2FRunbook.", pagePath: "/Runbook." },
    { encodedPath: "%2FRunbook)", pagePath: "/Runbook)" },
  ])("should preserve terminal punctuation when pagePath ends in $pagePath", async ({
    encodedPath,
    pagePath,
  }) => {
    const doFetch = vi.fn<typeof globalThis.fetch>(async () =>
      wikiPage(10, pagePath),
    );

    const result = await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description:
        `<a href="https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki?pagePath=${encodedPath}">Runbook</a>`,
    });

    const reference = result.references[0];
    expect({
      targetPath:
        reference?.target.page.kind === "path"
          ? reference.target.page.path
          : undefined,
      requestedPath: new URL(String(doFetch.mock.calls[0]?.[0])).searchParams.get(
        "path",
      ),
    }).toEqual({ targetPath: pagePath, requestedPath: pagePath });
  });

  it("should not request Azure DevOps when the description has no Wiki links", async () => {
    const doFetch = vi.fn<typeof globalThis.fetch>();

    const result = await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description: "Sem documentação vinculada.",
    });

    expect({ result, requests: doFetch.mock.calls.length }).toEqual({
      result: { references: [], omitted: [], attempts: 0, contentCharacters: 0 },
      requests: 0,
    });
  });

  it("should reject links outside the configured organization or the fixed HTTPS origin", async () => {
    const doFetch = vi.fn<typeof globalThis.fetch>(async () => wikiPage(7, "/Aceita"));
    const links = [
      "https://dev.azure.com/ACME/Plataforma/_wiki/wikis/Produto.wiki/7/Aceita",
      "https://dev.azure.com/other/Plataforma/_wiki/wikis/Produto.wiki/8/Org",
      "https://evil.example/acme/Plataforma/_wiki/wikis/Produto.wiki/9/Host",
      "https://dev.azure.com:444/acme/Plataforma/_wiki/wikis/Produto.wiki/10/Porta",
      "https://dev.azure.com:443/acme/Plataforma/_wiki/wikis/Produto.wiki/13/Porta-padrao",
      "https://user@dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/11/Userinfo",
      "http://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/12/Http",
    ];

    const result = await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description: links.join("\n"),
    });

    expect({ attempts: result.attempts, requested: String(doFetch.mock.calls[0]?.[0]) }).toEqual({
      attempts: 1,
      requested:
        "https://dev.azure.com/acme/Plataforma/_apis/wiki/wikis/Produto.wiki/pages/7?includeContent=true&api-version=7.1",
    });
  });

  it("should traverse Markdown child links in sequential breadth-first order", async () => {
    const requested: Array<number | string> = [];
    const contents = new Map([
      [
        1,
        [
          "[dois](https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/2/Dois)",
          "![imagem](https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/99/Imagem)",
          "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/98/Raw",
          "[quatro](https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/4/Quatro)",
          "[interno](/parent%20dir/child#heading)",
          "[anexo](/.attachments/diagrama.png)",
          "[relativa](./relative)",
        ].join("\n"),
      ],
      [3, "[cinco](https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/5/Cinco)"],
    ]);
    const doFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const internalPath = url.searchParams.get("path");
      if (internalPath !== null) {
        requested.push(internalPath);
        return wikiPage(6, internalPath);
      }
      const match = /\/pages\/(\d+)$/.exec(url.pathname);
      const id = Number(match?.[1]);
      requested.push(id);
      return wikiPage(id, `/Página ${id}`, contents.get(id));
    });

    const result = await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description: [
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/1/Um",
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/3/Tres",
      ].join("\n"),
    });

    expect({
      requested,
      depth: result.references.map((reference) => reference.depth),
    }).toEqual({
      requested: [1, 3, 2, 4, "/parent dir/child", 5],
      depth: [0, 0, 1, 1, 1, 1],
    });
  });

  it("should deduplicate canonical targets before fetch and resolved page IDs after fetch", async () => {
    const doFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return wikiPage(7, "/Mesma", url.searchParams.get("path") ? "por path" : "por id");
    });

    const result = await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description: [
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/7/Primeiro",
        "https://dev.azure.com/acme/plataforma/_wiki/wikis/produto.wiki/7/Outro-slug#fragmento",
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki?pagePath=%2FMesma",
      ].join("\n"),
    });

    expect({
      attempts: result.attempts,
      references: result.references.length,
      requests: doFetch.mock.calls.length,
      contentCharacters: result.contentCharacters,
    }).toEqual({ attempts: 2, references: 1, requests: 2, contentCharacters: 6 });
  });

  it("should use a page ID resolved from pagePath as an alias before a later fetch", async () => {
    const doFetch = vi.fn(async () => wikiPage(7, "/Mesma", "primeira"));

    const result = await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description: [
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki?pagePath=%2FMesma",
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/7/Mesma",
      ].join("\n"),
    });

    expect({ attempts: result.attempts, references: result.references.length }).toEqual({
      attempts: 1,
      references: 1,
    });
  });

  it("should stop after ten attempts and report remaining pages as omitted", async () => {
    const doFetch = vi.fn(async (input: string | URL | Request) => {
      const match = /\/pages\/(\d+)$/.exec(new URL(String(input)).pathname);
      const id = Number(match?.[1]);
      return wikiPage(id, `/Página ${id}`, "x");
    });
    const description = Array.from(
      { length: 12 },
      (_, index) =>
        `https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/${index + 1}/Pagina`,
    ).join("\n");

    const result = await fetchWikiContext(options(doFetch), { storyId: 4211, description });

    expect({
      attempts: result.attempts,
      references: result.references.length,
      omitted: result.omitted.map(({ reason }) => reason),
    }).toEqual({
      attempts: 10,
      references: 10,
      omitted: ["page-limit", "page-limit"],
    });
  });

  it("should retain at most one hundred thousand characters and omit later pages", async () => {
    const doFetch = vi.fn(async (input: string | URL | Request) => {
      const id = Number(/\/pages\/(\d+)$/.exec(new URL(String(input)).pathname)?.[1]);
      return wikiPage(id, `/Página ${id}`, "a".repeat(100_001));
    });

    const result = await fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description: [
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/1/Um",
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/2/Dois",
      ].join("\n"),
    });
    const loaded = result.references[0];

    expect({
      attempts: result.attempts,
      contentCharacters: result.contentCharacters,
      retained: loaded?.status === "loaded" ? loaded.content.length : undefined,
      truncated: loaded?.status === "loaded" ? loaded.truncated : undefined,
      omitted: result.omitted.map(({ reason }) => reason),
    }).toEqual({
      attempts: 1,
      contentCharacters: 100_000,
      retained: 100_000,
      truncated: true,
      omitted: ["content-limit"],
    });
  });

  it.each([
    ["auth", async () => new Response("{}", { status: 403, headers: { "content-type": "application/json" } })],
    ["not-found", async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })],
    ["connection", async () => { throw new Error("socket com detalhe secreto"); }],
    ["unexpected-response", async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })],
    ["unexpected", async () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } })],
  ] as const)("should retain an unavailable reference for recoverable %s errors", async (reason, fakeFetch) => {
    const result = await fetchWikiContext(options(vi.fn(fakeFetch)), {
      storyId: 4211,
      description: "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/7/Pagina",
    });

    expect(result.references[0]).toMatchObject({
      status: "unavailable",
      depth: 0,
      reason,
      message: expect.any(String),
    });
  });

  it.each([
    new AdoError("conflict", "conflito deliberado"),
    new Error("falha desconhecida"),
  ])("should propagate non-recoverable errors when response access fails", async (failure) => {
    const doFetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Proxy(wikiPage(7, "/Página"), {
        get(target, property, receiver) {
          if (property === "ok") throw failure;
          return Reflect.get(target, property, receiver);
        },
      }),
    );

    await expect(fetchWikiContext(options(doFetch), {
      storyId: 4211,
      description: "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/7/Pagina",
    })).rejects.toBe(failure);
  });

  it("should emit structured decisions without description, page content, or credentials", async () => {
    const chunks: string[] = [];
    const logger = createLogger({
      destination: new Writable({
        write(chunk, _encoding, done) {
          chunks.push(String(chunk));
          done();
        },
      }),
      level: "debug",
    });
    const secretDescription =
      "segredo-da-descricao https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki/7/Pagina";

    await fetchWikiContext({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      fetch: vi.fn(async () => wikiPage(7, "/Página", "segredo-do-conteudo")),
      logger,
    }, { storyId: 4211, description: secretDescription });

    const logs = chunks.join("");
    expect({
      hasSummary: logs.includes('"attempts":1') && logs.includes("contexto Wiki da US coletado"),
      leaksDescription: logs.includes("segredo-da-descricao"),
      leaksContent: logs.includes("segredo-do-conteudo"),
      leaksPat: logs.includes(CREDENTIALS.pat),
      leaksAuthorization: logs.toLowerCase().includes("authorization"),
    }).toEqual({
      hasSummary: true,
      leaksDescription: false,
      leaksContent: false,
      leaksPat: false,
      leaksAuthorization: false,
    });
  });

  it("should omit pagePath queries from unavailable-page logs", async () => {
    const chunks: string[] = [];
    const logger = createLogger({
      destination: new Writable({
        write(chunk, _encoding, done) {
          chunks.push(String(chunk));
          done();
        },
      }),
      level: "debug",
    });

    await fetchWikiContext({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      fetch: vi.fn(async () => new Response("{}", {
        status: 404,
        headers: { "content-type": "application/json" },
      })),
      logger,
    }, {
      storyId: 4211,
      description:
        "https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki?pagePath=%2Fsegredo",
    });

    const logs = chunks.join("");
    expect({
      hasSanitizedTarget: logs.includes(
        '"target":"https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki"',
      ),
      leaksPagePath: logs.includes("pagePath") || logs.includes("segredo"),
    }).toEqual({ hasSanitizedTarget: true, leaksPagePath: false });
  });
});
