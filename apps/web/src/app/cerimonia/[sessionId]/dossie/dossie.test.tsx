import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DOSSIE_STATE } from "@/app/__dev/ui/fixtures";
import { DossieView } from "./dossie";

vi.mock("../../actions", () => ({
  approveSpecAction: vi.fn(),
  approveTicketsAction: vi.fn(),
  reopenRefinementAction: vi.fn(),
}));

describe("DossieView", () => {
  it("should present a published Dossiê as a completed workflow", () => {
    const html = renderToStaticMarkup(<DossieView state={DOSSIE_STATE} connected />);

    expect({
      published: html.includes("Refinamento publicado"),
      noCurrentStep: !html.includes('aria-current="step"'),
      completedSteps: (html.match(/data-state="complete"/g) ?? []).length,
    }).toEqual({ published: true, noCurrentStep: true, completedSteps: 5 });
  });
});
