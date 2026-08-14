import { z } from "zod";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export const THEME_STORAGE_KEY = "sprint-griller:theme";

const themePreferenceSchema = z.enum(THEME_PREFERENCES);

export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export const THEME_INITIALIZATION_SCRIPT = `(() => {
  const preferences = ${JSON.stringify(THEME_PREFERENCES)};
  let preference = "system";
  try {
    const stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (preferences.includes(stored)) preference = stored;
  } catch {
    preference = "system";
  }
  document.documentElement.dataset.theme = preference;
})();`;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;
type ThemeRoot = Pick<HTMLElement, "dataset">;

export function parseThemePreference(value: unknown): ThemePreference {
  return themePreferenceSchema.parse(value);
}

export function readThemePreference(
  storage: ReadableStorage | undefined,
): ThemePreference {
  try {
    const parsed = themePreferenceSchema.safeParse(
      storage?.getItem(THEME_STORAGE_KEY),
    );
    return parsed.success ? parsed.data : "system";
  } catch {
    return "system";
  }
}

export function setThemePreference(
  root: ThemeRoot,
  storage: WritableStorage | undefined,
  preference: ThemePreference,
): void {
  root.dataset.theme = preference;

  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    return;
  }
}
