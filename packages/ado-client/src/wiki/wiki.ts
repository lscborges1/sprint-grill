import markdownIt from "markdown-it";
import { z } from "zod";
import { AdoError } from "../ado-error";
import type { AdoErrorKind } from "../ado-error";
import { createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions } from "../rest/ado-rest";

export type WikiPageSelector =
  | { readonly kind: "id"; readonly id: number }
  | { readonly kind: "path"; readonly path: string };

export interface WikiPageTarget {
  readonly project: string;
  readonly wiki: string;
  readonly canonicalUrl: string;
  readonly page: WikiPageSelector;
}

export interface WikiContextLoaded {
  readonly status: "loaded";
  readonly target: WikiPageTarget;
  readonly depth: 0 | 1;
  readonly pageId: number;
  readonly pagePath: string;
  readonly content: string;
  readonly truncated: boolean;
}

export type WikiUnavailableReason = Exclude<AdoErrorKind, "conflict">;

export interface WikiContextUnavailable {
  readonly status: "unavailable";
  readonly target: WikiPageTarget;
  readonly depth: 0 | 1;
  readonly reason: WikiUnavailableReason;
  readonly message: string;
}

export type WikiContextReference = WikiContextLoaded | WikiContextUnavailable;

interface WikiContextOmissionTarget {
  readonly target: WikiPageTarget;
  readonly depth: 0 | 1;
}

export type WikiContextOmitted =
  | (WikiContextOmissionTarget & { readonly reason: "page-limit" })
  | (WikiContextOmissionTarget & { readonly reason: "content-limit" });

export interface WikiContext {
  readonly references: readonly WikiContextReference[];
  readonly omitted: readonly WikiContextOmitted[];
  readonly attempts: number;
  readonly contentCharacters: number;
}

const wikiPageSchema = z.object({
  id: z.number().int().positive(),
  path: z.string(),
  content: z.string(),
});

const WIKI_PREFIX = "_wiki/wikis";
const PAGE_ATTEMPT_LIMIT = 10;
const CONTENT_CHARACTER_LIMIT = 100_000;
const wikiMarkdown = markdownIt({ html: false, linkify: false });

interface QueuedTarget {
  readonly target: WikiPageTarget;
  readonly depth: 0 | 1;
}

