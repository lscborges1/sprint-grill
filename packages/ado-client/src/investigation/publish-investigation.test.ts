import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { AdoError } from "../ado-error";
import { inferRefinementStatus } from "../refinement/refinement-status";
import { publishInvestigation } from "./publish-investigation";

const AZURE_DEVOPS = { organization: "acme", project: "Plataforma" };
const CREDENTIALS = { pat: "pat-de-teste" };

const MARKDOWN = "# Investigação — US #4211\n\nO TTL hoje é fixo.\n";

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** As linhas do log, já parseadas — é onde o rastro da escrita é conferido. */
function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    name: "ado-client",
    level: "debug",
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        done();
      },
    }),
  });

  return { logger, lines };
}

function fakeAdo(respond: () => Response) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  });

  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function publish(
  respond: () => Response,
  logger = capturingLogger().logger,
): { promise: Promise<unknown>; calls: Call[] } {
  const ado = fakeAdo(respond);

  return {
    calls: ado.calls,
    promise: publishInvestigation(
      {
        azureDevOps: AZURE_DEVOPS,
        credentials: CREDENTIALS,
        logger,
        fetch: ado.fetch,
      },
      { storyId: 4211, markdown: MARKDOWN },
    ),
  };
}

function bodyOf(call: Call): { text: string } {
  return JSON.parse(String(call.init?.body)) as { text: string };
}

describe("publishInvestigation", () => {
  it("should post the report as a Markdown comment on the story itself", async () => {
    const { promise, calls } = publish(() => json({ id: 77, workItemId: 4211 }));
    await promise;

    const [call] = calls;
    expect(call?.init?.method).toBe("POST");
    expect(call?.url).toContain(
      "/acme/Plataforma/_apis/wit/workItems/4211/comments",
    );
    // format=0 é Markdown; sem isso o ADO trata o relatório como HTML cru.
    expect(call?.url).toContain("format=0");
    expect(bodyOf(call!).text).toContain(MARKDOWN);
  });

  it("should embed the marker the picker reads, so the US turns investigada", async () => {
    const { promise, calls } = publish(() => json({ id: 77 }));
    await promise;

    const published = bodyOf(calls[0]!).text;

    expect(inferRefinementStatus({ description: undefined, comments: [published] })).toBe(
      "investigada",
    );
  });

  it("should return the comment and a link the operator can open", async () => {
    const { promise } = publish(() => json({ id: 77 }));

    await expect(promise).resolves.toEqual({
      commentId: 77,
      url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
    });
  });

  it("should log the write with its payload, so every ADO write has a trail", async () => {
    const { logger, lines } = capturingLogger();
    const { promise } = publish(() => json({ id: 77 }), logger);
    await promise;

    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "info",
        payload: { text: expect.stringContaining(MARKDOWN) as unknown },
      }),
    );
  });

  it("should never log the credential alongside the payload", async () => {
    const { logger, lines } = capturingLogger();
    const { promise } = publish(() => json({ id: 77 }), logger);
    await promise;

    expect(JSON.stringify(lines)).not.toContain(CREDENTIALS.pat);
  });

  it("should say the PAT needs write scope when the ADO refuses the credential", async () => {
    const { promise } = publish(() => json({ message: "denied" }, 403));

    await expect(promise).rejects.toMatchObject({
      kind: "auth",
      message: expect.stringContaining("escrita"),
    });
  });

  it("should say nothing was published when the story does not exist", async () => {
    const { promise } = publish(() => json({ message: "gone" }, 404));

    await expect(promise).rejects.toMatchObject({
      kind: "not-found",
      message: expect.stringContaining("nada foi publicado"),
    });
  });

  it("should tell the operator to check the US when the write may have half landed", async () => {
    // 2xx com corpo fora do contrato: o comment provavelmente existe, e dizer
    // "falhou" mandaria o Operador republicar em cima de um comment já gravado.
    const { promise } = publish(() => json({ semId: true }));

    await expect(promise).rejects.toMatchObject({
      kind: "unexpected-response",
      message: expect.stringContaining("Confira a US"),
    });
  });

  it("should tell the operator to check the US when the connection dies mid-write", async () => {
    const { promise } = publish(() => {
      throw new TypeError("fetch failed");
    });

    await expect(promise).rejects.toMatchObject({
      kind: "connection",
      message: expect.stringContaining("Confira a US"),
    });
  });

  it("should fail with an AdoError, never a raw HTTP error, when the ADO breaks", async () => {
    const { promise } = publish(() => json({ message: "boom" }, 500));

    await expect(promise).rejects.toBeInstanceOf(AdoError);
  });
});
