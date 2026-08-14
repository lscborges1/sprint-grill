import { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";
import { CeremonyError } from "./ceremony-error";
import type { RefinementSpecSubmission } from "@sprint-griller/agent-runtime";
import type { CeremonyDecision, DossieDocument } from "./types";

const DECISION_TRACEABILITY_HEADING = "Rastreabilidade de decisões";
const EMPTY_DECISION_TRACEABILITY = italic("Nenhuma decisão foi registrada.");

export const STRUCTURED_SPEC_HEADINGS = [
  "Problema",
  "Solução",
  "Comportamentos esperados",
  "Decisões de implementação",
  "Estratégia de testes",
  "Fora de escopo",
  "Rastreabilidade",
] as const;

/** Renderização canônica da submissão do agente; o modelo fornece dados, nunca a estrutura. */
export function renderStructuredSpecMarkdown(spec: RefinementSpecSubmission): string {
  return `${[
    "# Spec da US",
    structuredSection("Problema", spec.problem),
    structuredSection("Solução", spec.solution),
    structuredSection("Comportamentos esperados", bulletList(spec.expectedBehaviors)),
    structuredSection("Decisões de implementação", bulletList(spec.implementationDecisions)),
    structuredSection("Estratégia de testes", bulletList(spec.testStrategy)),
    structuredSection("Fora de escopo", bulletList(spec.outOfScope)),
    structuredSection("Rastreabilidade", bulletList(spec.traceability)),
  ].join("\n\n")}\n`;
}

/** Gate da assinatura humana: todas as seções canônicas precisam existir uma vez e ter conteúdo. */
export function assertValidStructuredSpecMarkdown(markdown: string): void {
  const occurrences = findCanonicalSections(markdown, STRUCTURED_SPEC_HEADINGS);
  const errors = STRUCTURED_SPEC_HEADINGS.flatMap((heading) => {
    const matching = occurrences.filter((section) => section.heading === heading);
    if (matching.length === 0) return [`${heading}: seção ausente.`];
    if (matching.length > 1) return [`${heading}: seção aparece mais de uma vez.`];
    const section = matching[0]!;
    return markdown.slice(section.bodyStart, section.bodyEnd).trim() === ""
      ? [`${heading}: seção vazia.`]
      : [];
  });
  if (errors.length > 0) {
    throw new CeremonyError(
      `a Spec estruturada precisa preservar as seções obrigatórias:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
}

/** Compatibilidade de leitura: dumps antigos continuam válidos; novas aprovações usam o contrato estruturado. */
export function assertValidPublicationSpecMarkdown(
  markdown: string,
  decisions?: readonly CeremonyDecision[],
): void {
  const structuredOnlyHeadings = STRUCTURED_SPEC_HEADINGS.filter(
    (heading) => !Object.values(SPEC_SECTIONS).some((legacy) => legacy.heading === heading),
  );
  const isStructured = /^# Spec da US\s*$/m.test(markdown)
    || findCanonicalSections(markdown, structuredOnlyHeadings).length > 0;

  if (isStructured) {
    assertValidStructuredSpecMarkdown(markdown);
    return;
  }

  assertValidSpecMarkdown(markdown, decisions);
}

function structuredSection(heading: typeof STRUCTURED_SPEC_HEADINGS[number], body: string): string {
  return `## ${heading}\n\n${body.trim()}`;
}

function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item.trim()}`).join("\n");
}

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
 * tinha recomendado e quando a resolução coletiva foi registrada.
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
    `  - ${italic(`Resolução registrada em ${formatDecisionWhen(decision.decidedAt, timeZone)}.`)}`,
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
  if (findCanonicalSections(markdown, ["Rastreabilidade"]).length === 1) {
    const section = findCanonicalSections(markdown, ["Rastreabilidade"])[0]!;
    const records = decisions.map((decision) => {
      if (!decision.recordId || !decision.recordUrl) {
        throw new CeremonyError(`a decisão ${decision.questionSeq} ainda não tem Registro no Azure DevOps.`);
      }
      const recordUrl = `${decision.recordUrl.replace(/#.*$/, "")}#discussion_${decision.recordId}`;
      return `- [Registro #${decision.recordId}](${recordUrl}) — ${decision.question}: ${decision.answer}`;
    });
    if (records.length === 0) return markdown;
    const separator = markdown.slice(section.bodyStart, section.bodyEnd).trim() === "" ? "" : "\n";
    return `${markdown.slice(0, section.bodyEnd).trimEnd()}${separator}${records.join("\n")}\n${markdown.slice(section.bodyEnd).replace(/^\n*/, "")}`;
  }
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

  const appendix = appendices[0]!;
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

function findCanonicalSections(
  markdown: string,
  requiredHeadings: readonly string[],
): readonly SpecSectionOccurrence[] {
  const headings = new Set(requiredHeadings);
  const sections = findLevelTwoSections(markdown);

  return sections
    .filter((section) => headings.has(section.heading))
    .map((section) => ({
      heading: section.heading,
      bodyStart: section.bodyStart,
      bodyEnd: sections.find((candidate) => candidate.headingStart > section.headingStart)?.headingStart
        ?? markdown.length,
    }));
}

function findLevelTwoSections(markdown: string): readonly SpecSectionStart[] {
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
      if (heading !== undefined) {
        found.push({ heading, headingStart: offset, bodyStart: offset + line.length });
      }
    }
    offset += line.length;
  }

  return found;
}

function italic(text: string): string {
  return `_${text}_`;
}

function list<T>(items: readonly T[], render: (item: T) => string): string | undefined {
  return items.length === 0 ? undefined : items.map(render).join("\n");
}
