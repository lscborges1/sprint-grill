import { describe, expect, it } from "vitest";
import { parseReport } from "./report";

const VALID = {
  summary: "A US mexe no cache de sessão.",
  gaps: [{ question: "Qual TTL?", why: "A US não diz e o cache atual expira em 1h." }],
  impacts: [
    {
      claim: "O TTL do cache de sessão precisa virar configurável.",
      citations: [
        { repo: "core-api", path: "src/cache/session.ts", symbol: "SESSION_TTL" },
      ],
    },
  ],
  externalRepos: [{ repo: "billing", suspicion: "consome a sessão pelo header X-Session." }],
  unverified: ["O mobile talvez dependa do TTL."],
};

describe("parseReport", () => {
  it("should read the report when the agent wraps it in a json fence", () => {
    const result = parseReport(
      `Fechei a investigação.\n\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n`,
    );

    expect(result).toEqual({ ok: true, report: VALID });
  });

  it("should read the report when the agent answers with bare json", () => {
    const result = parseReport(JSON.stringify(VALID));

    expect(result).toMatchObject({ ok: true });
  });

  it("should take the last fence when the agent shows a draft first", () => {
    const draft = { ...VALID, summary: "rascunho" };
    const result = parseReport(
      `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\`\n\nCorrigindo:\n\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``,
    );

    expect(result).toEqual({ ok: true, report: VALID });
  });

  it("should default the optional lists so an empty report still parses", () => {
    const result = parseReport(JSON.stringify({ summary: "Nada a mapear." }));

    expect(result).toEqual({
      ok: true,
      report: {
        summary: "Nada a mapear.",
        gaps: [],
        impacts: [],
        externalRepos: [],
        unverified: [],
      },
    });
  });

  it("should reject an impact claim with no citation", () => {
    const result = parseReport(
      JSON.stringify({
        ...VALID,
        impacts: [{ claim: "Some coisa vai quebrar.", citations: [] }],
      }),
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.message).toContain("citação");
  });

  it("should reject text with no json at all", () => {
    const result = parseReport("Não consegui investigar essa US.");

    expect(result).toMatchObject({ ok: false });
  });

  it("should reject json that is not an object", () => {
    const result = parseReport("[1, 2, 3]");

    expect(result).toMatchObject({ ok: false });
  });
});
