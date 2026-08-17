"use client";

import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import type { ThemePreference } from "../lib/theme";
import {
  parseThemePreference,
  readThemePreference,
  setThemePreference,
  THEME_PREFERENCES,
} from "../lib/theme";

const THEME_OPTIONS = {
  light: { label: "Claro" },
  dark: { label: "Escuro" },
  system: { label: "Sistema" },
} as const satisfies Record<ThemePreference, { readonly label: string }>;

export function ThemeSelector(): ReactElement {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const controlLabel = `Tema: ${THEME_OPTIONS[preference].label}`;

  useEffect(() => {
    const storedPreference = readThemePreference(getBrowserStorage());
    document.documentElement.dataset.theme = storedPreference;

    // A preferência do navegador só existe após a hidratação; não há estado do servidor para derivá-la.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreference(storedPreference);
  }, []);

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextPreference = parseThemePreference(event.currentTarget.value);
    setPreference(nextPreference);
    setThemePreference(
      document.documentElement,
      getBrowserStorage(),
      nextPreference,
    );
  }

  return (
    <div className="relative h-10 w-10">
      <select
        id="theme-preference"
        aria-label={controlLabel}
        title={controlLabel}
        value={preference}
        onChange={handleChange}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      >
        {THEME_PREFERENCES.map((option) => (
          <option key={option} value={option}>
            {THEME_OPTIONS[option].label}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none flex h-full w-full items-center justify-center rounded-full border border-line bg-surface text-muted shadow-sm peer-hover:bg-foreground/5 peer-hover:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
      >
        <ThemeIcon preference={preference} />
      </span>
    </div>
  );
}

function ThemeIcon({
  preference,
}: {
  readonly preference: ThemePreference;
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {preference === "light" && (
        <>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </>
      )}
      {preference === "dark" && (
        <path d="M20.3 15.4A8.5 8.5 0 0 1 8.6 3.7 8.5 8.5 0 1 0 20.3 15.4Z" />
      )}
      {preference === "system" && (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </>
      )}
    </svg>
  );
}

function getBrowserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
