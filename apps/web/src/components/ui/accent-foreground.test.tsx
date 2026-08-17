import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { StatusBadge } from "./status-badge";
import { StepProgress } from "./step-progress";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("accent foreground", () => {
  it("should use a contrast-safe semantic foreground in both themes and accent consumers", () => {
    const lightPalette = declarationsIn(blockAfter(css, ':root[data-theme="light"]'));
    const darkPalette = declarationsIn(blockAfter(css, ':root[data-theme="dark"]'));
    const button = renderToStaticMarkup(<Button variant="primary">Salvar</Button>);
    const progress = renderToStaticMarkup(
      <StepProgress
        steps={[{ id: "investigar", label: "Investigar" }, { id: "refinar", label: "Refinar" }]}
        progress={{ kind: "active", step: "refinar" }}
      />,
    );

    expect({
      lightForeground: lightPalette["--accent-foreground"],
      darkForeground: darkPalette["--accent-foreground"],
      primaryButton: button.includes("text-accent-foreground"),
      progressMarkers: progress.includes("bg-accent text-accent-foreground"),
    }).toEqual({
      lightForeground: "#FFFFFF",
      darkForeground: "#111110",
      primaryButton: true,
      progressMarkers: true,
    });
  });

  it("should bind status badge text to explicit-theme semantic colors", () => {
    const lightPalette = declarationsIn(blockAfter(css, ':root[data-theme="light"]'));
    const darkPalette = declarationsIn(blockAfter(css, ':root[data-theme="dark"]'));
    const warning = renderToStaticMarkup(<StatusBadge tone="warning">Investigada</StatusBadge>);
    const success = renderToStaticMarkup(<StatusBadge tone="success">Refinada</StatusBadge>);

    expect({
      lightInvestigated: lightPalette["--investigated"],
      darkInvestigated: darkPalette["--investigated"],
      lightRefined: lightPalette["--refined"],
      darkRefined: darkPalette["--refined"],
      warningUsesSemanticColor: warning.includes("text-investigated"),
      successUsesSemanticColor: success.includes("text-refined"),
      statusColorsIgnoreOsDarkVariant: !warning.includes("dark:") && !success.includes("dark:"),
    }).toEqual({
      lightInvestigated: "#8A5A00",
      darkInvestigated: "#E5B55E",
      lightRefined: "#177245",
      darkRefined: "#79D09D",
      warningUsesSemanticColor: true,
      successUsesSemanticColor: true,
      statusColorsIgnoreOsDarkVariant: true,
    });
  });
});

function blockAfter(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) throw new Error(`CSS marker not found: ${marker}`);

  const openingBrace = source.indexOf("{", markerIndex + marker.length);
  if (openingBrace === -1) throw new Error(`CSS block not found after marker: ${marker}`);

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
        if (separator === -1) throw new Error(`Invalid CSS declaration: ${declaration}`);

        return [
          declaration.slice(0, separator).trim(),
          declaration.slice(separator + 1).trim(),
        ];
      }),
  );
}
