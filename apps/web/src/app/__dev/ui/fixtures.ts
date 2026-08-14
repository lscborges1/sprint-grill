import { z } from "zod";

export const UI_VIEWS = ["picker", "investigacao", "palco", "dossie"] as const;
export const UI_STATES = ["default", "empty", "error", "loading"] as const;

export const uiQuerySchema = z.object({
  view: z.enum(UI_VIEWS).default("picker"),
  state: z.enum(UI_STATES).default("default"),
}).strict();

export type UiQuery = z.infer<typeof uiQuerySchema>;
export type UiView = (typeof UI_VIEWS)[number];
export type UiState = (typeof UI_STATES)[number];

export const UI_FIXTURES = {
  picker: { title: "Picker", description: "US da sprint atual" },
  investigacao: { title: "Investigação", description: "Processar, revisar e publicar" },
  palco: { title: "Palco", description: "Ação atual da sala" },
  dossie: { title: "Dossiê", description: "Documento e gates" },
} as const satisfies Record<UiView, { readonly title: string; readonly description: string }>;

export function parseUiQuery(input: unknown): UiQuery {
  const result = uiQuerySchema.safeParse(input);
  if (!result.success) throw new Error("Fixture de UI inválida.");
  return result.data;
}
