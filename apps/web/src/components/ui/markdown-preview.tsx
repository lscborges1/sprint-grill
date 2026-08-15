import MarkdownIt from "markdown-it";

const STRUCTURAL_COMMENT = /^<!-- sprint-griller:[A-Za-z0-9:._-]+ -->[\t ]*$/gm;
const previewMarkdown = new MarkdownIt({ html: false, linkify: false });

previewMarkdown.validateLink = () => true;
previewMarkdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index];
  const href = token?.attrGet("href");
  if (token !== undefined && href !== null && href !== undefined && isWebUrl(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noreferrer");
    return renderer.renderToken(tokens, index, options);
  }

  const closing = tokens.slice(index + 1).find((candidate) => candidate.type === "link_close");
  if (closing !== undefined) closing.hidden = true;
  return "";
};

previewMarkdown.renderer.rules.image = (tokens, index, options, env, renderer) =>
  previewMarkdown.utils.escapeHtml(
    renderer.renderInlineAsText(tokens[index]?.children ?? [], options, env),
  );

export function MarkdownPreview({ markdown }: { readonly markdown: string }) {
  const html = previewMarkdown.render(markdown.replace(STRUCTURAL_COMMENT, ""));
  return (
    <div
      className="flex flex-col gap-4 text-sm leading-7"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function isWebUrl(candidate: string): boolean {
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
