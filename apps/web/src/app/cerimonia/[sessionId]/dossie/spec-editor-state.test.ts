import { describe, expect, it } from "vitest";
import {
  dumpGateResetKey,
  isDumpGateBlocked,
  isSpecStale,
  reconcileSpecDraft,
  resolveRegeneration,
  synchronizePristineGeneratedDocument,
} from "./spec-editor-state";

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
      pendingSavedAt: null,
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
      pendingSavedAt: null,
    });

    // A outra aba regenerou: o rascunho gravado sumiu, o texto daqui continua.
    const state = reconcileSpecDraft({
      draft: null,
      generated,
      markdown: edited,
      base: generated,
      adoptedAt: saved.adoptedAt,
      pendingSavedAt: null,
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
      pendingSavedAt: null,
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
      pendingSavedAt: null,
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
      pendingSavedAt: null,
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
      pendingSavedAt: null,
    });

    expect(state.conflict).toBeNull();
  });

  it("should use the accepted revision when the save echo has not arrived", () => {
    const state = reconcileSpecDraft({
      draft: null,
      generated,
      markdown: edited,
      base: generated,
      adoptedAt: null,
      pendingSavedAt: 10,
    });

    expect(state).toEqual({ adoptedAt: 10, expectedSavedAt: 10, conflict: null });
  });
});

describe("synchronizePristineGeneratedDocument", () => {
  it("should adopt a new generated document while the editor is pristine and draft-free", () => {
    const updated = synchronizePristineGeneratedDocument({
      draft: null,
      generated: "# Spec da US #4242\n\nDecisão nova",
      markdown: generated,
      base: generated,
      hasLocalChanges: false,
    });

    expect(updated).toEqual({
      markdown: "# Spec da US #4242\n\nDecisão nova",
      base: "# Spec da US #4242\n\nDecisão nova",
    });
  });

  it("should preserve the editor when the Operator has edited it", () => {
    const input = {
      generated: "# Spec da US #4242\n\nDecisão nova",
      markdown: edited,
      base: generated,
    };

    expect(
      synchronizePristineGeneratedDocument({ ...input, draft: null, hasLocalChanges: true }),
    ).toBeNull();
  });

  it("should preserve the editor when a draft has been saved", () => {
    const input = {
      generated: "# Spec da US #4242\n\nDecisão nova",
      markdown: edited,
      base: generated,
    };

    expect(
      synchronizePristineGeneratedDocument({
        ...input,
        draft: { markdown: edited, base: generated, savedAt: 10 },
        hasLocalChanges: false,
      }),
    ).toBeNull();
  });
});

describe("resolveRegeneration", () => {
  const pending = {
    requestId: "discard-1",
    markdown: edited,
    base: generated,
    hasLocalChanges: true,
    adoptedAt: 10,
  } as const;

  it("should adopt the generated document only after this discard succeeds", () => {
    expect(resolveRegeneration(pending, { status: "success", requestId: "discard-1" }, "novo")).toEqual({
      status: "success",
      document: { markdown: "novo", base: "novo", hasLocalChanges: false, adoptedAt: 10 },
    });
  });

  it("should retain the complete local edit when the discard loses its CAS race", () => {
    expect(
      resolveRegeneration(pending, {
        status: "error",
        requestId: "discard-1",
        message: "o rascunho está desatualizado",
      }, "novo"),
    ).toEqual({ status: "error", document: pending });
  });

  it("should ignore a result from an earlier regeneration attempt", () => {
    expect(resolveRegeneration(pending, { status: "success", requestId: "discard-0" }, "novo")).toBeNull();
  });
});

describe("isSpecStale", () => {
  it("should keep a saved draft dumpable when only decision-record links arrived", () => {
    const base = "# Spec\n\n- **Pergunta** — Sim\n";
    const generatedWithRecord = `${base}  - Registro no Azure DevOps: [#91](https://dev.azure.com/acme/Plataforma/_workitems/edit/1)\n`;

    expect(isSpecStale(generatedWithRecord, base)).toBe(false);
  });

  it("should flag a later decision as stale", () => {
    expect(isSpecStale("# Spec\n\n- Decisão nova", "# Spec")).toBe(true);
  });
});

describe("dumpGateResetKey", () => {
  it("should reset the task editor when unchanged inputs become frozen", () => {
    const tasksMarkdown = "## Implementar retry\n\n### Critérios de aceite\n\n- Reutiliza as Tasks assinadas.";

    expect(dumpGateResetKey(tasksMarkdown, false)).not.toBe(
      dumpGateResetKey(tasksMarkdown, true),
    );
  });
});

describe("isDumpGateBlocked", () => {
  it("should allow a frozen partial-dump retry despite stale and conflicting editor state", () => {
    expect(
      isDumpGateBlocked({
        busy: false,
        conflict: "edicao",
        stale: true,
        dumpLocked: true,
      }),
    ).toBe(false);
  });

  it("should block a frozen retry while another editor action is busy", () => {
    expect(
      isDumpGateBlocked({ busy: true, conflict: null, stale: false, dumpLocked: true }),
    ).toBe(true);
  });

  it("should block an unfrozen dump when the Spec is stale", () => {
    expect(
      isDumpGateBlocked({ busy: false, conflict: null, stale: true, dumpLocked: false }),
    ).toBe(true);
  });

  it("should block an unfrozen dump when the editor has a conflict", () => {
    expect(
      isDumpGateBlocked({
        busy: false,
        conflict: "descarte",
        stale: false,
        dumpLocked: false,
      }),
    ).toBe(true);
  });
});
