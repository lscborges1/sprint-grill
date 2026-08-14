import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeSelector } from "./theme-selector";

describe("ThemeSelector", () => {
  it("should render the native selector as the only interactive control when server rendered", () => {
    const html = renderToStaticMarkup(<ThemeSelector />);

    expect(
      html.match(/<(?:a|button|input|select|textarea)\b/g) ?? [],
    ).toEqual(["<select"]);
  });

  it("should describe the current preference when the default is system", () => {
    const html = renderToStaticMarkup(<ThemeSelector />);

    expect(html).toMatch(
      /<select[^>]*id="theme-preference"[^>]*aria-label="Tema: Sistema"[^>]*title="Tema: Sistema"/,
    );
  });

  it("should offer every preference when system is selected initially", () => {
    const html = renderToStaticMarkup(<ThemeSelector />);

    expect(html.match(/<option[^>]*>[^<]+<\/option>/g)).toEqual([
      '<option value="light">Claro</option>',
      '<option value="dark">Escuro</option>',
      '<option value="system" selected="">Sistema</option>',
    ]);
  });

  it("should hide the decorative icon from assistive technology when rendered", () => {
    const html = renderToStaticMarkup(<ThemeSelector />);

    expect(html).toMatch(/<span[^>]*><svg aria-hidden="true"/);
  });
});
