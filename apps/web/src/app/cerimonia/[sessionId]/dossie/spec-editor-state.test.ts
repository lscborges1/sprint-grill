import { describe, expect, it } from "vitest";
import { reconcileSpecDraft } from "./spec-editor-state";

const generated = "# Spec da US #4242";
const edited = "# Spec da US #4242\n\nFora de escopo: relatório mensal.";

describe("reconcileSpecDraft", () => {
  it("should adopt the revision when the echo of this tab's own save arrives", () => {
    const state = reconcileSpecDraft({
      draft: { markdown: edited, base: generated, savedAt: 10 },
      generated,
      markdown: edited,
      base: generated,
      adoptedAt: null,
    });

    expect(state).toEqual({ adoptedAt: 10, expectedSavedAt: 10, conflict: null });
  });

  it("should flag a discard conflict when another tab throws away the draft this tab saved", () => {
    const saved = reconcileSpecDraft({
      draft: { markdown: edited, base: generated, savedAt: 10 },
      generated,
      markdown: edited,
      base: generated,
      adoptedAt: null,
    });

    // A outra aba regenerou: o rascunho gravado sumiu, o texto daqui continua.
    const state = reconcileSpecDraft({
      draft: null,
      generated,
      markdown: edited,
      base: generated,
      adoptedAt: saved.adoptedAt,
    });

    expect(state.conflict).toBe("descarte");
  });

  it("should flag an edit conflict when another tab saved a different text", () => {
    const state = reconcileSpecDraft({
      draft: { markdown: "outra aba", base: generated, savedAt: 20 },
      generated,
      markdown: edited,
      base: generated,
      adoptedAt: 10,
    });

    expect(state).toEqual({ adoptedAt: 10, expectedSavedAt: 10, conflict: "edicao" });
  });

  it("should keep the adopted revision when the Operator types over the saved draft", () => {
    const state = reconcileSpecDraft({
      draft: { markdown: edited, base: generated, savedAt: 10 },
      generated,
      markdown: `${edited}\n\nE mais uma linha.`,
      base: generated,
      adoptedAt: 10,
    });

    expect(state).toEqual({ adoptedAt: 10, expectedSavedAt: 10, conflict: null });
  });

  it("should ask for no revision before the first save", () => {
    const state = reconcileSpecDraft({
      draft: null,
      generated,
      markdown: edited,
      base: generated,
      adoptedAt: null,
    });

    expect(state).toEqual({ adoptedAt: null, expectedSavedAt: null, conflict: null });
  });

  it("should stay quiet when a discard lands on a tab showing the generated text", () => {
    const state = reconcileSpecDraft({
      draft: null,
      generated,
      markdown: generated,
      base: generated,
      adoptedAt: 10,
    });

    expect(state.conflict).toBeNull();
  });
});
