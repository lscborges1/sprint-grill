import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { SPEC_MARKER } from "./refinement-status";
import {
  publishDecisionRecord,
  publishStorySpec,
  replaceManagedSpec,
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
  it("should preserve the User Story description while appending the managed block", () => {
    const description = replaceManagedSpec("<div>Texto do PO</div>", "# Spec");

    expect(description).toContain("<div>Texto do PO</div>");
    expect(description).toContain(SPEC_MARKER);
    expect(description).toContain("# Spec");
  });

  it("should replace the prior managed block without duplicating the marker", () => {
    const first = replaceManagedSpec("Texto do PO", "# Primeira");
    const second = replaceManagedSpec(first, "# Segunda");

    expect(second).toContain("# Segunda");
    expect(second).not.toContain("# Primeira");
    expect(second.split(SPEC_MARKER)).toHaveLength(2);
  });

  it("should refuse a malformed managed block instead of truncating the User Story", () => {
    expect(() =>
      replaceManagedSpec("Texto do PO\n<!-- sprint-griller:spec:start -->\nNão apagar", "# Spec"),
    ).toThrow(/marcador de fechamento/i);
  });
});

describe("publishDecisionRecord", () => {
  it("should publish the deterministic human decision as a Markdown comment", async () => {
    const ado = fakeAdo(() => json({ commentId: 91 }));

    await expect(
      publishDecisionRecord(options(ado.fetch), {
        storyId: 4211,
        question: "O TTL é global?",
        answer: "Sim",
        recommendation: "Global",
        decidedBy: "PO + squad",
        decidedAt: Date.UTC(2026, 7, 6, 14, 30),
      }),
    ).resolves.toEqual({
      commentId: 91,
      url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
    });

    const [call] = ado.calls;
    expect(call?.init?.method).toBe("POST");
    expect(call?.url).toContain("format=markdown");
    expect(String(call?.init?.body)).toContain("**Decidido por:** PO + squad");
    expect(String(call?.init?.body)).toContain("2026-08-06T14:30:00.000Z");
  });
});

describe("publishStorySpec", () => {
  it("should PATCH only the managed description block with a revision guard", async () => {
    const ado = fakeAdo((call) =>
      call.init?.method === "PATCH"
        ? json({ id: 4211 })
        : json({ id: 4211, rev: 7, fields: { "System.Description": "<p>Texto do PO</p>" } }),
    );

    await publishStorySpec(options(ado.fetch), { storyId: 4211, markdown: "# Spec assinada" });

    const patch = ado.calls[1];
    expect(patch?.init?.method).toBe("PATCH");
    expect(patch?.init?.headers).toEqual(
      expect.objectContaining({ "content-type": "application/json-patch+json" }),
    );
    expect(JSON.parse(String(patch?.init?.body))).toEqual([
      { op: "test", path: "/rev", value: 7 },
      expect.objectContaining({
        op: "add",
        path: "/fields/System.Description",
        value: expect.stringContaining("<p>Texto do PO</p>"),
      }),
    ]);
  });

  it("should report a revision conflict as safe to retry", async () => {
    const ado = fakeAdo((call) =>
      call.init?.method === "PATCH"
        ? json({ message: "revision changed" }, 409)
        : json({ id: 4211, rev: 7, fields: {} }),
    );

    await expect(
      publishStorySpec(options(ado.fetch), { storyId: 4211, markdown: "# Spec" }),
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
    const ado = fakeAdo((call) =>
      call.init?.method === "PATCH" ? json({ id: 4211 }) : json({ id: 4211, rev: 7, fields: {} }),
    );

    await publishStorySpec({ ...options(ado.fetch), logger }, { storyId: 4211, markdown: "segredo da spec" });

    expect(JSON.stringify(lines)).not.toContain("segredo da spec");
  });
});