export async function fetchWikiContext(
  options: AdoClientOptions,
  input: {
    readonly storyId: number;
    readonly description: string | undefined;
  },
): Promise<WikiContext> {
  const logger = options.logger ?? createAdoRest(options).logger;
  const restLogger = logger.child({}, { level: "silent" });
  const directTargets = extractWikiTargets(
    input.description ?? "",
    options.azureDevOps.organization,
  );
  const seenTargets = new Set<string>();
  const queue: QueuedTarget[] = [];
  enqueueTargets(queue, seenTargets, directTargets, 0);
  const references: WikiContextReference[] = [];
  const omitted: WikiContextOmitted[] = [];
  const resolvedPages = new Set<string>();
  let attempts = 0;
  let contentCharacters = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const queued = queue[index];
    if (queued === undefined) continue;
    const { target, depth } = queued;
    if (
      target.page.kind === "id" &&
      resolvedPages.has(resolvedPageKey(target, target.page.id))
    ) {
      continue;
    }
    if (attempts >= PAGE_ATTEMPT_LIMIT) {
      omitted.push({ target, depth, reason: "page-limit" });
      continue;
    }
    if (contentCharacters >= CONTENT_CHARACTER_LIMIT) {
      omitted.push({ target, depth, reason: "content-limit" });
      continue;
    }

    const rest = createAdoRest({
      ...options,
      azureDevOps: { ...options.azureDevOps, project: target.project },
      logger: restLogger,
    });
    attempts += 1;
    let page: z.infer<typeof wikiPageSchema>;
    try {
      page = await rest.request({
        operation: "a página da Wiki vinculada à US",
        path:
          target.page.kind === "id"
            ? `_apis/wiki/wikis/${encodeURIComponent(target.wiki)}/pages/${target.page.id}`
            : `_apis/wiki/wikis/${encodeURIComponent(target.wiki)}/pages`,
        query: {
          includeContent: "true",
          ...(target.page.kind === "path" ? { path: target.page.path } : {}),
        },
        schema: wikiPageSchema,
        requiredPatScope: "Wiki (read)",
        notFound: `O Azure DevOps não encontrou a página ${target.canonicalUrl}. Confira o link na US #${input.storyId}.`,
      });
    } catch (error) {
      const reason = recoverableReason(error);
      if (reason === undefined || !(error instanceof AdoError)) throw error;
      references.push({
        status: "unavailable",
        target,
        depth,
        reason,
        message: error.message,
      });
      logger.warn(
        {
          storyId: input.storyId,
          target: targetWithoutQuery(target),
          depth,
          reason,
        },
        "página da Wiki vinculada à US indisponível",
      );
      continue;
    }

    const resolvedKey = resolvedPageKey(target, page.id);
    if (resolvedPages.has(resolvedKey)) continue;
    resolvedPages.add(resolvedKey);

    const remainingCharacters = CONTENT_CHARACTER_LIMIT - contentCharacters;
    const content = page.content.slice(0, remainingCharacters);
    const truncated = content.length < page.content.length;
    references.push({
      status: "loaded",
      target,
      depth,
      pageId: page.id,
      pagePath: page.path,
      content,
      truncated,
    });
    contentCharacters += content.length;

    if (depth === 0) {
      enqueueTargets(
        queue,
        seenTargets,
        extractMarkdownWikiTargets(
          content,
          options.azureDevOps.organization,
          target,
        ),
        1,
      );
    }
  }

  const context = {
    references,
    omitted,
    attempts,
    contentCharacters,
  } satisfies WikiContext;
  logger.info(
    {
      storyId: input.storyId,
      attempts,
      references: references.length,
      omitted: omitted.length,
      contentCharacters,
    },
    "contexto Wiki da US coletado",
  );
  return context;
}

function recoverableReason(error: unknown): WikiUnavailableReason | undefined {
  if (!(error instanceof AdoError) || error.kind === "conflict") return undefined;
  return error.kind;
}

function enqueueTargets(
  queue: QueuedTarget[],
  seenTargets: Set<string>,
  targets: readonly WikiPageTarget[],
  depth: 0 | 1,
): void {
  for (const target of targets) {
    const key = targetKey(target);
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    queue.push({ target, depth });
  }
}

function targetKey(target: WikiPageTarget): string {
  const wikiKey = `${target.project.toLowerCase()}\0${target.wiki.toLowerCase()}`;
  return target.page.kind === "id"
    ? `${wikiKey}\0id\0${target.page.id}`
    : `${wikiKey}\0path\0${target.page.path}`;
}

function resolvedPageKey(target: WikiPageTarget, pageId: number): string {
  return `${target.project.toLowerCase()}\0${target.wiki.toLowerCase()}\0${pageId}`;
}

