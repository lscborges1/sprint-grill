import { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";
import { CeremonyError } from "./ceremony-error";
import type { CeremonyDecision, DossieDocument } from "./types";

const DECISION_TRACEABILITY_HEADING = "Rastreabilidade de decisões";
const EMPTY_DECISION_TRACEABILITY = italic("Nenhuma decisão foi registrada.");

interface SpecSectionOccurrence {
  readonly heading: string;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

interface SpecSectionStart extends Omit<SpecSectionOccurrence, "bodyEnd"> {
  readonly headingStart: number;
}

interface DecisionTraceabilityMatch {
  readonly reviewedStart: number;
  readonly reviewedEnd: number;
}

interface DecisionTraceability {
  readonly appendix: SpecSectionOccurrence;
  readonly matches: readonly DecisionTraceabilityMatch[];
}

/**
 * A Spec da US em Markdown: o artefato de dupla audiência (humano + agente) que
 * o despejo grava na própria US. Renderizada por código, não pelo modelo
 * ([ADR 0002](../../../docs/adr/0002-escrita-no-ado-e-deterministica.md)) — a
 * estrutura das seções é garantia, não estilo.
 *
 * Todas as seções aparecem sempre, mesmo vazias: "nenhuma pendência" é
 * informação, e seção que some vira dúvida sobre o que a cerimônia fez.
 *
 * O `SPEC_MARKER` não entra aqui: quem grava é o `ado-client`, e é ele que
 * carimba o artefato — do mesmo jeito que na Investigação.
 */
export function renderSpecMarkdown(document: DossieDocument, timeZone = "UTC"): string {
  const { story, decisions, pending, investigation } = document;

  const blocks = [
    `# Spec da US #${story.id} — ${story.title}`,
    italic(SPEC_BLURB),
    `[Abrir a US no Azure DevOps](${story.url})`,

    `## ${SPEC_SECTIONS.decisions.heading}`,
    SPEC_SECTIONS.decisions.blurb,
    list(decisions, (decision) => decisionEntry(decision, timeZone)) ??
      italic(SPEC_SECTIONS.decisions.empty),

    `## ${SPEC_SECTIONS.impact.heading}`,
    SPEC_SECTIONS.impact.blurb,
    investigation.impact.trim() || italic(SPEC_SECTIONS.impact.empty),

    `## ${SPEC_SECTIONS.unverified.heading}`,
    SPEC_SECTIONS.unverified.blurb,
    investigation.unverified.trim() || italic(SPEC_SECTIONS.unverified.empty),

    `## ${SPEC_SECTIONS.pending.heading}`,
    SPEC_SECTIONS.pending.blurb,
    list(pending, (question) => `- ${question.question}`) ?? italic(SPEC_SECTIONS.pending.empty),

    `## ${SPEC_SECTIONS.outOfScope.heading}`,
    SPEC_SECTIONS.outOfScope.blurb,
    italic(SPEC_SECTIONS.outOfScope.empty),

    `## ${DECISION_TRACEABILITY_HEADING}`,
    list(decisions, traceabilityEntry) ?? EMPTY_DECISION_TRACEABILITY,
  ];

  return `${blocks.join("\n\n")}\n`;
}

/**
 * A edição é livre dentro e fora das seções, mas não pode apagar o contrato da
 * Spec. A mesma asserção protege o save e a última fronteira antes do despejo.
 */
export function assertValidSpecMarkdown(
  markdown: string,
  decisions?: readonly CeremonyDecision[],
): void {
  const requiredHeadings = [
    ...Object.values(SPEC_SECTIONS).map((section) => section.heading),
    DECISION_TRACEABILITY_HEADING,
  ];
  const occurrences = findCanonicalSections(markdown, requiredHeadings);
  const errors = requiredHeadings.flatMap((heading) => {
    const matching = occurrences.filter((section) => section.heading === heading);
    if (matching.length === 0) return [`${heading}: seção ausente.`];
    if (matching.length > 1) return [`${heading}: seção aparece mais de uma vez.`];

    const section = matching[0];
    return section !== undefined && markdown.slice(section.bodyStart, section.bodyEnd).trim() === ""
      ? [`${heading}: seção vazia.`]
      : [];
  });

  if (errors.length > 0) {
    throw new CeremonyError(
      `a Spec da US precisa preservar as seções obrigatórias:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  findDecisionTraceability(markdown, decisions ?? [], decisions !== undefined);
}

/**
 * Lê uma seção do Markdown persistido do Operador. O editor é livre, mas as
 * seções emitidas pelo renderer continuam sendo os delimitadores canônicos.
 */
export function readSpecSection(markdown: string, heading: string): string {
  const opening = `## ${heading}\n`;
  const startsAtDocument = markdown.startsWith(opening);
  const start = startsAtDocument ? 0 : markdown.indexOf(`\n${opening}`);
  if (start === -1) return "";

  const body = markdown.slice(start + opening.length + (startsAtDocument ? 0 : 1));
  const canonicalHeadings: readonly string[] = [
    ...Object.values(SPEC_SECTIONS).map((section) => section.heading),
    DECISION_TRACEABILITY_HEADING,
  ];
  const end = canonicalHeadings
    .filter((candidate) => candidate !== heading)
    .map((candidate) => body.indexOf(`\n## ${candidate}\n`))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  return (end === undefined ? body : body.slice(0, end)).trim();
}

/**
 * Uma decisão como ela precisa circular: o que a sala respondeu, o que o agente
 * tinha recomendado, e a assinatura — quem decidiu e quando. Sem a assinatura
 * isto vira ata anônima, que é exatamente o que o Registro de decisão substitui.
 */
function decisionEntry(decision: CeremonyDecision, timeZone: string): string {
  const record = decision.recordUrl
    ? `  - Registro no Azure DevOps: [${decision.recordId ? `#${decision.recordId}` : "abrir"}](${decision.recordUrl})`
    : decision.recordId
      ? `  - Registro no Azure DevOps: #${decision.recordId}`
      : undefined;

  return [
    `- **${decision.question}** — ${decision.answer}`,
    `  - Recomendação do agente: ${decision.recommendation}`,
    `  - ${italic(`Decidido por ${decision.decidedBy} em ${formatDecisionWhen(decision.decidedAt, timeZone)}.`)}`,
    record,
  ].filter((line): line is string => line !== undefined).join("\n");
}

/** Hora local do Operador: o documento é lido por quem estava na sala. */
export function formatDecisionWhen(at: number, timeZone: string): string {
  const when = new Date(at);
  const date = when.toLocaleDateString("pt-BR", { dateStyle: "short", timeZone });
  const time = when.toLocaleTimeString("pt-BR", { timeStyle: "short", timeZone });
  return `${date} às ${time}`;
}

/**
 * O texto do Operador fica intocado. Este bloco determinístico é o vínculo
 * obrigatório entre a Spec e os comments que são os Registros no ADO.
 */
export function appendDecisionTraceability(
  markdown: string,
  decisions: readonly CeremonyDecision[],
): string {
  const traceability = findDecisionTraceability(markdown, decisions);
  let published = markdown;

  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index]!;
    if (!decision.recordId || !decision.recordUrl) {
      throw new CeremonyError(`a decisão ${decision.questionSeq} ainda não tem Registro no Azure DevOps.`);
    }
    const match = traceability.matches[index]!;
    published = `${published.slice(0, match.reviewedStart)}${traceabilityEntry(decision)}${published.slice(match.reviewedEnd)}`;
  }

  return published;
}

/** Links despejados não tornam a revisão do Operador semanticamente velha. */
export function stripDecisionRecordLinks(markdown: string): string {
  return markdown
    .replace(/^ {2}- Registro no Azure DevOps: .*(?:\n|$)/gm, "")
    .replace(/^ {2}- \[Registro #[^\]]+\]\([^\n]+\)(?:\n|$)/gm, "");
}

function traceabilityEntry(decision: CeremonyDecision): string {
  const reviewed = `- **${decision.question}** — ${decision.answer}`;
  if (!decision.recordId || !decision.recordUrl) return reviewed;

  const recordUrl = `${decision.recordUrl.replace(/#.*$/, "")}#discussion_${decision.recordId}`;
  return `${reviewed}\n  - [Registro #${decision.recordId}](${recordUrl})`;
}

function findDecisionTraceability(
  markdown: string,
  decisions: readonly CeremonyDecision[],
  requireEmptyEntry = false,
): DecisionTraceability {
  const appendices = findCanonicalSections(markdown, [DECISION_TRACEABILITY_HEADING]);
  if (appendices.length !== 1) {
    throw new CeremonyError(
      "a rastreabilidade assinada precisa aparecer exatamente uma vez antes da publicação.",
    );
  }

  const appendix = {
    ...appendices[0]!,
    bodyEnd: findNextLevelTwoHeading(markdown, appendices[0]!.bodyStart),
  };
  const traceability = markdown.slice(appendix.bodyStart, appendix.bodyEnd);
  if (
    requireEmptyEntry &&
    decisions.length === 0 &&
    !traceability.split(/\r?\n/).some((line) => line.trim() === EMPTY_DECISION_TRACEABILITY)
  ) {
    throw new CeremonyError(
      `a rastreabilidade assinada sem decisões precisa conter ${EMPTY_DECISION_TRACEABILITY}.`,
    );
  }
  let searchFrom = 0;
  const matches = decisions.map((decision) => {
    const reviewed = traceabilityEntry({ ...decision, recordId: undefined, recordUrl: undefined });
    const reviewedStart = findExactTraceabilityEntry(traceability, reviewed, searchFrom);
    if (reviewedStart === -1) {
      throw new CeremonyError(
        `a rastreabilidade assinada não contém a pergunta e a resposta da decisão ${decision.questionSeq}.`,
      );
    }
    const reviewedEnd = reviewedStart + reviewed.length;
    searchFrom = reviewedEnd;
    return {
      reviewedStart: appendix.bodyStart + reviewedStart,
      reviewedEnd: appendix.bodyStart + reviewedEnd,
    };
  });

  return { appendix, matches };
}

function findExactTraceabilityEntry(
  traceability: string,
  reviewed: string,
  searchFrom: number,
): number {
  let reviewedStart = traceability.indexOf(reviewed, searchFrom);
  while (reviewedStart !== -1) {
    const reviewedEnd = reviewedStart + reviewed.length;
    if (
      reviewedEnd === traceability.length ||
      traceability[reviewedEnd] === "\n" ||
      traceability.startsWith("\r\n", reviewedEnd)
    ) {
      return reviewedStart;
    }
    reviewedStart = traceability.indexOf(reviewed, reviewedEnd);
  }
  return -1;
}

function findNextLevelTwoHeading(markdown: string, bodyStart: number): number {
  let offset = bodyStart;
  let fence = "";

  for (const line of markdown.slice(bodyStart).split(/(?<=\n)/)) {
    const withoutNewline = line.replace(/\r?\n$/, "");
    const fenceMatch = withoutNewline.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch?.[1]) {
      const closesFence =
        fence !== "" &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2]?.trim() === "";
      if (closesFence) {
        fence = "";
      } else if (fence === "") {
        fence = fenceMatch[1];
      }
    } else if (fence === "" && /^ {0,3}##[ \t]+/.test(withoutNewline)) {
      return offset;
    }
    offset += line.length;
  }

  return markdown.length;
}

function findCanonicalSections(
  markdown: string,
  requiredHeadings: readonly string[],
): readonly SpecSectionOccurrence[] {
  const headings = new Set(requiredHeadings);
  const found: SpecSectionStart[] = [];
  let offset = 0;
  let fence = "";

  for (const line of markdown.split(/(?<=\n)/)) {
    const withoutNewline = line.replace(/\r?\n$/, "");
    const fenceMatch = withoutNewline.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch?.[1]) {
      const closesFence =
        fence !== "" &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2]?.trim() === "";
      if (closesFence) {
        fence = "";
      } else if (fence === "") {
        fence = fenceMatch[1];
      }
      offset += line.length;
      continue;
    }

    if (fence === "") {
      const heading = withoutNewline.match(/^ {0,3}##[ \t]+(.+?)[ \t]*$/)?.[1];
      if (heading !== undefined && headings.has(heading)) {
        found.push({ heading, headingStart: offset, bodyStart: offset + line.length });
      }
    }
    offset += line.length;
  }

  return found.map((section, index) => ({
    heading: section.heading,
    bodyStart: section.bodyStart,
    bodyEnd: found[index + 1]?.headingStart ?? markdown.length,
  }));
}

function italic(text: string): string {
  return `_${text}_`;
}

function list<T>(items: readonly T[], render: (item: T) => string): string | undefined {
  return items.length === 0 ? undefined : items.map(render).join("\n");
}
