import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { filterPickerStories, Picker, type PickerStory } from "./picker";

const stories: readonly PickerStory[] = [
  {
    id: 101,
    title: "Exportar relatório",
    type: "User Story",
    state: "Active",
    assignedTo: "Ana",
    url: "https://example.com/101",
    refinement: "sem-investigacao",
    uiStatus: { kind: "ready", persisted: "sem-investigacao" },
  },
  {
    id: 102,
    title: "Calcular parcelas",
    type: "User Story",
    state: "New",
    assignedTo: undefined,
    url: "https://example.com/102",
    refinement: "investigada",
    uiStatus: { kind: "running", persisted: "investigada", startedAt: 1 },
  },
  {
    id: 103,
    title: "Revisar contratos",
    type: "User Story",
    state: "Active",
    assignedTo: "João",
    url: "https://example.com/103",
    refinement: "investigada",
    uiStatus: { kind: "review-rejected", persisted: "investigada" },
  },
];

describe("Picker", () => {
  it("should filter the current sprint by title and refinement status", () => {
    expect(filterPickerStories(stories, "parcelas", "all")).toHaveLength(1);
    expect(filterPickerStories(stories, "", "sem-investigacao")).toHaveLength(1);
    expect(filterPickerStories(stories, "ausente", "all")).toHaveLength(0);
  });

  it("should render a responsive story table with the next action", () => {
    const html = renderToStaticMarkup(
      <Picker
        iterationName="Sprint 42"
        stories={stories}
        project="Plataforma"
        repos={{ primary: { name: "api", path: "/tmp/api" }, related: [] }}
        startAction={() => undefined}
      />,
    );

    expect(html).toContain("Sprint 42");
    expect(html).toContain("Exportar relatório");
    expect(html).toContain("Acompanhar execução");
    expect(html).toContain("Revisar reprovação");
    expect(html).toContain('aria-label="Buscar na sprint atual"');
    expect(html).toContain("Config da squad");
  });

  it("should explain a contextual empty filter result", () => {
    const html = renderToStaticMarkup(
      <Picker iterationName="Sprint 42" stories={stories} project="Plataforma" repos={{ primary: { name: "api", path: "/tmp/api" }, related: [] }} startAction={() => undefined} />,
    );

    expect(html).toContain("Limpar filtros");
  });
});
