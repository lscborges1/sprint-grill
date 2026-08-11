"use client";

import type { DossieState } from "@sprint-griller/ceremony";
import { useActionState, useRef, useState } from "react";
import { discardSpecDraftAction, saveSpecDraftAction } from "../../actions";
import {
  DISCARD_SPEC_DRAFT_INITIAL_STATE,
  SAVE_SPEC_DRAFT_INITIAL_STATE,
} from "../../spec-draft-action-state";
import {
  reconcileSpecDraft,
  resolveRegeneration,
  synchronizePristineGeneratedDocument,
} from "./spec-editor-state";

export interface SpecEditorController {
  readonly markdown: string;
  readonly base: string;
  readonly busy: boolean;
  readonly conflict: "edicao" | "descarte" | null;
  readonly error: string | null;
  readonly expectedSavedAt: number | null;
  readonly remoteDraftConflict: boolean;
  readonly stale: boolean;
  readonly save: (formData: FormData) => void;
  readonly regenerate: (formData: FormData) => void;
  readonly adoptRemote: () => void;
  readonly updateMarkdown: (markdown: string) => void;
}

/**
 * Orquestra o estado CAS do rascunho. A tela só renderiza o documento e envia
 * as intenções do Operador; as transições puras ficam em `spec-editor-state`.
 */
export function useSpecEditor(spec: DossieState["spec"]): SpecEditorController {
  const [markdown, setMarkdown] = useState(spec.draft?.markdown ?? spec.generated);
  const [base, setBase] = useState(spec.draft?.base ?? spec.generated);
  const [hasLocalChanges, setHasLocalChanges] = useState(spec.draft !== null);
  /** `savedAt` do rascunho que esta aba já incorporou no editor (null = gerado). */
  const [adoptedAt, setAdoptedAt] = useState<number | null>(spec.draft?.savedAt ?? null);
  const [pendingRegeneration, setPendingRegeneration] = useState<
    Parameters<typeof resolveRegeneration>[0]
  >(null);
  const regenerationAttempt = useRef(0);
  const [handledSavedAt, setHandledSavedAt] = useState<number | null>(null);
  const [pendingSavedAt, setPendingSavedAt] = useState<number | null>(null);
  const [saveResult, save, saving] = useActionState(
    saveSpecDraftAction,
    SAVE_SPEC_DRAFT_INITIAL_STATE,
  );
  const [discardResult, discard, discarding] = useActionState(
    discardSpecDraftAction,
    DISCARD_SPEC_DRAFT_INITIAL_STATE,
  );
  const busy = saving || discarding;
  const regeneration = resolveRegeneration(pendingRegeneration, discardResult, spec.generated);
  if (regeneration !== null) {
    setMarkdown(regeneration.document.markdown);
    setBase(regeneration.document.base);
    setHasLocalChanges(regeneration.document.hasLocalChanges);
    setAdoptedAt(regeneration.document.adoptedAt);
    setPendingRegeneration(null);
  }
  const synchronizedDocument = synchronizePristineGeneratedDocument({
    draft: spec.draft,
    generated: spec.generated,
    markdown,
    base,
    hasLocalChanges,
  });
  if (synchronizedDocument !== null) {
    setMarkdown(synchronizedDocument.markdown);
    setBase(synchronizedDocument.base);
  }
  if (
    spec.draft === null &&
    !hasLocalChanges &&
    markdown === spec.generated &&
    base === spec.generated &&
    adoptedAt !== null
  ) {
    setAdoptedAt(null);
  }
  if (saveResult.status === "success" && handledSavedAt !== saveResult.savedAt) {
    // O POST é a fonte da revisão aceita. O SSE pode estar desconectado ou
    // atrasado, então o próximo save ainda precisa comparar com ela.
    setHandledSavedAt(saveResult.savedAt);
    setHasLocalChanges(true);
    setAdoptedAt(saveResult.savedAt);
    setPendingSavedAt(saveResult.savedAt);
  }
  const reconciled = reconcileSpecDraft({
    draft: spec.draft,
    generated: spec.generated,
    markdown,
    base,
    adoptedAt,
    pendingSavedAt,
  });
  // Ajustar o estado no render é o caminho do React para estado derivado de
  // prop: a revisão precisa ser incorporada quando o eco chega, não quando o
  // Operador voltar a digitar.
  if (reconciled.adoptedAt !== adoptedAt) setAdoptedAt(reconciled.adoptedAt);
  if (pendingSavedAt !== null && spec.draft !== null && spec.draft.savedAt >= pendingSavedAt) {
    setPendingSavedAt(null);
  }

  const { expectedSavedAt, conflict } = reconciled;
  const remoteDraftConflict = conflict === "edicao";

  function regenerate(formData: FormData): void {
    if (remoteDraftConflict || pendingRegeneration !== null) return;

    const requestId = `discard-${++regenerationAttempt.current}`;
    formData.set("requestId", requestId);
    setPendingRegeneration({ requestId, markdown, base, hasLocalChanges, adoptedAt });
    discard(formData);
  }

  function adoptRemote(): void {
    if (spec.draft) {
      setMarkdown(spec.draft.markdown);
      setBase(spec.draft.base);
      setHasLocalChanges(true);
      setAdoptedAt(spec.draft.savedAt);
      return;
    }
    setMarkdown(spec.generated);
    setBase(spec.generated);
    setHasLocalChanges(false);
    setAdoptedAt(null);
  }

  function updateMarkdown(nextMarkdown: string): void {
    setHasLocalChanges(true);
    setMarkdown(nextMarkdown);
  }

  return {
    markdown,
    base,
    busy,
    conflict,
    error:
      (saveResult.status === "error" ? saveResult.message : null) ??
      (discardResult.status === "error" ? discardResult.message : null),
    expectedSavedAt,
    remoteDraftConflict,
    stale: spec.generated !== base,
    save,
    regenerate,
    adoptRemote,
    updateMarkdown,
  };
}
