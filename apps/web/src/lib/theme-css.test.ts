import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("theme CSS contract", () => {
  it("should define the light palette for the explicit light preference", () => {
    const lightPalette = declarationsIn(
      blockAfter(css, ':root[data-theme="light"]'),
    );

    expect(lightPalette).toMatchObject({
      "color-scheme": "light",
      "--background": "#ffffff",
      "--foreground": "#171717",
    });
  });

  it("should delegate the system dark palette to the system media query", () => {
    const darkMedia = blockAfter(css, "@media (prefers-color-scheme: dark)");
    const systemPalette = declarationsIn(
      blockAfter(darkMedia, ':root[data-theme="system"]'),
    );

    expect(systemPalette).toMatchObject({
      "color-scheme": "dark",
      "--background": "#0a0a0a",
      "--foreground": "#ededed",
    });
  });
});

function blockAfter(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) throw new Error(`CSS marker not found: ${marker}`);

  const openingBrace = source.indexOf("{", markerIndex + marker.length);
  if (openingBrace === -1) {
    throw new Error(`CSS block not found after marker: ${marker}`);
  }

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character !== "}") continue;

    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block after marker: ${marker}`);
}

function declarationsIn(block: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    block
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration !== "")
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        if (separator === -1) {
          throw new Error(`Invalid CSS declaration: ${declaration}`);
        }

        return [
          declaration.slice(0, separator).trim(),
          declaration.slice(separator + 1).trim(),
        ];
      }),
  );
}
