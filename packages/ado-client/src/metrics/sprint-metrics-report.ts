import type { SprintMetricsReport } from "./sprint-metrics";

const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const day = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "short" });

/** Relatório único, colável na retro, para julgar a tese e não a aparência. */
export function renderSprintMetricsReport(
  report: SprintMetricsReport,
  squad: { readonly organization: string; readonly project: string },
): string {
  const title = `Trio anti-vaidade — ${squad.organization}/${squad.project}`;
  if (report.sprints.length === 0) {
    return `${title}\n\nNenhuma sprint encerrada com datas no Azure DevOps — sem métricas para mostrar.\n`;
  }
  const rows = report.sprints.map((sprint) => [
    sprint.name,
    day.format(sprint.finishDate),
    rate(sprint.rollover.rate),
    `${sprint.coverage.refined}/${sprint.coverage.scope} (${rate(sprint.coverage.rate)})`,
  ]);
  const total = [
    "Total",
    "",
    rate(report.rollover.rate),
    `${report.coverage.refined}/${report.coverage.scope} (${rate(report.coverage.rate)})`,
  ];
  const headers = ["Sprint", "Fechou em", "Rolagem", "Cobertura"] as const;

  return [
    title,
    "",
    "Rolagem vem do ADO cru; cobertura e dúvidas vêm dos artefatos do refinamento gravados no ADO.",
    "Agregado por sprint, nunca por pessoa · somente leitura do Azure DevOps",
    "",
    table(headers, rows, total),
    "",
    ...doubts(report),
    "",
    "Leitura anti-vaidade: rolagem caindo + cobertura alta = funciona; rolagem caindo + cobertura baixa = outra causa; rolagem estável + cobertura alta = tese falhou.",
    "",
  ].join("\n");
}

function doubts(report: SprintMetricsReport): readonly string[] {
  const lines = ["Dúvidas abertas no despejo por US:"];
  for (const sprint of report.sprints) {
    if (sprint.doubts.length === 0) continue;
    lines.push(`- ${sprint.name}`);
    for (const doubt of sprint.doubts) {
      const diagnostic = doubt.rolled && doubt.openQuestions >= 2
        ? " ⚠ rolou com muitas dúvidas"
        : "";
      lines.push(`  - US #${doubt.id} — ${doubt.title}: ${doubt.openQuestions} dúvida(s) aberta(s)${diagnostic}`);
    }
  }
  return lines.length === 1 ? [...lines, "- Nenhuma US foi despejada antes do fechamento."] : lines;
}

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  total: readonly string[],
): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...[...rows, total].map((row) => row[index]?.length ?? 0)),
  );
  const line = (cells: readonly string[]) => cells.map((cell, index) => {
    const width = widths[index] ?? 0;
    return index === 0 ? cell.padEnd(width) : cell.padStart(width);
  }).join("  ").trimEnd();
  const ruler = "─".repeat(widths.reduce((sum, width) => sum + width + 2, -2));
  return [line(headers), ...rows.map(line), ruler, line(total)].join("\n");
}

function rate(value: number | undefined): string {
  return value === undefined ? "—" : percent.format(value);
}
