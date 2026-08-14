import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendDecisionTraceability,
  assertValidStructuredSpecMarkdown,
  assertValidSpecMarkdown,
  readSpecSection,
  renderSpecMarkdown,
  renderStructuredSpecMarkdown,
  stripDecisionRecordLinks,
} from "./spec";
import { SPEC_SECTIONS } from "./spec-vocabulary";
import type { DossieDocument } from "./types";

// A Spec carimba quando a decisão coletiva aconteceu; é hora local do Operador.
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
  it("should render every canonical structured Spec section deterministically", () => {
    const markdown = renderStructuredSpecMarkdown({
      problem: "Pedidos duplicados chegam ao ERP.",
      solution: "Aplicar uma chave idempotente no envio.",
      expectedBehaviors: ["Reenvios devolvem o pedido original."],
      implementationDecisions: ["Persistir a chave junto ao pedido."],
      testStrategy: ["Cobrir dois envios concorrentes com a mesma chave."],
      outOfScope: ["Deduplicar pedidos históricos."],
      traceability: ["Decisão: usar a chave enviada pelo cliente."],
    });

    expect(markdown).toBe(`# Spec da US

## Problema

Pedidos duplicados chegam ao ERP.

## Solução

Aplicar uma chave idempotente no envio.

## Comportamentos esperados

- Reenvios devolvem o pedido original.

## Decisões de implementação

- Persistir a chave junto ao pedido.

## Estratégia de testes

- Cobrir dois envios concorrentes com a mesma chave.

## Fora de escopo

- Deduplicar pedidos históricos.

## Rastreabilidade

- Decisão: usar a chave enviada pelo cliente.
`);
    expect(() => assertValidStructuredSpecMarkdown(markdown)).not.toThrow();
  });
  it("should title the spec with the story id and title", () => {
    expect(renderSpecMarkdown(REFINED)).toContain(
      "# Spec da US #4211 — TTL de sessão configurável",
    );
  });

  it("should link back to the story in Azure DevOps", () => {
    expect(renderSpecMarkdown(REFINED)).toContain(REFINED.story.url);
  });

  it("should record each collective resolution with its automatic timestamp", () => {
    const markdown = renderSpecMarkdown(REFINED);

    expect(markdown).toContain("**O TTL vira configurável por cliente ou global?** — Global");
    expect(markdown).toContain("_Resolução registrada em 06/08/2026 às 14:30._");
    expect(markdown).not.toContain("Decidido por");
  });

  it("should render the persisted timezone independently of the host timezone", () => {
    const saoPaulo = renderSpecMarkdown(REFINED, "America/Sao_Paulo");

    vi.stubEnv("TZ", "America/Los_Angeles");

    expect(renderSpecMarkdown(REFINED, "America/Sao_Paulo")).toBe(saoPaulo);
    expect(saoPaulo).toContain("_Resolução registrada em 06/08/2026 às 11:30._");
  });

  it("should keep the agent recommendation next to the decision it produced", () => {
    expect(renderSpecMarkdown(REFINED)).toContain(
      "Recomendação do agente: Global: nenhum cliente pediu valor próprio.",
    );
  });

  it("should include every decision question and answer in traceability before signature", () => {
    const markdown = renderSpecMarkdown(REFINED);
    const traceability = markdown.slice(markdown.indexOf("## Rastreabilidade de decisões"));

    expect(traceability).toContain("**O TTL vira configurável por cliente ou global?** — Global");
    expect(traceability).not.toContain("Registro #");
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

  it("should not count a custom heading as content of an empty canonical section", () => {
    const markdown = renderSpecMarkdown(REFINED).replace(
      `${SPEC_SECTIONS.pending.blurb}\n\n- O mobile entra nesta US?`,
      `\n## Nota do Operador\n\nDetalhe adicional.`,
    );

    expect(() => assertValidSpecMarkdown(markdown)).toThrow(/Pendências.*vazia/i);
  });

  it("should reject a duplicated canonical section", () => {
    const markdown = `${renderSpecMarkdown(REFINED)}\n## ${SPEC_SECTIONS.decisions.heading}\n\nOutra versão.\n`;

    expect(() => assertValidSpecMarkdown(markdown)).toThrow(/Decisões.*mais de uma vez/i);
  });

  it("should reject a signed Spec that removes decision traceability", () => {
    const markdown = renderSpecMarkdown(REFINED).replace(
      /\n\n## Rastreabilidade de decisões[\s\S]*$/,
      "\n",
    );

    expect(() => assertValidSpecMarkdown(markdown, REFINED.decisions)).toThrow(
      /rastreabilidade.*ausente/i,
    );
  });

  it.each([
    ["missing", "Observação livre do Operador."],
    ["altered", "_Nenhuma decisão relevante foi registrada._"],
  ] as const)("should reject a %s canonical empty traceability entry", (_kind, replacement) => {
    const markdown = renderSpecMarkdown(EMPTY).replace(
      "_Nenhuma decisão foi registrada._",
      replacement,
    );

    expect(() => assertValidSpecMarkdown(markdown, [])).toThrow(/nenhuma decisão foi registrada/i);
  });

  it("should require repeated reviewed entries in decision order", () => {
    const repeated = {
      ...REFINED.decisions[0]!,
      question: "A integração fica síncrona?",
      answer: "Sim",
    };
    const decisions = [
      repeated,
      { ...repeated, questionSeq: 2, questionId: "q2" },
    ];
    const markdown = renderSpecMarkdown({ ...REFINED, decisions }).replace(
      "- **A integração fica síncrona?** — Sim\n- **A integração fica síncrona?** — Sim",
      "- **A integração fica síncrona?** — Sim",
    );

    expect(() => assertValidSpecMarkdown(markdown, decisions)).toThrow(/decisão 2/i);
  });

  it("should reject a reviewed answer extended with an unsigned exception", () => {
    const decision = { ...REFINED.decisions[0]!, answer: "Sim" };
    const markdown = renderSpecMarkdown({ ...REFINED, decisions: [decision] }).replace(
      /(## Rastreabilidade de decisões[\s\S]*?)- \*\*O TTL vira configurável por cliente ou global\?\*\* — Sim/,
      "$1- **O TTL vira configurável por cliente ou global?** — Sim, mas com exceção",
    );

    expect(() => assertValidSpecMarkdown(markdown, [decision])).toThrow(/decisão 1/i);
  });

  it("should ignore a traceability heading inside fenced code", () => {
    const markdown = renderSpecMarkdown(REFINED)
      .replace(/\n\n## Rastreabilidade de decisões[\s\S]*$/, "\n")
      .concat("\n```markdown\n## Rastreabilidade de decisões\n\nEntrada de exemplo.\n```\n");

    expect(() => assertValidSpecMarkdown(markdown, REFINED.decisions)).toThrow(
      /rastreabilidade.*ausente/i,
    );
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
  it("should insert only the generated deep link into an Operator-edited signed trace", () => {
    const trace = "- **O TTL vira configurável por cliente ou global?** — Global";
    const signed = [
      "# Texto editado",
      "",
      "## Rastreabilidade de decisões",
      "",
      trace,
      "",
      "## Nota do Operador",
      "",
      "Detalhe assinado.",
    ].join("\n");

    const markdown = appendDecisionTraceability(signed, [{
      ...REFINED.decisions[0]!,
      recordId: 99,
      recordUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
    }]);

    expect(markdown).toBe(signed.replace(
      trace,
      `${trace}\n  - [Registro #99](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211#discussion_99)`,
    ));
    expect(markdown.match(/## Rastreabilidade de decisões/g)).toHaveLength(1);
  });

  it("should reject publication when the signed Spec has no reviewed trace", () => {
    expect(() => appendDecisionTraceability("# Texto sem rastreabilidade", [{
      ...REFINED.decisions[0]!,
      recordId: 99,
      recordUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
    }])).toThrow(/rastreabilidade.*assinada/i);
  });

  it("should not mistake repeated decision prose outside the signed trace for traceability", () => {
    const repeated = "- **O TTL vira configurável por cliente ou global?** — Global";
    const signed = [
      "# Texto editado",
      "",
      "## Rastreabilidade de decisões",
      "",
      "_Entrada removida pelo Operador._",
      "",
      "## Nota do Operador",
      "",
      repeated,
    ].join("\n");

    expect(() => appendDecisionTraceability(signed, [{
      ...REFINED.decisions[0]!,
      recordId: 99,
      recordUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
    }])).toThrow(/não contém.*decisão 1/i);
  });

  it("should attach one record link to each repeated signed trace entry", () => {
    const repeated = "- **A integração fica síncrona?** — Sim";
    const signed = `# Spec\n\n## Rastreabilidade de decisões\n\n${repeated}\n${repeated}\n`;
    const decisions = [91, 92].map((recordId, index) => ({
      questionSeq: index + 1,
      questionId: `q${index + 1}`,
      question: "A integração fica síncrona?",
      recommendation: "Sim",
      answer: "Sim",
      decidedAt: Date.UTC(2026, 7, 6, 14, 30),
      recordId,
      recordUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
    }));

    const markdown = appendDecisionTraceability(signed, decisions);

    expect(markdown).toContain(
      `${repeated}\n  - [Registro #91](https://dev.azure.com/acme/Plataforma/_workitems/edit/4211#discussion_91)\n${repeated}\n  - [Registro #92]`,
    );
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

  it("should stop at the decision traceability appendix", () => {
    const markdown = renderSpecMarkdown(EMPTY).replace(
      `_${SPEC_SECTIONS.outOfScope.empty}_`,
      "Fora de escopo: relatório mensal.",
    );

    const content = readSpecSection(markdown, SPEC_SECTIONS.outOfScope.heading);

    expect(content).toContain("Fora de escopo: relatório mensal.");
    expect(content).not.toContain("Rastreabilidade de decisões");
  });

  it("should not treat an unknown Markdown heading as a section boundary", () => {
    const markdown = renderSpecMarkdown(REFINED).replace(
      "\n\n## Rastreabilidade de decisões",
      "\n\n## Nota do Operador\ntexto\n\n## Rastreabilidade de decisões",
    );

    expect(readSpecSection(markdown, SPEC_SECTIONS.outOfScope.heading)).toContain(
      "## Nota do Operador",
    );
  });
});
