import { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";
import type { CeremonyDecision, DossieDocument } from "./types";

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

function italic(text: string): string {
  return `_${text}_`;
}

function list<T>(items: readonly T[], render: (item: T) => string): string | undefined {
  return items.length === 0 ? undefined : items.map(render).join("\n");
}
