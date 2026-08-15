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
      className="markdown-preview flex flex-col gap-4 text-sm leading-7 [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:tracking-tight [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:tracking-tight [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ul_ul]:mt-2 [&_ul_ul]:list-[circle] [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-foreground/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-[var(--radius-md)] [&_pre]:bg-foreground/5 [&_pre]:p-4 [&_pre_code]:whitespace-pre"
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
