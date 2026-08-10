import type { SpecDraft } from "@sprint-griller/ceremony";

export interface SpecEditorInput {
  /** O rascunho gravado, como o SSE acabou de entregá-lo. */
  readonly draft: SpecDraft | null;
  /** O Markdown gerado do que a cerimônia gravou até agora. */
  readonly generated: string;
  readonly markdown: string;
  readonly base: string;
  /** A revisão que esta aba já tinha incorporado (`null` = o gerado). */
  readonly adoptedAt: number | null;
}

export interface SpecEditorState {
  /** A revisão incorporada depois de aplicar o eco — o novo `adoptedAt` da aba. */
  readonly adoptedAt: number | null;
  /** A revisão que o save vai exigir do banco; `null` na primeira gravação. */
  readonly expectedSavedAt: number | null;
  readonly conflict: "edicao" | "descarte" | null;
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
}: SpecEditorInput): SpecEditorState {
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
