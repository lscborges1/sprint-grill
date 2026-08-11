import {
  REPORT_SECTION_NAMES,
  REPORT_SECTIONS,
  reportSectionMarker,
} from "@sprint-griller/investigation";
import { renderSpecMarkdown } from "./spec";
import type { CeremonyStore } from "./store";
import type {
  DossieDocument,
  DossieState,
  UnverifiedConsultation,
  VerifiedConsultation,
} from "./types";

const REPORT_HEADINGS = Object.values(REPORT_SECTIONS).map((section) => section.heading);

/**
 * O Dossiê: a aba do Operador, montada do que está gravado — mesma disciplina do
 * Palco. Nada aqui vem de memória do processo, então a edição e o documento
 * voltam iguais depois de um F5 ou de um restart.
 *
 * A sala não vê esta superfície: o Palco é o que fica projetado, e o preview do
 * despejo é trabalho de revisão, não de sala.
 */
export function readDossie(store: CeremonyStore, sessionId: string): DossieState | undefined {
  const session = store.getSession(sessionId);
  if (!session) return undefined;

  const document: DossieDocument = {
    story: { id: session.storyId, title: session.storyTitle, url: session.storyUrl },
    decisions: store.listDecisions(sessionId),
    pending: store.unansweredQuestions(sessionId).map((asked) => ({
      id: asked.id,
      question: asked.question,
    })),
    investigation: {
      impact: verifiedContext(
        sectionOf(session.investigationMarkdown, "impacts"),
        store.listVerifiedConsultations(sessionId),
      ),
      unverified: unverifiedContext(
        sectionOf(session.investigationMarkdown, "unverified"),
        store.listUnverifiedConsultations(sessionId),
      ),
    },
  };

  return {
    ...document,
    sessionId,
    timeZone: session.timeZone,
    spec: {
      generated: renderSpecMarkdown(document, session.timeZone),
      draft: store.getSpecDraft(sessionId) ?? null,
    },
  };
}

/** A resposta factual que fechou com o disco é impacto conhecido, não hipótese. */
function verifiedContext(
  investigation: string,
  consultations: readonly VerifiedConsultation[],
): string {
  return consultationContext(investigation, consultations, renderVerifiedConsultation);
}

function renderVerifiedConsultation({
  question,
  answer,
  citations,
}: VerifiedConsultation): string {
  return [
    "### Consulta ao vivo verificada",
    `**Pergunta:** ${question}`,
    `**Resposta:** ${answer}`,
    [
      "**Evidências:**",
      ...citations.map(
        (citation) =>
          `- \`${citation.repo}:${citation.path}${citation.symbol ? `#${citation.symbol}` : ""}\``,
      ),
    ].join("\n"),
  ].join("\n\n");
}

/**
 * A consulta que não fechou com o disco não desaparece quando a sala termina:
 * a resposta e o motivo seguem para "Não verificado", sem contaminar impacto.
 */
function unverifiedContext(
  investigation: string,
  consultations: readonly UnverifiedConsultation[],
): string {
  return consultationContext(investigation, consultations, renderUnverifiedConsultation);
}

/** Junta a seção persistida às consultas do mesmo tipo, sem separadores vazios. */
function consultationContext<T>(
  investigation: string,
  consultations: readonly T[],
  render: (consultation: T) => string,
): string {
  return [investigation, ...consultations.map(render)]
    .filter((entry) => entry !== "")
    .join("\n\n");
}

function renderUnverifiedConsultation({
  question,
  answer,
  motivo,
}: UnverifiedConsultation): string {
  return [
    "### Consulta ao vivo sem lastro",
    `**Pergunta:** ${question}`,
    `**Resposta:** ${answer}`,
    `**Falha de grounding:** ${motivo}`,
  ].join("\n\n");
}

/**
 * O trecho da Investigação sob um marcador estrutural. O Markdown de claims é
 * livre para ter headings, então só o marcador invisível emitido pelo renderer
 * delimita uma seção nova.
 *
 * Relatórios antigos sem marcador ainda usam os headings canônicos; Markdown de
 * outro formato sai como seção vazia em vez de inventar contexto.
 */
function sectionOf(
  markdown: string,
  section: (typeof REPORT_SECTION_NAMES)[number],
): string {
  const marked = markedSectionOf(markdown, section);
  return marked ?? legacySectionOf(markdown, REPORT_SECTIONS[section].heading);
}

function markedSectionOf(
  markdown: string,
  section: (typeof REPORT_SECTION_NAMES)[number],
): string | undefined {
  const opening = `${reportSectionMarker(section)}\n\n## ${REPORT_SECTIONS[section].heading}\n`;
  const start = markdown.indexOf(opening);
  if (start === -1) return undefined;

  const body = markdown.slice(start + opening.length);
  const end = REPORT_SECTION_NAMES.filter((candidate) => candidate !== section)
    .map(
      (candidate) =>
        body.indexOf(
          `\n\n${reportSectionMarker(candidate)}\n\n## ${REPORT_SECTIONS[candidate].heading}\n`,
        ),
    )
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return (end === undefined ? body : body.slice(0, end)).trim();
}

/** Compatibilidade para investigações renderizadas antes dos marcadores. */
function legacySectionOf(markdown: string, heading: string): string {
  const opening = `\n## ${heading}\n`;
  const start = markdown.indexOf(opening);
  if (start === -1) return "";

  const body = markdown.slice(start + opening.length);
  // Claims are agent-provided Markdown and may contain their own headings.
  // Only headings emitted by our deterministic report renderer delimit a
  // section; arbitrary `## ...` lines belong to the claim.
  const end = REPORT_HEADINGS.filter((candidate) => candidate !== heading)
    .map((candidate) => body.indexOf(`\n## ${candidate}\n`))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return (end === undefined ? body : body.slice(0, end)).trim();
}
