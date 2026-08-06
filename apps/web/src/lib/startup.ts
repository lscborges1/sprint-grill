import {
  ConfigError,
  loadAdoCredentials,
  loadSquadConfig,
} from "@sprint-griller/core";
import { logger } from "./logger";

/**
 * Gate de inicialização: o app não sobe com config da squad inválida. Falhar
 * aqui é o ponto — o Operador descobre o campo errado agora, não no meio de uma
 * cerimônia.
 */
export function validateStartupConfig(): void {
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
      },
      "config da squad validada",
    );
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;

    // Config quebrada não tem recuperação em runtime. Derruba o processo com a
    // mensagem que aponta o campo, em vez de servir 500 até alguém ler o log.
    logger.fatal({ err: error }, "config inválida — o app não sobe");
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}
