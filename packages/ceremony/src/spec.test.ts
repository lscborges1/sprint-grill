import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendDecisionTraceability,
  assertValidSpecMarkdown,
  readSpecSection,
  renderSpecMarkdown,
  stripDecisionRecordLinks,
} from "./spec";
import { SPEC_SECTIONS } from "./spec-vocabulary";
import type { DossieDocument } from "./types";

// A Spec carimba quem decidiu e quando, e o "quando" é hora local do Operador.
// Fixar o fuso em cada teste deixa o carimbo verificável sem contaminar o worker.
beforeEach(() => {
  vi.stubEnv("TZ", "UTC");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const EMPTY: DossieDocument = {
  story: {
    id: 4211,
    title: "TTL de sessão configurável",
    url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
  },
  decisions: [],
  pending: [],
  investigation: { impact: "", unverified: "" },
};

const REFINED: DossieDocument = {
  ...EMPTY,
  decisions: [
    {
      questionSeq: 1,
      questionId: "q1",
      question: "O TTL vira configurável por cliente ou global?",
      recommendation: "Global: nenhum cliente pediu valor próprio.",
      answer: "Global",
      decidedBy: "PO + squad",
      decidedAt: Date.UTC(2026, 7, 6, 14, 30),
    },
  ],
  pending: [{ id: "q2", question: "O mobile entra nesta US?" }],
  investigation: {
    impact: "- O TTL do cache precisa virar configurável.\n  - `core-api:src/cache/session.ts`",
    unverified: "- O mobile talvez dependa do TTL.",
  },
};

describe("renderSpecMarkdown", () => {
  it("should title the spec with the story id and title", () => {
    expect(renderSpecMarkdown(REFINED)).toContain(
      "# Spec da US #4211 — TTL de sessão configurável",
    );
  });

  it("should link back to the story in Azure DevOps", () => {
    expect(renderSpecMarkdown(REFINED)).toContain(REFINED.story.url);
  });

  it("should record each decision with what was decided, by whom and when", () => {
    const markdown = renderSpecMarkdown(REFINED);

    expect(markdown).toContain("**O TTL vira configurável por cliente ou global?** — Global");
    expect(markdown).toContain("_Decidido por PO + squad em 06/08/2026 às 14:30._");
  });

  it("should render the persisted timezone independently of the host timezone", () => {
    const saoPaulo = renderSpecMarkdown(REFINED, "America/Sao_Paulo");

    vi.stubEnv("TZ", "America/Los_Angeles");

    expect(renderSpecMarkdown(REFINED, "America/Sao_Paulo")).toBe(saoPaulo);
    expect(saoPaulo).toContain("_Decidido por PO + squad em 06/08/2026 às 11:30._");
  });

  it("should keep the agent recommendation next to the decision it produced", () => {
    expect(renderSpecMarkdown(REFINED)).toContain(
      "Recomendação do agente: Global: nenhum cliente pediu valor próprio.",
    );
  });

  it("should link each decision to its Azure DevOps record when one exists", () => {
    const markdown = renderSpecMarkdown({
      ...EMPTY,
      decisions: [
        {
          questionSeq: 1,
          questionId: "q1",
          question: "O TTL vira configurável por cliente ou global?",
          recommendation: "Global",
          answer: "Global",
          decidedBy: "PO",
          decidedAt: Date.UTC(2026, 7, 6, 14, 30),
          recordId: 99,
          recordUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/99",
        },
      ],
    });

    expect(markdown).toContain(
      "[#99](https://dev.azure.com/acme/Plataforma/_workitems/edit/99)",
    );
  });

  it("should carry the impact context from the Investigação", () => {
    const markdown = renderSpecMarkdown(REFINED);
    const impactAt = markdown.indexOf(`## ${SPEC_SECTIONS.impact.heading}`);

    expect(impactAt).toBeGreaterThan(-1);
    expect(markdown.indexOf("`core-api:src/cache/session.ts`")).toBeGreaterThan(impactAt);
  });

  it("should keep unverified claims under their own heading, never in the body", () => {
    const markdown = renderSpecMarkdown(REFINED);
    const unverifiedAt = markdown.indexOf(`## ${SPEC_SECTIONS.unverified.heading}`);

    expect(unverifiedAt).toBeGreaterThan(-1);
    expect(markdown.indexOf("O mobile talvez dependa do TTL.")).toBeGreaterThan(unverifiedAt);
  });

  it("should list what the room has not answered as a pending item", () => {
    const markdown = renderSpecMarkdown(REFINED);
    const pendingAt = markdown.indexOf(`## ${SPEC_SECTIONS.pending.heading}`);

    expect(pendingAt).toBeGreaterThan(-1);
    expect(markdown.indexOf("O mobile entra nesta US?")).toBeGreaterThan(pendingAt);
  });

  it("should render every section even when nothing was decided yet", () => {
    const markdown = renderSpecMarkdown(EMPTY);

    for (const section of Object.values(SPEC_SECTIONS)) {
      expect(markdown).toContain(`## ${section.heading}`);
      expect(markdown).toContain(section.empty);
    }
  });

  it("should end with a single trailing newline", () => {
    const markdown = renderSpecMarkdown(REFINED);

    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
  });
});

describe("assertValidSpecMarkdown", () => {
  it("should accept generated and valid Operator-edited Specs", () => {
    const generated = renderSpecMarkdown(REFINED);
    const edited = `${generated}\n## Nota do Operador\n\nDetalhe adicional.\n`;

    expect(() => assertValidSpecMarkdown(generated)).not.toThrow();
    expect(() => assertValidSpecMarkdown(edited)).not.toThrow();
  });

  it("should report every missing canonical section", () => {
    expect(() => assertValidSpecMarkdown("# Nota\n")).toThrow(
      /Decisões.*Contexto de impacto.*Não verificado.*Pendências.*Fora de escopo/s,
    );
  });

  it("should reject an empty canonical section", () => {
    const markdown = renderSpecMarkdown(REFINED).replace(
      `${SPEC_SECTIONS.impact.blurb}\n\n${REFINED.investigation.impact}`,
      "",
    );

    expect(() => assertValidSpecMarkdown(markdown)).toThrow(/Contexto de impacto.*vazia/i);
  });

  it("should reject a duplicated canonical section", () => {
    const markdown = `${renderSpecMarkdown(REFINED)}\n## ${SPEC_SECTIONS.decisions.heading}\n\nOutra versão.\n`;

    expect(() => assertValidSpecMarkdown(markdown)).toThrow(/Decisões.*mais de uma vez/i);
  });

  it("should ignore canonical-looking headings inside fenced code", () => {
    const fenced = [
      "````markdown",
      "```",
      ...Object.values(SPEC_SECTIONS).flatMap((section) => [
        `## ${section.heading}`,
        "conteúdo de exemplo",
      ]),
      "````",
    ].join("\n");

    expect(() => assertValidSpecMarkdown(fenced)).toThrow(/Decisões.*Fora de escopo/s);
  });
});

describe("appendDecisionTraceability", () => {
  it("should append every question and answer with one deep link to an Operator-edited signed Spec", () => {
    const markdown = appendDecisionTraceability("# Texto editado", [
      {
        ...REFINED.decisions[0]!,
        recordId: 99,
        recordUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
      },
    ]);

    expect(markdown).toContain("# Texto editado");
    expect(markdown).toContain("## Rastreabilidade de decisões");
    expect(markdown).toContain("**O TTL vira configurável por cliente ou global?** — Global");
    expect(markdown).toContain(
      "[Registro #99](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211#discussion_99)",
    );
    expect(markdown.match(/\[Registro #99\]\([^)]*\)/g)).toHaveLength(1);
  });
});

describe("stripDecisionRecordLinks", () => {
  it("should leave a draft current when only dump record links were added", () => {
    const before = renderSpecMarkdown(REFINED);
    const after = renderSpecMarkdown({
      ...REFINED,
      decisions: [{
        ...REFINED.decisions[0]!,
        recordId: 99,
        recordUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
      }],
    });

    expect(stripDecisionRecordLinks(after)).toBe(before);
  });
});

describe("readSpecSection", () => {
  it("should read a section when its heading starts the document", () => {
    const markdown = `## ${SPEC_SECTIONS.outOfScope.heading}\nFora de escopo: relatório mensal.`;

    expect(readSpecSection(markdown, SPEC_SECTIONS.outOfScope.heading)).toBe(
      "Fora de escopo: relatório mensal.",
    );
  });

  it("should read persisted content until the next canonical section", () => {
    const markdown = renderSpecMarkdown(REFINED).replace(
      `_${SPEC_SECTIONS.outOfScope.empty}_`,
      "Fora de escopo: relatório mensal.",
    );

    expect(readSpecSection(markdown, SPEC_SECTIONS.outOfScope.heading)).toContain(
      "Fora de escopo: relatório mensal.",
    );
  });

  it("should not treat an unknown Markdown heading as a section boundary", () => {
    const markdown = `${renderSpecMarkdown(REFINED)}\n## Nota do Operador\ntexto`;

    expect(readSpecSection(markdown, SPEC_SECTIONS.outOfScope.heading)).toContain(
      "## Nota do Operador",
    );
  });
});
