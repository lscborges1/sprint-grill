import type { GroundingResult } from "./grounding";
import type { InvestigationReport } from "./report";
import type { InvestigationStory } from "./story";
import {
  REJECTED_BLURB,
  REJECTED_HEADING,
  REPORT_SECTION_NAMES,
  REPORT_SECTIONS,
  formatCitation,
  reportSectionMarker,
} from "./vocabulary";
import type { ReportSectionName } from "./vocabulary";

/**
 * O relatório em Markdown — o artefato que o Operador lê no preview local e que
 * a publicação no ADO vai gravar como comment. Renderizado por código, não pelo
 * modelo (ADR 0002): a estrutura das seções é garantia, não estilo.
 *
 * O veredito da checagem entra no documento porque o documento circula sozinho:
 * um Markdown copiado de um relatório reprovado não pode se apresentar como
 * verificado.
 *
 * As quatro seções aparecem sempre, mesmo vazias: "nenhum impacto suspeito fora
 * do config" é informação, e seção que some vira dúvida sobre o que o agente fez.
 */
export function renderReportMarkdown(
  story: InvestigationStory,
  report: InvestigationReport,
  grounding: GroundingResult,
): string {
  const approved = grounding.status === "aprovado";

  const blocks = [
    `# Investigação — US #${story.id}: ${story.title}`,
    ...(grounding.status === "reprovado" ? [rejection(grounding), ""] : []),
    report.summary,
    `[Abrir a US no Azure DevOps](${story.url})`,

    reportSection("gaps"),
    list(report.gaps, (gap) => `- **${gap.question}** — ${gap.why}`) ??
      italic(REPORT_SECTIONS.gaps.empty),

    reportSection("impacts"),
    approved ? REPORT_SECTIONS.impacts.verified : REPORT_SECTIONS.impacts.rejected,
    list(report.impacts, (impact) =>
      [
        `- ${impact.claim}`,
        ...impact.citations.map((citation) => `  - \`${formatCitation(citation)}\``),
      ].join("\n"),
    ) ?? italic(REPORT_SECTIONS.impacts.empty),

    reportSection("externalRepos"),
    REPORT_SECTIONS.externalRepos.blurb,
    list(report.externalRepos, (repo) => `- **${repo.repo}** — ${repo.suspicion}`) ??
      italic(REPORT_SECTIONS.externalRepos.empty),

    reportSection("unverified"),
    REPORT_SECTIONS.unverified.blurb,
    list(report.unverified, (claim) => `- ${claim}`) ??
      italic(REPORT_SECTIONS.unverified.empty),
  ];

  return `${restoreSectionMarkers(escapeSectionMarkers(blocks.join("\n\n")))}\n`;
}

function reportSection(section: ReportSectionName): string {
  return `${sectionPlaceholder(section)}\n\n## ${REPORT_SECTIONS[section].heading}`;
}

/**
 * Claims, citations and story text arrive from outside this renderer. A literal
 * section marker in one of them must stay text: otherwise the Dossiê parser
 * would mistake it for report structure and move content between sections.
 */
function escapeSectionMarkers(markdown: string): string {
  return markdown.replaceAll(
    "<!-- sprint-griller:report-section:",
    "&lt;!-- sprint-griller:report-section:",
  );
}

/** Structural placeholders are restored only after external Markdown is escaped. */
function restoreSectionMarkers(markdown: string): string {
  return REPORT_SECTION_NAMES.reduce(
    (rendered, section) =>
      rendered.replaceAll(sectionPlaceholder(section), reportSectionMarker(section)),
    markdown,
  );
}

function sectionPlaceholder(section: ReportSectionName): string {
  return `\u0000sprint-griller:report-section:${section}\u0000`;
}

/** Bloco de citação no topo: é a primeira coisa que quem abrir o arquivo lê. */
function rejection(grounding: Extract<GroundingResult, { status: "reprovado" }>): string {
  return [
    `> **${REJECTED_HEADING}**`,
    ">",
    `> ${REJECTED_BLURB}`,
    ">",
    ...grounding.violations.map(
      (violation) => `> - ${violation.detail} (afirmação: ${violation.claim})`,
    ),
  ].join("\n");
}

function italic(text: string): string {
  return `_${text}_`;
}

function list<T>(
  items: readonly T[],
  render: (item: T) => string,
): string | undefined {
  return items.length === 0 ? undefined : items.map(render).join("\n");
}
