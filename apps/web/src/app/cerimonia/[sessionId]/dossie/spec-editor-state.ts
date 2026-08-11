import type { SpecDraft } from "@sprint-griller/ceremony";
import type { DiscardSpecDraftActionState } from "../../spec-draft-action-state";

export interface SpecEditorInput {
  /** O rascunho gravado, como o SSE acabou de entregá-lo. */
  readonly draft: SpecDraft | null;
  /** O Markdown gerado do que a cerimônia gravou até agora. */
  readonly generated: string;
  readonly markdown: string;
  readonly base: string;
  /** A revisão que esta aba já tinha incorporado (`null` = o gerado). */
  readonly adoptedAt: number | null;
  /** Save desta aba que o servidor aceitou, mas o SSE ainda não refletiu. */
  readonly pendingSavedAt: number | null;
}

export interface SpecEditorState {
  /** A revisão incorporada depois de aplicar o eco — o novo `adoptedAt` da aba. */
  readonly adoptedAt: number | null;
  /** A revisão que o save vai exigir do banco; `null` na primeira gravação. */
  readonly expectedSavedAt: number | null;
  readonly conflict: "edicao" | "descarte" | null;
}

export interface EditorDocument {
  readonly markdown: string;
  readonly base: string;
  readonly hasLocalChanges: boolean;
  readonly adoptedAt: number | null;
}

export interface PendingRegeneration extends EditorDocument {
  readonly requestId: string;
}

export type RegenerationResolution =
  | { readonly status: "success"; readonly document: EditorDocument }
  | { readonly status: "error"; readonly document: PendingRegeneration };

/**
 * Só conclui a regeneração iniciada nesta aba. Um resultado anterior do action
 * state não pode confirmar (nem desfazer) uma nova tentativa.
 */
export function resolveRegeneration(
  pending: PendingRegeneration | null,
  result: DiscardSpecDraftActionState,
  generated: string,
): RegenerationResolution | null {
  if (pending === null || result.status === "idle" || result.requestId !== pending.requestId) {
    return null;
  }

  if (result.status === "error") return { status: "error", document: pending };

  return {
    status: "success",
    // O SSE ainda pode estar trazendo o rascunho que acabamos de descartar.
    // Preservar a revisão até ele chegar evita apresentar isso como conflito remoto.
    document: {
      markdown: generated,
      base: generated,
      hasLocalChanges: false,
      adoptedAt: pending.adoptedAt,
    },
  };
}

export interface PristineGeneratedDocumentInput {
  readonly draft: SpecDraft | null;
  readonly generated: string;
  readonly markdown: string;
  readonly base: string;
  /** O Operador já digitou nesta aba ou ela já adotou um rascunho. */
  readonly hasLocalChanges: boolean;
}

/**
 * Enquanto não há rascunho nem edição local, o editor é só uma vista do
 * documento vivo e deve acompanhar as decisões recebidas pelo SSE.
 */
export function synchronizePristineGeneratedDocument({
  draft,
  generated,
  markdown,
  base,
  hasLocalChanges,
}: PristineGeneratedDocumentInput): Pick<SpecEditorInput, "markdown" | "base"> | null {
  if (
    draft !== null ||
    hasLocalChanges ||
    (markdown === generated && base === generated)
  ) {
    return null;
  }

  return { markdown: generated, base: generated };
}

/**
 * Reconcilia o editor com o rascunho gravado que chega pelo SSE.
 *
 * O eco do próprio save volta com o mesmo texto, e é aí — não quando o Operador
 * digitar de novo — que a aba precisa incorporar a revisão nova. Sem isso, quem
 * salva e para de mexer fica sem revisão adotada, e um descarte vindo de outra
 * aba passaria batido: o save seguinte recriaria calado o texto apagado.
 *
 * Uma divergência remota nunca é incorporada sozinha: ela vira conflito e fica
 * na tela enquanto o Operador decide o que fazer.
 */
export function reconcileSpecDraft({
  draft,
  generated,
  markdown,
  base,
  adoptedAt,
  pendingSavedAt,
}: SpecEditorInput): SpecEditorState {
  if (pendingSavedAt !== null && (draft === null || draft.savedAt < pendingSavedAt)) {
    return { adoptedAt: pendingSavedAt, expectedSavedAt: pendingSavedAt, conflict: null };
  }

  if (draft === null) {
    return {
      adoptedAt,
      expectedSavedAt: null,
      // O rascunho gravado sumiu, mas esta aba ainda mostra o que editou.
      conflict: adoptedAt !== null && markdown !== generated ? "descarte" : null,
    };
  }

  const echo = draft.markdown === markdown && draft.base === base;
  const adopted = echo ? draft.savedAt : adoptedAt;

  return {
    adoptedAt: adopted,
    expectedSavedAt: adopted,
    conflict: draft.savedAt === adopted ? null : "edicao",
  };
}
