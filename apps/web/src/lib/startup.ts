import {
  ConfigError,
  loadAdoCredentials,
  loadSquadConfig,
} from "@sprint-griller/core";
import type { PreparoConfig } from "@sprint-griller/core";
import { logger } from "./logger";

const DEMO_ENV_VAR = "REFINA_DEMO";

/**
 * Gate de inicialização: o app não sobe com config da squad inválida. Falhar
 * aqui é o ponto — o Operador descobre o campo errado agora, não no meio de
 * uma cerimônia.
 *
 * Retorna a config de preparo quando habilitada — `instrumentation` decide se
 * sobe o scheduler ([ADR 0005](../../../../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md)).
 */
export function validateStartupConfig(): PreparoConfig | undefined {
  if (process.env[DEMO_ENV_VAR] === "1") {
    logger.warn("modo demo ativo — config da squad e credencial ADO não serão validadas no boot");
    return undefined;
  }

  try {
    const config = loadSquadConfig();
    loadAdoCredentials();

    logger.info(
      {
        azureDevOps: config.azureDevOps,
        repos: {
          primary: config.repos.primary.name,
          related: config.repos.related.map((repo) => repo.name),
        },
        preparo: config.preparo?.enabled
          ? {
              intervalMinutes: config.preparo.intervalMinutes,
              limit: config.preparo.limit,
              states: config.preparo.states,
            }
          : undefined,
      },
      "config da squad validada",
    );
    return config.preparo?.enabled ? config.preparo : undefined;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;

    // Config quebrada não tem recuperação em runtime. Derruba o processo com a
    // mensagem que aponta o campo, em vez de servir 500 até alguém ler o log.
    logger.fatal({ err: error }, "config inválida — o app não sobe");
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}
