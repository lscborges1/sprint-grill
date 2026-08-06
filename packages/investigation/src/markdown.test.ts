import { describe, expect, it } from "vitest";
import type { GroundingResult } from "./grounding";
import { renderReportMarkdown } from "./markdown";
import type { InvestigationReport } from "./report";

const APPROVED: GroundingResult = { status: "aprovado" };

const REJECTED: GroundingResult = {
  status: "reprovado",
  violations: [
    {
      claim: "O TTL do cache precisa virar configurável.",
      citation: { repo: "core-api", path: "src/inventado.ts" },
      reason: "caminho-inexistente",
      detail: 'core-api: o arquivo "src/inventado.ts" não existe.',
    },
  ],
};

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
    expect(renderReportMarkdown(STORY, FULL, APPROVED)).toContain(
      "# Investigação — US #4211: TTL de sessão configurável",
    );
  });

  it("should render every citation with repo, path and symbol", () => {
    const markdown = renderReportMarkdown(STORY, FULL, APPROVED);

    expect(markdown).toContain("`core-api:src/cache/session.ts → SESSION_TTL`");
    expect(markdown).toContain("`core-api:src/config.ts`");
  });

  it("should say the impacts passed the citation check when grounding approved", () => {
    expect(renderReportMarkdown(STORY, FULL, APPROVED)).toContain(
      "Toda afirmação abaixo passou pela checagem mecânica de citações.",
    );
  });

  it("should never claim a rejected report passed the citation check", () => {
    const markdown = renderReportMarkdown(STORY, FULL, REJECTED);

    expect(markdown).not.toContain("passou pela checagem mecânica");
  });

  it("should open a rejected report with the verdict and the failed citations", () => {
    const markdown = renderReportMarkdown(STORY, FULL, REJECTED);
    const verdictAt = markdown.indexOf("Relatório reprovado na checagem de citações");
    const summaryAt = markdown.indexOf(FULL.summary);

    expect(verdictAt).toBeGreaterThan(-1);
    expect(verdictAt).toBeLessThan(summaryAt);
    expect(markdown).toContain('core-api: o arquivo "src/inventado.ts" não existe.');
  });

  it("should keep unverified claims under their own heading, never in the body", () => {
    const markdown = renderReportMarkdown(STORY, FULL, APPROVED);
    const unverifiedAt = markdown.indexOf("## Não verificado");
    const claimAt = markdown.indexOf("O mobile talvez dependa do TTL.");

    expect(unverifiedAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(unverifiedAt);
  });

  it("should flag suspected impact on repos outside the squad config", () => {
    const markdown = renderReportMarkdown(STORY, FULL, APPROVED);

    expect(markdown).toContain("## Impacto suspeito fora do config");
    expect(markdown).toContain("**billing** — lê a sessão pelo header X-Session.");
  });

  it("should render all four sections even when the report is empty", () => {
    const markdown = renderReportMarkdown(STORY, EMPTY, APPROVED);

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
    expect(renderReportMarkdown(STORY, EMPTY, APPROVED)).toContain(STORY.url);
  });

  it("should end with a single trailing newline", () => {
    const markdown = renderReportMarkdown(STORY, FULL, APPROVED);

    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
  });
});
