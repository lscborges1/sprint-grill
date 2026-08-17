import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/app/cerimonia/actions", () => ({
  approveSpecAction: vi.fn(),
  approveTicketsAction: vi.fn(),
  discardSpecDraftAction: vi.fn(),
  dumpCeremonyAction: vi.fn(),
  reopenRefinementAction: vi.fn(),
  saveSpecDraftAction: vi.fn(),
}));

import { UiGalleryView } from "./gallery";

function inertAction(formData: FormData): void {
  void formData;
  return undefined;
}

it.each([
  ["picker", "#117 · Exportar relatório"],
  ["investigacao", "Relatório reprovado na checagem de citações"],
  ["palco", "Refinamento publicado"],
  ["dossie", "Dossiê — US #117"],
] as const)("should render the production %s view", (view, marker) => {
  const html = renderToStaticMarkup(<UiGalleryView view={view} action={inertAction} />);

  expect(html).toContain(marker);
});
