import { fetchBacklog } from "@sprint-griller/ado-client";
import type { BacklogStory } from "@sprint-griller/ado-client";
import { loadAdoCredentials } from "@sprint-griller/core";
import type { Logger, PreparoConfig, SquadConfig } from "@sprint-griller/core";
import { selectPreparoBatch } from "@sprint-griller/investigation/runs";
import { getRunExecutor } from "./investigations";
import { logger } from "./logger";
import { getSquadConfig } from "./squad-config";

/** Diagnóstico rápido em dev: um ciclo por minuto já exercita a fila. */
export const PREPARO_DEV_INTERVAL_MINUTES = 1;

interface PreparoGlobal {
  __sprintGrillerPreparoTimer?: NodeJS.Timeout;
}

/**
 * O ciclo do preparo automático
 * ([ADR 0005](../../../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md)):
 * lê o backlog do ADO, seleciona o lote elegível (topo da prioridade, sem
 * Investigação, estado configurado), enfileira o que é novo e drena a fila com
 * concorrência 1. Nada aqui publica no ADO — o ciclo só produz preview; a
 * publicação continua sendo o clique do Operador
 * ([ADR 0002](../../../../docs/adr/0002-escrita-no-ado-e-deterministica.md)).
 *
 * O timer vive no globalThis (sobrevive ao HMR) e é `unref`'d: ele nunca é o
 * motivo de o processo Node ficar vivo.
 */
export function startPreparoScheduler(
  squadConfig: SquadConfig,
  preparo: PreparoConfig,
  options: { readonly logger?: Logger } = {},
): void {
  const holder = globalThis as PreparoGlobal;
  if (holder.__sprintGrillerPreparoTimer) return;

  const log = options.logger ?? logger;
  const intervalMs =
    (process.env.NODE_ENV === "development"
      ? PREPARO_DEV_INTERVAL_MINUTES
      : preparo.intervalMinutes) *
    60_000;

  const timer = setInterval(() => {
    void runPreparoCycle(squadConfig, preparo, { logger: log }).catch(
      (error: unknown) => {
        // O ciclo é periódico: erro dele não pode derrubar o processo — o
        // próximo tick tenta de novo com o backlog fresco.
        log.error({ err: error }, "ciclo do preparo falhou");
      },
    );
  }, intervalMs);
  timer.unref?.();

  holder.__sprintGrillerPreparoTimer = timer;
  log.info(
    {
      intervalMinutes: preparo.intervalMinutes,
      limit: preparo.limit,
      states: preparo.states,
    },
    "preparo automático ativado",
  );
}

/**
 * A trava de reentrância do ciclo: turno de agente é lento, e dois ticks não
 * podem empilhar scans sobre o mesmo executor. Module-scoped de propósito —
 * existe mesmo sem scheduler (ciclo disparado manualmente, em teste).
 */
let cycleRunning = false;

/** Um ciclo do preparo: scan, seleção, enfileiramento e dreno da fila. */
export async function runPreparoCycle(
  squadConfig: SquadConfig,
  preparo: PreparoConfig,
  options: { readonly logger?: Logger } = {},
): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    await cycleOnce(squadConfig, preparo, options);
  } finally {
    cycleRunning = false;
  }
}

async function cycleOnce(
  squadConfig: SquadConfig,
  preparo: PreparoConfig,
  options: { readonly logger?: Logger },
): Promise<void> {
  const log = options.logger ?? logger;

  const executor = getRunExecutor();
  const backlog = await fetchBacklog({
    azureDevOps: squadConfig.azureDevOps,
    credentials: loadAdoCredentials(),
    logger: log,
  });

  const batch = selectPreparoBatch(backlog, executor.summaries(), preparo);
  for (const story of batch) {
    executor.enqueue(story.id, story.rev);
  }
  if (batch.length > 0) {
    log.info(
      { stories: batch.map((story: BacklogStory) => story.id) },
      "preparo enfileirou USs",
    );
  }

  // Drena enquanto houver fila — o primeiro claim já dispara em background.
  executor.claimNext();
}
