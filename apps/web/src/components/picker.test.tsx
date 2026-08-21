// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { filterPickerStories, Picker, type PickerStory } from "./picker";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const stories: readonly PickerStory[] = [
  {
    id: 101,
    title: "Exportar relatório",
    type: "User Story",
    state: "Active",
    assignedTo: "Ana",
    url: "https://example.com/101",
    refinement: "sem-investigacao",
    action: { kind: "start", label: "Investigar" },
  },
  {
    id: 102,
    title: "Calcular parcelas",
    type: "User Story",
    state: "New",
    assignedTo: undefined,
    url: "https://example.com/102",
    refinement: "investigada",
    action: { kind: "open", label: "Acompanhar execução" },
  },
  {
    id: 103,
    title: "Revisar contratos",
    type: "User Story",
    state: "Active",
    assignedTo: "João",
    url: "https://example.com/103",
    refinement: "investigada",
    action: { kind: "open", label: "Revisar reprovação" },
  },
];

describe("Picker", () => {
  it("should filter the backlog by title and refinement status", () => {
    expect(filterPickerStories(stories, "parcelas", "all")).toHaveLength(1);
    expect(filterPickerStories(stories, "", "sem-investigacao")).toHaveLength(1);
    expect(filterPickerStories(stories, "ausente", "all")).toHaveLength(0);
  });

  it("should render a responsive story table with the next action", () => {
    const html = renderToStaticMarkup(
      <Picker
        stories={stories}
        project="Plataforma"
        repos={{ primary: { name: "api", path: "/tmp/api" }, related: [] }}
        startAction={() => undefined}
      />,
    );

    expect(html).toContain("Backlog");
    expect(html).toContain("Exportar relatório");
    expect(html).toContain("Acompanhar execução");
    expect(html).toContain("Revisar reprovação");
    expect(html).toContain('aria-label="Buscar no backlog"');
    expect(html).toContain("Config da squad");
  });

  it("should distinguish action targets by User Story", () => {
    const html = renderToStaticMarkup(
      <Picker
        stories={stories}
        project="Plataforma"
        repos={{ primary: { name: "api", path: "/tmp/api" }, related: [] }}
        startAction={() => undefined}
      />,
    );

    expect({
      start: html.includes('aria-label="Investigar — US #101: Exportar relatório"'),
      open: html.includes('aria-label="Acompanhar execução — US #102: Calcular parcelas"'),
    }).toEqual({ start: true, open: true });
  });

  it("should explain when no User Story matches the search", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <Picker stories={stories} project="Plataforma" repos={{ primary: { name: "api", path: "/tmp/api" }, related: [] }} startAction={() => undefined} />,
        );
      });

      const search = container.querySelector('[aria-label="Buscar no backlog"]');
      if (!(search instanceof HTMLInputElement)) throw new Error("expected the Picker search input");
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setValue === undefined) throw new Error("expected the native input value setter");

      await act(async () => {
        setValue.call(search, "ausente");
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(container.textContent).toContain("Nenhuma US corresponde aos filtros");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
