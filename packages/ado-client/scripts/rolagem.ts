/**
 * Baseline retroativa de rolagem: % de US que entram numa sprint e não concluem
 * nela, nas últimas sprints encerradas, lida do Azure DevOps cru via WIQL.
 *
 * Fica fora da UI de propósito — o produto não tem dashboard, e a métrica que
 * julga a ferramenta não pode sair da própria ferramenta. É só leitura.
 *
 *   pnpm rolagem
 *   pnpm rolagem --sprints 10
 */
import { stderr, stdout } from "node:process";
import {
  ConfigError,
  createLogger,
  loadAdoCredentials,
  loadSquadConfig,
} from "@sprint-griller/core";
import { AdoError, fetchRolloverBaseline } from "../src/index";
import type { RolloverCounts, SprintRollover } from "../src/index";

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

async function main(): Promise<void> {
  const sprints = parseSprints(process.argv.slice(2));
  const config = loadSquadConfig();

  const baseline = await fetchRolloverBaseline({
    azureDevOps: config.azureDevOps,
    credentials: loadAdoCredentials(),
    // Log estruturado no stderr para a tabela do stdout seguir colável na retro.
    logger: createLogger({ name: "ado-client", destination: stderr }),
    ...(sprints === undefined ? {} : { sprints }),
  });

  const { organization, project } = config.azureDevOps;
  stdout.write(`\nBaseline de rolagem — ${organization}/${project}\n`);

  if (baseline.sprints.length === 0) {
    stdout.write(
      "\nNenhuma sprint encerrada com datas no Azure DevOps — sem baseline para mostrar.\n\n",
    );
    return;
  }

  stdout.write(
    `${baseline.sprints.length} sprint(s) encerrada(s) · US que entraram na sprint e não concluíram nela\n` +
      "Agregado por sprint, nunca por pessoa · somente leitura do Azure DevOps\n\n",
  );
  stdout.write(table(baseline.sprints, baseline.total));

  if (baseline.total.removed > 0) {
    stdout.write(
      `\n${baseline.total.removed} US removida(s) da sprint ficaram fora da conta: ` +
        "cancelamento não é rolagem.\n",
    );
  }

  stdout.write("\n");
}

const HEADERS = [
  "Sprint",
  "Fechou em",
  "Escopo",
  "Concluíram",
  "Rolaram",
  "Rolagem",
] as const;

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
      .map((cell, column) => pad(cell, widths[column] ?? 0, column === 0))
      .join("  ")
      .trimEnd();

  const ruler = "─".repeat(widths.reduce((sum, width) => sum + width + 2, -2));

  return [
    line(HEADERS),
    ...rows.map(line),
    ruler,
    line(totals),
    "",
  ].join("\n");
}

/** Primeira coluna à esquerda (nomes), números à direita para alinhar a vírgula. */
function pad(cell: string, width: number, left: boolean): string {
  return left ? cell.padEnd(width) : cell.padStart(width);
}

/** Sprint sem US planejada não tem taxa — mostrar 0% seria elogio inventado. */
function rate(value: number | undefined): string {
  return value === undefined ? "—" : percent.format(value);
}

/** `--sprints N`: a janela padrão são as ~6 sprints anteriores ao rollout. */
function parseSprints(argv: readonly string[]): number | undefined {
  const at = argv.indexOf("--sprints");
  if (at === -1) return undefined;

  const raw = argv[at + 1];
  const parsed = Number(raw);
  if (!raw || !Number.isInteger(parsed) || parsed < 1) {
    throw new ConfigError(
      `--sprints precisa de um número inteiro de sprints (recebeu "${raw ?? ""}").`,
    );
  }

  return parsed;
}

try {
  await main();
} catch (error) {
  // Config e ADO já falam com o Operador; o resto é bug e merece o stack.
  if (error instanceof ConfigError || error instanceof AdoError) {
    stderr.write(`\n${error.message}\n\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
