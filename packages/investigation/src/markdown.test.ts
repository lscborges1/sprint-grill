import { describe, expect, it } from "vitest";
import { renderReportMarkdown } from "./markdown";
import type { InvestigationReport } from "./report";

const STORY = {
  id: 4211,
  title: "TTL de sessão configurável",
  description: undefined,
  url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
};

const EMPTY: InvestigationReport = {
  summary: "Nada a mapear.",
  gaps: [],
  impacts: [],
  externalRepos: [],
  unverified: [],
};

const FULL: InvestigationReport = {
  summary: "A US mexe no cache de sessão.",
  gaps: [{ question: "Qual TTL?", why: "A US não diz e o cache expira em 1h." }],
  impacts: [
    {
      claim: "O TTL do cache precisa virar configurável.",
      citations: [
        { repo: "core-api", path: "src/cache/session.ts", symbol: "SESSION_TTL" },
        { repo: "core-api", path: "src/config.ts" },
      ],
    },
  ],
  externalRepos: [{ repo: "billing", suspicion: "lê a sessão pelo header X-Session." }],
  unverified: ["O mobile talvez dependa do TTL."],
};

describe("renderReportMarkdown", () => {
  it("should title the report with the story id and title", () => {
    expect(renderReportMarkdown(STORY, FULL)).toContain(
      "# Investigação — US #4211: TTL de sessão configurável",
    );
  });

  it("should render every citation with repo, path and symbol", () => {
    const markdown = renderReportMarkdown(STORY, FULL);

    expect(markdown).toContain("`core-api:src/cache/session.ts` → `SESSION_TTL`");
    expect(markdown).toContain("`core-api:src/config.ts`");
  });

  it("should keep unverified claims under their own heading, never in the body", () => {
    const markdown = renderReportMarkdown(STORY, FULL);
    const unverifiedAt = markdown.indexOf("## Não verificado");
    const claimAt = markdown.indexOf("O mobile talvez dependa do TTL.");

    expect(unverifiedAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(unverifiedAt);
  });

  it("should flag suspected impact on repos outside the squad config", () => {
    const markdown = renderReportMarkdown(STORY, FULL);

    expect(markdown).toContain("## Impacto suspeito fora do config");
    expect(markdown).toContain("**billing** — lê a sessão pelo header X-Session.");
  });

  it("should render all four sections even when the report is empty", () => {
    const markdown = renderReportMarkdown(STORY, EMPTY);

    for (const heading of [
      "## Furos da US",
      "## Impacto mapeado",
      "## Impacto suspeito fora do config",
      "## Não verificado",
    ]) {
      expect(markdown).toContain(heading);
    }
  });

  it("should link back to the story in Azure DevOps", () => {
    expect(renderReportMarkdown(STORY, EMPTY)).toContain(STORY.url);
  });

  it("should end with a single trailing newline", () => {
    const markdown = renderReportMarkdown(STORY, FULL);

    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
  });
});
