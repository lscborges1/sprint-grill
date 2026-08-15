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

  it("should render canonical markdown without exposing structural or active unsafe content", () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview
        markdown={`<!-- sprint-griller:report-section:impacts -->

> Relatório reprovado

- Impacto
  - \`core-api:src/cache.ts\`

\`\`\`ts
const ttl = 300;
\`\`\`

[Spec](https://example.com/spec)

[perigoso](javascript:alert(1))

![pixel](https://tracker.example/pixel.gif)

<em>HTML arbitrário</em>`}
      />,
    );

    expect({
      hidesStructuralComment: !html.includes("sprint-griller:report-section"),
      rendersBlockquote: html.includes("<blockquote>"),
      rendersNestedList: (html.match(/<ul>/g) ?? []).length === 2,
      rendersFence: html.includes('<code class="language-ts">'),
      securesExternalLink:
        html.includes('href="https://example.com/spec"') &&
        html.includes('target="_blank"') &&
        html.includes('rel="noreferrer"'),
      disablesUnsafeLink: html.includes("perigoso") && !html.includes("javascript:"),
      disablesImage: html.includes("pixel") && !html.includes("<img"),
      escapesArbitraryHtml: html.includes("&lt;em&gt;HTML arbitrário&lt;/em&gt;"),
    }).toEqual({
      hidesStructuralComment: true,
      rendersBlockquote: true,
      rendersNestedList: true,
      rendersFence: true,
      securesExternalLink: true,
      disablesUnsafeLink: true,
      disablesImage: true,
      escapesArbitraryHtml: true,
    });
  });

  it("should hide only canonical structural comments", () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview markdown={'<!-- sprint-griller:report-section:gaps -->\n\n<!-- comentário comum -->'} />,
    );

    expect(html).toContain("&lt;!-- comentário comum --&gt;");
    expect(html).not.toContain("sprint-griller:report-section:gaps");
  });
});
