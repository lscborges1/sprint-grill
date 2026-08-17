// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DOSSIE_STATE } from "@/app/__dev/ui/fixtures";
import { discardSpecDraftAction } from "../../actions";
import { DossieView } from "./dossie";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../../actions", () => ({
  approveSpecAction: vi.fn(),
  approveTicketsAction: vi.fn(),
  discardSpecDraftAction: vi.fn(),
  reopenRefinementAction: vi.fn(),
  saveSpecDraftAction: vi.fn(),
}));

describe("DossieView", () => {
  it("should describe the active Spec gate when the completion proposal is retained", () => {
    const proposal = "A Agenda foi resolvida e a sala confirmou o avanço.";
    const state = {
      ...DOSSIE_STATE,
      refinement: { ...DOSSIE_STATE.refinement, phase: "revisando-spec" as const },
      completionProposal: { summary: proposal, proposedAt: 7 },
    };

    const html = renderToStaticMarkup(<DossieView state={state} connected />);

    expect(html).toContain("A Spec está disponível para leitura e aprovação.");
    expect(html).toContain(`Proposta de conclusão: ${proposal}`);
  });

  it("should expose Spec reconciliation while read mode blocks approval", () => {
    const state = {
      ...DOSSIE_STATE,
      refinement: { ...DOSSIE_STATE.refinement, phase: "revisando-spec" as const },
      spec: {
        generated: "# Spec atualizada",
        draft: { markdown: "# Rascunho anterior", base: "# Spec anterior", savedAt: 7 },
      },
    };

    const html = renderToStaticMarkup(<DossieView state={state} connected />);

    expect(html).toContain("A Spec precisa ser reconciliada");
    expect(html).toContain("Regenerar da versão atual");
  });

  it("should show a regeneration failure without entering edit mode", async () => {
    const state = {
      ...DOSSIE_STATE,
      refinement: { ...DOSSIE_STATE.refinement, phase: "revisando-spec" as const },
      spec: {
        generated: "# Spec atualizada",
        draft: { markdown: "# Rascunho anterior", base: "# Spec anterior", savedAt: 7 },
      },
    };
    vi.mocked(discardSpecDraftAction).mockImplementation(async (_previous, formData) => ({
      status: "error",
      requestId: String(formData.get("requestId")),
      message: "A Spec mudou durante a regeneração.",
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<DossieView state={state} connected />));
      const regenerateButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Regenerar da versão atual",
      );
      if (regenerateButton === undefined) throw new Error("expected the regeneration button");

      await act(async () => regenerateButton.click());

      expect({
        error: container.textContent?.includes("A Spec mudou durante a regeneração."),
        editLabel: container.textContent?.includes("Markdown aprovado da Spec"),
      }).toEqual({ error: true, editLabel: false });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.mocked(discardSpecDraftAction).mockReset();
    }
  });

  it("should link ticket review to the canonical User Story URL when a ticket supplies a forged URL", () => {
    const state = {
      ...DOSSIE_STATE,
      refinement: { ...DOSSIE_STATE.refinement, phase: "revisando-tickets" as const },
      artifacts: {
        ...DOSSIE_STATE.artifacts,
        tickets: {
          ...DOSSIE_STATE.artifacts.tickets,
          submission: {
            tickets: [{
              ...DOSSIE_STATE.artifacts.tickets.submission.tickets[0],
              specUrl: "https://forged.example/redirect",
            }],
          },
        },
      },
    };

    const html = renderToStaticMarkup(<DossieView state={state} connected />);

    expect(html).toContain(`href="${DOSSIE_STATE.story.url}"`);
    expect(html).not.toContain("https://forged.example/redirect");
  });

  it("should present a published Dossiê as a completed workflow", () => {
    const html = renderToStaticMarkup(<DossieView state={DOSSIE_STATE} connected />);

    expect({
      published: html.includes("Refinamento publicado"),
      noCurrentStep: !html.includes('aria-current="step"'),
      completedSteps: (html.match(/data-state="complete"/g) ?? []).length,
    }).toEqual({ published: true, noCurrentStep: true, completedSteps: 5 });
  });

  it("should not advertise unpublished artifact anchors in a published Dossiê", () => {
    const html = renderToStaticMarkup(<DossieView state={DOSSIE_STATE} connected />);

    expect({
      keepsRenderedSections: html.includes('href="#gate"') && html.includes('href="#agenda"') && html.includes('href="#resolucoes"'),
      hidesDeadArtifactAnchors: !html.includes('href="#spec"') && !html.includes('href="#tickets"') && !html.includes('href="#publicacao"'),
    }).toEqual({ keepsRenderedSections: true, hidesDeadArtifactAnchors: true });
  });
});
