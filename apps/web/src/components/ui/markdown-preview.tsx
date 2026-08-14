import type { ElementType, ReactNode } from "react";

type Block =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "paragraph"; readonly lines: readonly string[] }
  | { readonly kind: "list"; readonly items: readonly string[] };

export function MarkdownPreview({ markdown }: { readonly markdown: string }) {
  return (
    <div className="flex flex-col gap-4 text-sm leading-7">
      {parseBlocks(markdown).map((block, index) => {
        if (block.kind === "heading") {
          const Heading = `h${block.level}` as ElementType<{ className?: string }>;
          return <Heading key={`${block.kind}-${index}`} className="font-serif text-xl leading-tight tracking-tight">{renderInline(block.text)}</Heading>;
        }
        if (block.kind === "list") {
          return <ul key={`${block.kind}-${index}`} className="list-disc space-y-1 pl-5">{block.items.map((item) => <li key={item}>{renderInline(item)}</li>)}</ul>;
        }
        return <p key={`${block.kind}-${index}`}>{block.lines.map((line, lineIndex) => <span key={`${line}-${lineIndex}`}>{lineIndex > 0 && <br />}{renderInline(line)}</span>)}</p>;
      })}
    </div>
  );
}

export function parseBlocks(markdown: string): readonly Block[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length > 0) blocks.push({ kind: "list", items: list });
    list = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const hashes = heading[1] ?? "";
      const headingText = heading[2] ?? "";
      blocks.push({ kind: "heading", level: hashes.length, text: headingText });
    } else if (item) {
      flushParagraph();
      list.push(item[1] ?? "");
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }

  flushParagraph();
  flushList();
  return blocks;
}

const INLINE_TOKEN = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    if (token === undefined) continue;
    const start = match.index ?? cursor;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      if (link) nodes.push(<a key={`${start}-${token}`} href={link[2]} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{link[1]}</a>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`${start}-${token}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={`${start}-${token}`} className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[0.9em]">{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<em key={`${start}-${token}`}>{token.slice(1, -1)}</em>);
    }
    cursor = start + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
