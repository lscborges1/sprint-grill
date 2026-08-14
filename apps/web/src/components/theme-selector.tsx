"use client";

import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useRef } from "react";
import type { ThemePreference } from "../lib/theme";
import {
  parseThemePreference,
  readThemePreference,
  setThemePreference,
} from "../lib/theme";

const THEME_OPTIONS = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
] as const satisfies readonly {
  readonly value: ThemePreference;
  readonly label: string;
}[];

export function ThemeSelector(): ReactElement {
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const preference = readThemePreference(getBrowserStorage());
    document.documentElement.dataset.theme = preference;

    if (selectRef.current) selectRef.current.value = preference;
  }, []);

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const preference = parseThemePreference(event.currentTarget.value);
    setThemePreference(
      document.documentElement,
      getBrowserStorage(),
      preference,
    );
  }

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2 rounded-xl border border-line bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
      <label
        className="text-xs font-medium uppercase tracking-[0.14em] text-muted"
        htmlFor="theme-preference"
      >
        Tema
      </label>
      <select
        ref={selectRef}
        id="theme-preference"
        defaultValue="system"
        onChange={handleChange}
        className="rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {THEME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function getBrowserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
