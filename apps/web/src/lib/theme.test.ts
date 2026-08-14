import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  THEME_INITIALIZATION_SCRIPT,
  readThemePreference,
  setThemePreference,
} from "./theme";

describe("readThemePreference", () => {
  it.each(["light", "dark", "system"] as const)(
    "should return %s when it is the stored preference",
    (preference) => {
      const storage = { getItem: () => preference };

      expect(readThemePreference(storage)).toBe(preference);
    },
  );

  it.each([null, "sepia"])(
    "should use system when the stored preference is %s",
    (stored) => {
      const storage = { getItem: () => stored };

      expect(readThemePreference(storage)).toBe("system");
    },
  );

  it("should use system when storage cannot be read", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(readThemePreference(storage)).toBe("system");
  });
});

describe("setThemePreference", () => {
  it.each(["light", "dark", "system"] as const)(
    "should apply and persist %s when it is selected",
    (preference) => {
      const root = { dataset: {} as DOMStringMap };
      const storage = { setItem: vi.fn() };

      setThemePreference(root, storage, preference);

      expect(root.dataset.theme).toBe(preference);
      expect(storage.setItem).toHaveBeenCalledWith(
        "sprint-griller:theme",
        preference,
      );
    },
  );

  it("should keep the selected preference applied when storage cannot be written", () => {
    const root = { dataset: {} as DOMStringMap };
    const storage = {
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    setThemePreference(root, storage, "light");

    expect(root.dataset.theme).toBe("light");
  });
});

describe("THEME_INITIALIZATION_SCRIPT", () => {
  it("should apply the stored preference before the app renders", () => {
    const root = { dataset: {} as DOMStringMap };
    const storage = { getItem: () => "dark" };

    runInNewContext(THEME_INITIALIZATION_SCRIPT, {
      document: { documentElement: root },
      localStorage: storage,
    });

    expect(root.dataset.theme).toBe("dark");
  });

  it.each([null, "sepia"])(
    "should apply system before render when the stored preference is %s",
    (stored) => {
      const root = { dataset: {} as DOMStringMap };

      runInNewContext(THEME_INITIALIZATION_SCRIPT, {
        document: { documentElement: root },
        localStorage: { getItem: () => stored },
      });

      expect(root.dataset.theme).toBe("system");
    },
  );

  it("should apply system before render when storage cannot be read", () => {
    const root = { dataset: {} as DOMStringMap };

    runInNewContext(THEME_INITIALIZATION_SCRIPT, {
      document: { documentElement: root },
      localStorage: {
        getItem: () => {
          throw new Error("storage unavailable");
        },
      },
    });

    expect(root.dataset.theme).toBe("system");
  });
});
