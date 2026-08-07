import type { RolloverBaseline, RolloverCounts, SprintRollover } from "./rollover";

const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** UTC porque é assim que o ADO datou o fim da sprint — não o fuso de quem roda. */
const day = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  dateStyle: "short",
});

const HEADERS = [
  "Sprint",
  "Fechou em",
  "Escopo",
  "Concluíram",
  "Rolaram",
  "Rolagem",
] as const;

export interface RolloverReportOptions {
  readonly organization: string;
  readonly project: string;
}

/**
 * A baseline como ela vai para a retro: texto colável, com o que a conta faz e
 * o que ela deixa de fora escrito junto do número. Número sem a régra ao lado é
 * o que transforma retro em discussão sobre a régua.
 */
export function renderRolloverReport(
  baseline: RolloverBaseline,
  { organization, project }: RolloverReportOptions,
): string {
  const title = `Baseline de rolagem — ${organization}/${project}`;

  if (baseline.sprints.length === 0) {
    return `${title}\n\nNenhuma sprint encerrada com datas no Azure DevOps — sem baseline para mostrar.\n`;
  }

  const notes = [
    `${baseline.sprints.length} sprint(s) encerrada(s) · US que entraram na sprint e não concluíram nela`,
    "Agregado por sprint, nunca por pessoa · somente leitura do Azure DevOps",
  ];

  const footnotes =
    baseline.total.removed > 0
      ? [
          `${baseline.total.removed} US removida(s) da sprint ficaram fora da conta: ` +
            "cancelamento não é rolagem.",
        ]
      : [];

  return [
    title,
    "",
    ...notes,
    "",
    table(baseline.sprints, baseline.total),
    ...footnotes.flatMap((note) => ["", note]),
    "",
  ].join("\n");
}

function table(
  sprints: readonly SprintRollover[],
  total: RolloverCounts,
): string {
  const rows = sprints.map((sprint) => [
    sprint.name,
    day.format(sprint.finishDate),
    String(sprint.scope),
    String(sprint.completed),
    String(sprint.rolled),
    rate(sprint.rate),
  ]);

  const totals = [
    "Total",
    "",
    String(total.scope),
    String(total.completed),
    String(total.rolled),
    rate(total.rate),
  ];

  const widths = HEADERS.map((header, column) =>
    Math.max(
      header.length,
      ...[...rows, totals].map((row) => row[column]?.length ?? 0),
    ),
  );

  const line = (cells: readonly string[]): string =>
    cells
      // Primeira coluna à esquerda (nomes), números à direita para alinhar a vírgula.
      .map((cell, column) => {
        const width = widths[column] ?? 0;
        return column === 0 ? cell.padEnd(width) : cell.padStart(width);
      })
      .join("  ")
      .trimEnd();

  const ruler = "─".repeat(widths.reduce((sum, width) => sum + width + 2, -2));

  return [line(HEADERS), ...rows.map(line), ruler, line(totals)].join("\n");
}

/** Sprint sem US planejada não tem taxa — mostrar 0% seria elogio inventado. */
function rate(value: number | undefined): string {
  return value === undefined ? "—" : percent.format(value);
}
