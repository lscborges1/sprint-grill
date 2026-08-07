import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import { AdoError, fetchStory } from "@sprint-griller/ado-client";
import type { StoryDetails } from "@sprint-griller/ado-client";
import { ConfigError, loadAdoCredentials } from "@sprint-griller/core";
import { runInvestigation } from "@sprint-griller/investigation";
import type { InvestigationOutcome } from "@sprint-griller/investigation";
import { z } from "zod";
import { logger } from "./logger";
import { getSquadConfig } from "./squad-config";

/** Um id de US vem do formulário e da URL: os dois passam por aqui. */
export const storyIdSchema = z.coerce.number().int().positive();

interface RunBase {
  readonly storyId: number;
  /** Só depois de ler a US no ADO — até lá a tela mostra o número. */
  readonly story: StoryDetails | undefined;
  readonly startedAt: number;
  /**
   * O relatório do disparo anterior, enquanto o turno em curso não entrega
   * outro: redisparar é aposta, e uma aposta que falha não pode ser o que apaga
   * o único relatório que o Operador tinha. Volta a `undefined` assim que um
   * relatório novo toma o lugar dele.
   */
  readonly previous: ReportRun | undefined;
}

/**
 * Uma Investigação disparada nesta máquina. `em-andamento` é o estado AFK: o
 * Operador fecha a tela, o turno segue no processo, e o resultado espera aqui.
 */
export type InvestigationRun =
  | (RunBase & { readonly status: "em-andamento" })
  | (RunBase & { readonly finishedAt: number } & InvestigationOutcome);

/** Um run que chegou a ter relatório — o que sobrevive a um redisparo. */
export type ReportRun = Extract<
  InvestigationRun,
  { readonly status: "aprovado" | "reprovado" }
>;

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
  const current = runs.get(storyId);
  if (current?.status === "em-andamento") return current;

  const run: InvestigationRun = {
    storyId,
    // A US é a mesma: o título já lido continua na tela enquanto o turno novo
    // não relê o ADO.
    story: current?.story,
    startedAt: Date.now(),
    previous: lastReport(current),
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
    previous: run.previous,
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
    // Um relatório novo substitui o antigo; uma falha não substitui nada.
    previous: outcome.status === "falhou" ? run.previous : undefined,
    finishedAt: Date.now(),
    ...outcome,
  });
}

/**
 * O relatório que atravessa o próximo disparo: o do run que acabou de sair de
 * cena, ou — se ele mesmo falhou — o que ele já estava segurando. Guardado sem
 * o `previous` dele para a corrente não crescer a cada redisparo.
 */
function lastReport(run: InvestigationRun | undefined): ReportRun | undefined {
  if (run === undefined) return undefined;
  return run.status === "aprovado" || run.status === "reprovado"
    ? { ...run, previous: undefined }
    : run.previous;
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
