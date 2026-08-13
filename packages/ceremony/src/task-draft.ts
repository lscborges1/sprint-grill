import { CeremonyError } from "./ceremony-error";
import type { TranscriptEntry } from "./types";

export const TASK_DRAFT_START = "<!-- sprint-griller:tasks:start -->";
export const TASK_DRAFT_END = "<!-- sprint-griller:tasks:end -->";

export function taskDraftTemplate(specUrl: string): string {
  return `## Título da Task

Explique o slice vertical que um agente consegue concluir em uma sessão.

[Spec da US](${specUrl})

### Critérios de aceite

- Critério observável que prova a entrega.

### Bloqueada por

- Título de outra Task deste preview (remova esta seção se não houver bloqueio).`;
}

export interface TaskDraft {
  readonly title: string;
  /** Corpo completo que o Operador assinou, sem o heading usado como título no ADO. */
  readonly bodyMarkdown: string;
  readonly acceptanceCriteria: readonly string[];
  readonly blockedBy: readonly string[];
}

export type TaskDraftValidation =
  | { readonly valid: true; readonly tasks: readonly TaskDraft[] }
  | { readonly valid: false; readonly errors: readonly string[] };

const ACCEPTANCE_HEADING = "### Critérios de aceite";
const BLOCKERS_HEADING = "### Bloqueada por";
const MARKDOWN_LINK = /\[([^\u005b\u005d\n]+)\]\(([^()\u005b\u005d\s]+)\)/g;

/**
 * Contrato pequeno do preview de tasks: cabe no Markdown assinado e dá ao gate
 * fatos mecânicos para checar antes de criar qualquer work item filho.
 */
export function parseTaskDraft(markdown: string, specUrl: string): readonly TaskDraft[] {
  const validation = validateTaskDraft(markdown, specUrl);
  if (!validation.valid) throw new CeremonyError(validation.errors.join("\n"));
  return validation.tasks;
}

/**
 * Validação que o browser e o despejo compartilham. O gate mostra todos os
 * problemas de uma vez; `parseTaskDraft` continua sendo a porta que impede a
 * escrita no ADO se alguém contornar a tela.
 */