function targetWithoutQuery(target: WikiPageTarget): string {
  const url = new URL(target.canonicalUrl);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function extractMarkdownWikiTargets(
  markdown: string,
  organization: string,
  parent: WikiPageTarget,
): readonly WikiPageTarget[] {
  const targets: WikiPageTarget[] = [];
  for (const block of wikiMarkdown.parse(markdown, {})) {
    for (const token of block.children ?? []) {
      if (token.type !== "link_open" || token.markup === "autolink") continue;
      const href = token.attrGet("href");
      if (href === null) continue;
      const decodedHref = decodeAmpersands(href);
      const target = decodedHref.startsWith("/")
        ? internalPathTarget(
            organization,
            parent.project,
            parent.wiki,
            decodedHref,
          )
        : parseWikiTarget(decodedHref, organization);
      if (target !== undefined) targets.push(target);
    }
  }
  return targets;
}

function extractWikiTargets(
  source: string,
  organization: string,
): readonly WikiPageTarget[] {
  const decoded = decodeAmpersands(source);
  const matches = decoded.matchAll(
    /href\s*=\s*(["'])(https:\/\/[^\s"'<>]+)\1|(https:\/\/[^\s"'<>]+)/giu,
  );
  return Array.from(matches).flatMap((match) => {
    const quotedHref = match[2];
    const raw = quotedHref ?? match[3];
    if (raw === undefined) return [];
    const candidate =
      quotedHref === undefined ? trimExternalClosingDelimiters(raw) : raw;
    const target = parseWikiTarget(candidate, organization);
    return target === undefined ? [] : [target];
  });
}

function parseWikiTarget(
  raw: string,
  organization: string,
): WikiPageTarget | undefined {
  if (!/^https:\/\/dev\.azure\.com\//iu.test(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "dev.azure.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return undefined;
  }

  const segments = url.pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments.some((segment) => segment === undefined)) return undefined;
  const [urlOrganization, project, wikiPrefix, wikisSegment, wiki, idSegment] = segments;
  if (
    urlOrganization?.toLowerCase() !== organization.toLowerCase() ||
    project === undefined ||
    wikiPrefix !== "_wiki" ||
    wikisSegment !== "wikis" ||
    wiki === undefined
  ) {
    return undefined;
  }

  const base = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/${WIKI_PREFIX}/${encodeURIComponent(wiki)}`;
  if (idSegment !== undefined && /^\d+$/.test(idSegment)) {
    const id = Number(idSegment);
    if (!Number.isSafeInteger(id) || id <= 0) return undefined;
    return {
      project,
      wiki,
      canonicalUrl: `${base}/${id}`,
      page: { kind: "id", id },
    };
  }

  const path = url.searchParams.get("pagePath");
  if (segments.length !== 5 || path === null) return undefined;
  return pathTarget(organization, project, wiki, path);
}

function pathTarget(
  organization: string,
  project: string,
  wiki: string,
  path: string,
): WikiPageTarget | undefined {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.toLowerCase().startsWith("/.attachments/")
  ) {
    return undefined;
  }
  const base = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/${WIKI_PREFIX}/${encodeURIComponent(wiki)}`;
  const canonical = new URL(base);
  canonical.searchParams.set("pagePath", path);
  return {
    project,
    wiki,
    canonicalUrl: canonical.toString(),
    page: { kind: "path", path },
  };
}

function internalPathTarget(
  organization: string,
  project: string,
  wiki: string,
  raw: string,
): WikiPageTarget | undefined {
  if (raw.startsWith("//")) return undefined;
  try {
    const url = new URL(raw, "https://wiki.internal");
    return pathTarget(
      organization,
      project,
      wiki,
      decodeURIComponent(url.pathname),
    );
  } catch {
    return undefined;
  }
}

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function decodeAmpersands(value: string): string {
  return value.replace(/&(?:amp|#0*38|#x0*26);/giu, "&");
}

function trimExternalClosingDelimiters(value: string): string {
  // Uma varredura para os balanços e uma para o sufixo: entrada não confiável
  // nunca transforma a extração de links numa operação quadrática.
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  for (const character of value) {
    switch (character) {
      case "(":
        parentheses += 1;
        break;
      case ")":
        parentheses -= 1;
        break;
      case "[":
        brackets += 1;
        break;
      case "]":
        brackets -= 1;
        break;
      case "{":
        braces += 1;
        break;
      case "}":
        braces -= 1;
        break;
    }
  }

  let end = value.length;
  while (end > 0) {
    switch (value[end - 1]) {
      case ")":
        if (parentheses >= 0) return value.slice(0, end);
        parentheses += 1;
        break;
      case "]":
        if (brackets >= 0) return value.slice(0, end);
        brackets += 1;
        break;
      case "}":
        if (braces >= 0) return value.slice(0, end);
        braces += 1;
        break;
      default:
        return value.slice(0, end);
    }
    end -= 1;
  }
  return "";
}
