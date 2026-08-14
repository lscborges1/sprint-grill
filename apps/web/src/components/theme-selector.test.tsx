import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeSelector } from "./theme-selector";

describe("ThemeSelector", () => {
  it("should render a labeled native selector with every theme preference", () => {
    const html = renderToStaticMarkup(<ThemeSelector />);

    expect(html).toContain('for="theme-preference"');
    expect(html).toContain('id="theme-preference"');
    expect(html).toContain('<option value="light">Claro</option>');
    expect(html).toContain('<option value="dark">Escuro</option>');
    expect(html).toContain(
      '<option value="system" selected="">Sistema</option>',
    );
  });
});