export function validateTaskDraft(markdown: string, specUrl: string): TaskDraftValidation {
  const draft = trimBoundaryBlankLines(markdown);
  if (draft.trim() === "") {
    return { valid: false, errors: ["escreva ao menos uma Task agent-ready antes de despejar."] };
  }

  const firstTask = draft.search(/^## /m);
  if (firstTask === -1) {
    return { valid: false, errors: ["cada Task precisa começar com um título em ##."] };
  }

  const errors: string[] = [];
  if (firstTask > 0) {
    errors.push("não escreva texto antes da primeira Task (`## título`).");
  }

  const sections = draft
    .slice(firstTask)
    .split(/^## /m)
    .filter((section) => section.trim() !== "");
  const parsed = sections.map((section, index) => parseTask(section, specUrl, index + 1));
  errors.push(...parsed.flatMap((entry) => entry.errors));

  const tasks = parsed.flatMap((entry) => entry.task === undefined ? [] : [entry.task]);
  const titles = new Set<string>();
  for (const task of tasks) {
    if (titles.has(task.title)) {
      errors.push(`a Task "${task.title}" aparece mais de uma vez.`);
    }
    titles.add(task.title);
  }
  for (const task of tasks) {
    for (const blocker of task.blockedBy) {
      if (!titles.has(blocker)) {
        errors.push(`a Task "${task.title}" está bloqueada por "${blocker}", que não existe no preview.`);
      }
      if (blocker === task.title) {
        errors.push(`a Task "${task.title}" não pode bloquear a si mesma.`);
      }
    }
  }

  const blockersByTask = new Map(tasks.map((task) => [task.title, task.blockedBy]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const task of tasks) {
    assertAcyclic(task.title, blockersByTask, visiting, visited, [], errors);
  }

  const uniqueErrors = [...new Set(errors)];
  return uniqueErrors.length === 0 ? { valid: true, tasks } : { valid: false, errors: uniqueErrors };
}

/** O rascunho sai da mensagem final do agente, mas nunca substitui a assinatura humana. */
export function taskPreviewFromTranscript(
  transcript: readonly TranscriptEntry[],
  specUrl: string,
): string {
  const messages = transcript
    .filter((entry): entry is TranscriptEntry & { readonly event: Extract<TranscriptEntry["event"], { readonly kind: "mensagem" }> } =>
      entry.event.kind === "mensagem",
    )
    .map((entry) => entry.event.text)
    .reverse();

  for (const message of messages) {
    const start = message.indexOf(TASK_DRAFT_START);
    if (start === -1) continue;
    const end = message.indexOf(TASK_DRAFT_END, start + TASK_DRAFT_START.length);
    if (end === -1) continue;
    const draft = message.slice(start + TASK_DRAFT_START.length, end).trim();
    if (draft !== "") return draft;
  }

  return taskDraftTemplate(specUrl);
}

function parseTask(
  section: string,
  specUrl: string,
  taskNumber: number,
): { readonly task: TaskDraft | undefined; readonly errors: readonly string[] } {
  const [titleLine, ...bodyLines] = section.split("\n");
  const title = titleLine?.trim() ?? "";
  if (title === "") {
    return { task: undefined, errors: [`a Task ${taskNumber} precisa de um título depois de ##.`] };
  }

  const body = trimBoundaryBlankLines(bodyLines.join("\n"));
  const acceptance = sectionBody(body, ACCEPTANCE_HEADING);
  const errors: string[] = [];
  if (bodyBeforeFirstHeading(body) === "") {
    errors.push(`a Task "${title}" precisa descrever o slice vertical antes das seções estruturais.`);
  }
  if (acceptance === undefined) {
    errors.push(`a Task "${title}" não tem critérios de aceite (${ACCEPTANCE_HEADING}).`);
  }
  const acceptanceCriteria = listItems(acceptance ?? "");
  if (acceptance !== undefined && acceptanceCriteria.length === 0) {
    errors.push(`a Task "${title}" precisa de ao menos um critério de aceite.`);
  }
  const links = validateMarkdownLinks(body, title, errors);
  if (!links.includes(specUrl)) {
    errors.push(`a Task "${title}" precisa conter um link Markdown para a Spec atual (${specUrl}).`);
  }
  validateDiscussedContext(body, title, errors);

  const blockers = sectionBody(body, BLOCKERS_HEADING);
  return {
    task: {
      title,
      bodyMarkdown: body,
      acceptanceCriteria,
      blockedBy: blockers === undefined ? [] : listItems(blockers),
    },
    errors,
  };
}

function validateMarkdownLinks(markdown: string, title: string, errors: string[]): readonly string[] {
  const matches = [...markdown.matchAll(MARKDOWN_LINK)];
  const validOpenings = new Set(matches.flatMap((match) => {
    if (match.index === undefined) return [];
    return [match.index + match[0].indexOf("](")];
  }));
  const hasMalformedLink = [...markdown.matchAll(/\]\(/g)]
    .some((opening) => {
      if (opening.index === undefined || !validOpenings.has(opening.index)) return true;
      const lineStart = markdown.lastIndexOf("\n", opening.index) + 1;
      const prefix = markdown.slice(lineStart, opening.index);
      return [...prefix].filter((character) => character === "[").length
        - [...prefix].filter((character) => character === "]").length !== 1;
    });
  if (hasMalformedLink) {
    errors.push(`a Task "${title}" tem um link Markdown inválido.`);
  }

  return matches.flatMap((match) => {
    const target = match[2];
    if (target === undefined) return [];
    if (isHttpUrl(target)) return [target];
    errors.push(`a Task "${title}" tem um link Markdown inválido; use uma URL absoluta http(s).`);
    return [];
  });
}

/** Referência vaga só é aceita quando ela mesma aponta para o contexto decidido. */
function validateDiscussedContext(markdown: string, title: string, errors: string[]): void {
  for (const paragraph of contextualParagraphs(markdown)) {
    if (!/conforme discutido/i.test(paragraph)) continue;

    const hasLink = [...paragraph.matchAll(MARKDOWN_LINK)].some((match) => {
      const destination = match[2];
      return destination !== undefined && isHttpUrl(destination);
    });
    if (!hasLink) {
      errors.push(
        `a Task "${title}" usa "conforme discutido" sem um link Markdown no mesmo parágrafo.`,
      );
    }
  }
}

/** Itens de lista são parágrafos próprios: um link no vizinho não explica a referência vaga. */
function contextualParagraphs(markdown: string): readonly string[] {
  const paragraphs: string[] = [];
  let prose: string[] = [];
  let listItem: string[] = [];
  let quote: string[] = [];
  const flush = (lines: readonly string[]): void => {
    if (lines.length > 0) paragraphs.push(lines.join("\n"));
  };
  const flushProse = (): void => {
    flush(prose);
    prose = [];
  };
  const flushListItem = (): void => {
    flush(listItem);
    listItem = [];
  };
  const flushQuote = (): void => {
    if (quote.length > 0) paragraphs.push(...contextualParagraphs(quote.join("\n")));
    quote = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const blockquote = /^[ \t]*> ?(.*)$/.exec(line);
    if (blockquote) {
      flushProse();
      flushListItem();
      const content = blockquote[1] ?? "";
      if (content.trim() === "") flushQuote();
      else quote.push(content);
      continue;
    }

    flushQuote();
    if (line.trim() === "") {
      flushProse();
      flushListItem();
    } else if (/^[ \t]*[-*+]\s+/.test(line)) {
      flushProse();
      flushListItem();
      listItem = [line];
    } else if (listItem.length > 0 && /^[ \t]+/.test(line)) {
      listItem.push(line);
    } else {
      flushListItem();
      prose.push(line);
    }
  }

  flushProse();
  flushListItem();
  flushQuote();
  return paragraphs;
}

function isHttpUrl(destination: string): boolean {
  try {
    const url = new URL(destination);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sectionBody(markdown: string, heading: string): string | undefined {
  const start = markdown.indexOf(heading);
  if (start === -1) return undefined;

  const afterHeading = markdown.slice(start + heading.length).replace(/^\n+/, "");
  const nextHeading = afterHeading.search(/^### /m);
  return (nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading)).trim();
}

function bodyBeforeFirstHeading(markdown: string): string {
  const headingAt = markdown.search(/^### /m);
  return (headingAt === -1 ? markdown : markdown.slice(0, headingAt)).trim();
}

function listItems(markdown: string): readonly string[] {
  return markdown
    .split("\n")
    .map((line) => line.match(/^-\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => item !== undefined && item !== "");
}

function trimBoundaryBlankLines(markdown: string): string {
  return markdown
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/(?:\r?\n[ \t]*)+$/, "");
}

function assertAcyclic(
  title: string,
  blockersByTask: ReadonlyMap<string, readonly string[]>,
  visiting: Set<string>,
  visited: Set<string>,
  path: readonly string[],
  errors: string[],
): void {
  if (visited.has(title)) return;
  if (visiting.has(title)) {
    const cycleStart = path.indexOf(title);
    const cycle = [...path.slice(cycleStart), title].join(" → ");
    errors.push(`as Tasks têm uma dependência circular: ${cycle}.`);
    return;
  }

  visiting.add(title);
  const nextPath = [...path, title];
  for (const blocker of blockersByTask.get(title) ?? []) {
    assertAcyclic(blocker, blockersByTask, visiting, visited, nextPath, errors);
  }
  visiting.delete(title);
  visited.add(title);
}
