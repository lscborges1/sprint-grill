import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/app/cerimonia/actions", () => ({
  addDoubtAction: vi.fn(),
  approveSpecAction: vi.fn(),
  approveTicketsAction: vi.fn(),
  discardSpecDraftAction: vi.fn(),
  dumpCeremonyAction: vi.fn(),
  reopenRefinementAction: vi.fn(),
  saveSpecDraftAction: vi.fn(),
  submitDecisionAction: vi.fn(),
}));

import { UiGalleryView } from "./gallery";

function inertAction(formData: FormData): void {
  void formData;
  return undefined;
}

it("should render representative Picker stories for the public gallery", () => {
  const html = renderToStaticMarkup(<UiGalleryView view="picker" action={inertAction} />);

  expect(html).toContain("Projeto Exemplo");
  expect(html).toContain("#117 · Exportar relatório");
  expect(html).toContain("#118 · Revisar critérios de aceite");
  expect(html).toContain("#119 · Publicar resumo da sprint");
  expect((html.match(/Sem investigação/g) ?? []).length).toBe(3);
  expect((html.match(/Investigada/g) ?? []).length).toBe(3);
  expect((html.match(/Refinada/g) ?? []).length).toBe(3);
  expect((html.match(/Não atribuído/g) ?? []).length).toBe(6);
});

it("should render an active Palco decision for the public gallery", () => {
  const html = renderToStaticMarkup(<UiGalleryView view="palco" action={inertAction} />);

  expect(html).toContain("Como o resumo deve ser publicado?");
  expect((html.match(/Como o resumo deve ser publicado\?/g) ?? []).length).toBe(3);
  expect(html).toContain("1 pergunta ativa");
  expect(html).toContain("Recomendação do agente:");
  expect(html).toContain("Publicar um resumo objetivo com os acordos da sprint.");
  expect(html).toContain("Registrar decisão");
});

it("should render a published Dossiê with a fixed 2026 resolution", () => {
  const html = renderToStaticMarkup(<UiGalleryView view="dossie" action={inertAction} />);

  expect(html).toContain("Dossiê — US #117");
  expect(html).toContain("Refinamento publicado");
  expect(html).toContain("15/01/2026 às 12:00");
});

it("should render the production investigation view", () => {
  const html = renderToStaticMarkup(<UiGalleryView view="investigacao" action={inertAction} />);

  expect(html).toContain("Relatório reprovado na checagem de citações");
});
