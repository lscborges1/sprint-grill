/**
 * Baseline retroativa de rolagem: % de US que entram numa sprint e não concluem
 * nela, nas últimas sprints encerradas, lida do Azure DevOps cru via WIQL.
 *
 * Fica fora da UI de propósito — o produto não tem dashboard, e a métrica que
 * julga a ferramenta não pode sair da própria ferramenta. É só leitura.
 *
 *   pnpm rolagem
 *   pnpm rolagem --sprints 10 --before 2026-02-01
 */
import { stderr, stdout } from "node:process";
import {
  ConfigError,
  createLogger,
  loadAdoCredentials,
  loadSquadConfig,
} from "@sprint-griller/core";
import {
  AdoError,
  fetchSprintMetrics,
  renderSprintMetricsReport,
} from "../src/index";
import { parseRolagemArgs } from "../src/metrics/rolagem-args";

async function main(): Promise<void> {
  const { before, sprints } = parseRolagemArgs(process.argv.slice(2));
  const config = loadSquadConfig();

  const metrics = await fetchSprintMetrics({
    azureDevOps: config.azureDevOps,
    credentials: loadAdoCredentials(),
    // Log estruturado no stderr para a tabela do stdout seguir colável na retro.
    logger: createLogger({ name: "ado-client", destination: stderr }),
    ...(sprints === undefined ? {} : { sprints }),
    ...(before === undefined ? {} : { before }),
  });

  stdout.write(`\n${renderSprintMetricsReport(metrics, config.azureDevOps)}`);
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
