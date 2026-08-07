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
import {
  AdoError,
  fetchRolloverBaseline,
  renderRolloverReport,
} from "../src/index";

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

  stdout.write(`\n${renderRolloverReport(baseline, config.azureDevOps)}`);
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
