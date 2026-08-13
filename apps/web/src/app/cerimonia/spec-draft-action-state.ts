/** Resultado do save que mantém a revisão CAS mesmo sem eco do SSE. */
export type SaveSpecDraftActionState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly savedAt: number }
  | { readonly status: "error"; readonly message: string };

export const SAVE_SPEC_DRAFT_INITIAL_STATE: SaveSpecDraftActionState = {
  status: "idle",
};

/** Resultado do descarte que o editor usa para concluir uma regeneração local. */
export type DiscardSpecDraftActionState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly requestId: string }
  | { readonly status: "error"; readonly requestId: string; readonly message: string };

export const DISCARD_SPEC_DRAFT_INITIAL_STATE: DiscardSpecDraftActionState = {
  status: "idle",
};

export type DumpActionState =
  | { readonly status: "idle" }
  | { readonly status: "success" }
  | { readonly status: "error"; readonly message: string };

export const DUMP_INITIAL_STATE = { status: "idle" } as const satisfies DumpActionState;
