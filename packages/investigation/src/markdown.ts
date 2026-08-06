import type { Citation, InvestigationReport } from "./report";
import type { InvestigationStory } from "./story";

/**
 * O relatório em Markdown — o artefato que o Operador lê no preview local e que
 * a publicação no ADO vai gravar como comment. Renderizado por código, não pelo
 * modelo (ADR 0002): a estrutura das seções é garantia, não estilo.
 *
 * As quatro seções aparecem sempre, mesmo vazias: "nenhum impacto suspeito fora
 * do config" é informação, e seção que some vira dúvida sobre o que o agente fez.
 */
export function renderReportMarkdown(
  story: InvestigationStory,
  report: InvestigationReport,
): string {
  const blocks = [
    `# Investigação — US #${story.id}: ${story.title}`,
    report.summary,
    `[Abrir a US no Azure DevOps](${story.url})`,

    "## Furos da US",
    list(report.gaps, (gap) => `- **${gap.question}** — ${gap.why}`) ??
      "_Nenhum furo aberto._",

    "## Impacto mapeado",
    "Toda afirmação abaixo passou pela checagem mecânica de citações.",
    list(report.impacts, (impact) =>
      [`- ${impact.claim}`, ...impact.citations.map((c) => `  - ${citation(c)}`)].join("\n"),
    ) ?? "_Nenhum impacto ancorado no código._",

    "## Impacto suspeito fora do config",
    "Repos que não estão na config da squad — ninguém leu o código deles.",
    list(report.externalRepos, (repo) => `- **${repo.repo}** — ${repo.suspicion}`) ??
      "_Nenhum._",

    "## Não verificado",
    "Hipóteses que o agente não conseguiu ancorar no código. Não são fato.",
    list(report.unverified, (claim) => `- ${claim}`) ?? "_Nada ficou sem âncora._",
  ];

  return `${blocks.join("\n\n")}\n`;
}

function citation({ repo, path, symbol }: Citation): string {
  const anchor = `\`${repo}:${path}\``;
  return symbol === undefined ? anchor : `${anchor} → \`${symbol}\``;
}

function list<T>(
  items: readonly T[],
  render: (item: T) => string,
): string | undefined {
  return items.length === 0 ? undefined : items.map(render).join("\n");
}
