import { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";
import { CeremonyError } from "./ceremony-error";
import type { CeremonyDecision, DossieDocument } from "./types";

interface SpecSectionOccurrence {
  readonly heading: string;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

interface SpecSectionStart extends Omit<SpecSectionOccurrence, "bodyEnd"> {
  readonly headingStart: number;
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
  ];

  return `${blocks.join("\n\n")}\n`;
}

/**
 * A edição é livre dentro e fora das seções, mas não pode apagar o contrato da
 * Spec. A mesma asserção protege o save e a última fronteira antes do despejo.
 */
export function assertValidSpecMarkdown(markdown: string): void {
  const requiredHeadings = Object.values(SPEC_SECTIONS).map((section) => section.heading);
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
  const end = Object.values(SPEC_SECTIONS)
    .map((section) => section.heading)
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
  const records = decisions.map((decision) => {
    if (!decision.recordId || !decision.recordUrl) {
      throw new CeremonyError(`a decisão ${decision.questionSeq} ainda não tem Registro no Azure DevOps.`);
    }
    return `- **${decision.question}** — [Registro #${decision.recordId}](${decision.recordUrl})`;
  });

  return `${markdown}\n\n## Rastreabilidade de decisões\n\n${records.join("\n")}\n`;
}

/** Links despejados não tornam a revisão do Operador semanticamente velha. */
export function stripDecisionRecordLinks(markdown: string): string {
  return markdown.replace(/^ {2}- Registro no Azure DevOps: .*(?:\n|$)/gm, "");
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
