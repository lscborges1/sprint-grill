import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import { AdoError, fetchStory } from "@sprint-griller/ado-client";
import type { StoryDetails } from "@sprint-griller/ado-client";
import { ConfigError, loadAdoCredentials } from "@sprint-griller/core";
import { runInvestigation } from "@sprint-griller/investigation";
import type { InvestigationOutcome } from "@sprint-griller/investigation";
import { logger } from "./logger";
import { getSquadConfig } from "./squad-config";

interface RunBase {
  readonly storyId: number;
  /** Só depois de ler a US no ADO — até lá a tela mostra o número. */
  readonly story: StoryDetails | undefined;
  readonly startedAt: number;
}

/**
 * Uma Investigação disparada nesta máquina. `em-andamento` é o estado AFK: o
 * Operador fecha a tela, o turno segue no processo, e o resultado espera aqui.
 */
export type InvestigationRun =
  | (RunBase & { readonly status: "em-andamento" })
  | (RunBase & { readonly finishedAt: number } & InvestigationOutcome);

/**
 * ponytail: as Investigações vivem na memória do processo do Operador — teto
 * aceito porque a persistência de cerimônia (SQLite) entra com a sessão de
 * grilling. Reiniciar o app perde os previews ainda não publicados no ADO.
 * Pinado no globalThis para o HMR do `next dev` não zerar tudo a cada save.
 */
const runs: Map<number, InvestigationRun> = ((
  globalThis as { __sprintGrillerRuns?: Map<number, InvestigationRun> }
).__sprintGrillerRuns ??= new Map());

export function getInvestigation(storyId: number): InvestigationRun | undefined {
  return runs.get(storyId);
}

/**
 * Dispara a Investigação e volta na hora: quem chama redireciona para o preview
 * em vez de segurar a request pelo turno inteiro. Clicar de novo enquanto roda
 * não abre uma segunda — o Operador só volta a olhar o mesmo run.
 */
export function startInvestigation(storyId: number): InvestigationRun {
  const running = runs.get(storyId);
  if (running?.status === "em-andamento") return running;

  const run: InvestigationRun = {
    storyId,
    story: undefined,
    startedAt: Date.now(),
    status: "em-andamento",
  };
  runs.set(storyId, run);

  // Solto de propósito: a request que dispara não espera o turno (AFK).
  void execute(run).catch((error: unknown) => {
    logger.error({ err: error, storyId }, "investigação morreu fora do fluxo de erro");
    finish(run, { status: "falhou", message: "A Investigação parou por um erro inesperado." });
  });

  return run;
}

async function execute(run: InvestigationRun): Promise<void> {
  const { azureDevOps, repos } = getSquadConfig();

  let story: StoryDetails;
  try {
    story = await fetchStory(
      { azureDevOps, credentials: loadAdoCredentials(), logger },
      run.storyId,
    );
  } catch (error) {
    if (!(error instanceof AdoError) && !(error instanceof ConfigError)) throw error;
    logger.error({ err: error, storyId: run.storyId }, "não foi possível ler a US");
    finish(run, { status: "falhou", message: error.message });
    return;
  }

  update({
    storyId: run.storyId,
    story,
    startedAt: run.startedAt,
    status: "em-andamento",
  });

  // Um processo de agente por Investigação: o `cwd` é o repo principal e os
  // relacionados entram por caminho absoluto nas instruções.
  const runtime = await createAgentRuntime({ cwd: repos.primary.path, logger });
  try {
    finish(run, await runInvestigation({ runtime, story, repos, logger }), story);
  } finally {
    await runtime.close();
  }
}

function finish(
  run: InvestigationRun,
  outcome: InvestigationOutcome,
  story?: StoryDetails,
): void {
  update({
    storyId: run.storyId,
    story: story ?? run.story,
    startedAt: run.startedAt,
    finishedAt: Date.now(),
    ...outcome,
  });
}

/**
 * O run só anda para a frente: um disparo mais novo já tomou o lugar, e run
 * terminado não é reescrito — senão uma falha na saída do agente apagaria o
 * relatório que ele acabou de entregar.
 */
function update(next: InvestigationRun): void {
  const current = runs.get(next.storyId);
  if (current && (current.startedAt !== next.startedAt || current.status !== "em-andamento")) {
    return;
  }
  runs.set(next.storyId, next);
}
