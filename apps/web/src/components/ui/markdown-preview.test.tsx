import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./markdown-preview";

describe("MarkdownPreview", () => {
  it("should render the canonical markdown subset as semantic HTML", () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview
        markdown={'# Título\n\nParágrafo com **ênfase** e `código`.\n\n- Um item\n- Outro item\n\n[Spec](https://example.com/spec)'}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("<strong>ênfase</strong>");
    expect(html).toMatch(/<code[^>]*>código<\/code>/);
    expect(html).toMatch(/<ul[^>]*>/);
    expect(html).toContain('href="https://example.com/spec"');
  });

  it("should show HTML and unknown syntax as text instead of executing it", () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview markdown={'<script>alert("x")</script>\n\n:::unknown\n\n[bad](javascript:alert(1))'} />,
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain(":::unknown");
    expect(html).toContain("[bad](javascript:alert(1))");
  });
});
