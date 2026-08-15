import type { InvestigationRun } from "../../../lib/investigations";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvestigationView } from "./investigation-view";

const rejectedRun = {
  storyId: 117,
  story: {
    id: 117,
    title: "Exportar relatório",
    type: "User Story",
    state: "New",
    description: "Exportar o relatório em CSV.",
    url: "https://example.com/117",
  },
  startedAt: 1,
  finishedAt: 2,
  previous: undefined,
  publication: undefined,
  status: "reprovado",
  report: {
    summary: "A regra ainda não está ancorada no código.",
    gaps: [],
    impacts: [],
    externalRepos: [],
    unverified: ["Formato final do CSV."],
  },
  markdown: "# Investigação — US #117\n",
  violations: [{
    claim: "O endpoint já existe.",
    citation: { repo: "core-api", path: "src/export.ts" },
    reason: "caminho-inexistente",
    detail: "core-api: o arquivo src/export.ts não existe.",
  }],
} as const satisfies InvestigationRun;

function inertAction(_formData: FormData): void {
  void _formData;
  return undefined;
}

describe("InvestigationView", () => {
  it("should render a rejected investigation without reading runtime state or exposing writes", () => {
    const html = renderToStaticMarkup(
      <InvestigationView
        model={{ storyId: 117, run: rejectedRun, openCeremonyId: undefined }}
        actions={{ startCeremony: inertAction, publishInvestigation: inertAction }}
      />,
    );

    expect({
      identifiesStory: html.includes("Investigação · US #117"),
      showsRejection: html.includes("Relatório reprovado na checagem de citações"),
      hasNoPublish: !html.includes(">Publicar<"),
      hasNoCeremonyStart: !html.includes("Refinar com a sala"),
    }).toEqual({
      identifiesStory: true,
      showsRejection: true,
      hasNoPublish: true,
      hasNoCeremonyStart: true,
    });
  });
});
