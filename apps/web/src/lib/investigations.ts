import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import {
  AdoError,
  fetchStory,
  publishInvestigation as publishToAdo,
} from "@sprint-griller/ado-client";
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
  /**
   * O que aconteceu quando o Operador mandou este relatório para o ADO. Vive no
   * run porque, depois do clique, a tela precisa dizer se o comment existe — e,
   * quando não existe, o motivo. Um relatório novo nasce sem publicação.
   */
  readonly publication: Publication | undefined;
}

/**
 * O fim da publicação de uma Investigação. `falhou` fica na tela: o Operador
 * precisa saber que a US não recebeu nada, e por quê, antes de tentar de novo.
 */
export type Publication =
  | {
      readonly status: "publicada";
      readonly commentId: number;
      readonly url: string;
    }
  | { readonly status: "falhou"; readonly message: string }
  | { readonly status: "incerta"; readonly message: string };

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

/**
 * Uma escrita em voo por relatório (`storyId:startedAt`), não por US: redisparar
 * troca o relatório, e a publicação do anterior não pode responder pelo novo.
 */
const publicationsInFlight: Map<string, Promise<Publication>> = ((
  globalThis as {
    __sprintGrillerPublicationsInFlight?: Map<string, Promise<Publication>>;
  }
).__sprintGrillerPublicationsInFlight ??= new Map());

function publicationKey(storyId: number, startedAt: number): string {
  return `${storyId}:${startedAt}`;
}

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
    publication: undefined,
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
    if (!isOperatorError(error)) throw error;
    logger.error({ err: error, storyId: run.storyId }, "não foi possível ler a US");
    finish(run, { status: "falhou", message: error.message });
    return;
  }

  update({
    storyId: run.storyId,
    story,
    startedAt: run.startedAt,
    previous: run.previous,
    publication: undefined,
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
    // Relatório novo nasce sem publicação: o comment na US é do anterior.
    publication: undefined,
    finishedAt: Date.now(),
    ...outcome,
  });
}

/**
 * Grava a Investigação como comment na US — a única escrita no ADO que existe
 * hoje, e ela nasce de um clique do Operador, nunca de uma tool-call do modelo
 * (ADR 0002). Diferente do disparo, esta chamada é rápida e a request espera.
 *
 * Só o relatório aprovado passa: o reprovado não é fato (ver `verifyGrounding`),
 * e mandá-lo para a US seria publicar citação que não fecha com o código.
 */
export function publishInvestigation(storyId: number): Promise<Publication> {
  const run = runs.get(storyId);
  // Sem relatório aprovado não há escrita no ADO — e sem `startedAt` de um
  // relatório concreto não há chave de coalescência que faça sentido.
  if (run?.status !== "aprovado") return publishApprovedInvestigation(storyId);

  const key = publicationKey(storyId, run.startedAt);
  const inFlight = publicationsInFlight.get(key);
  if (inFlight) return inFlight;

  const publication = publishApprovedInvestigation(storyId);
  publicationsInFlight.set(key, publication);
  void publication.then(
    () => releasePublication(key, publication),
    () => releasePublication(key, publication),
  );

  return publication;
}

async function publishApprovedInvestigation(storyId: number): Promise<Publication> {
  const run = runs.get(storyId);
  if (run?.status !== "aprovado") {
    return {
      status: "falhou",
      message:
        "Só uma Investigação aprovada na checagem de citações pode ir para o " +
        "Azure DevOps. Redispare a Investigação desta US.",
    };
  }

  // Republicar duplicaria o comment, e o segundo não corrige o primeiro.
  if (run.publication?.status === "publicada") return run.publication;
  if (run.publication?.status === "incerta") return run.publication;

  try {
    const { azureDevOps } = getSquadConfig();
    const published = await publishToAdo(
      { azureDevOps, credentials: loadAdoCredentials(), logger },
      { storyId, markdown: run.markdown },
    );

    return stampPublication(run, {
      status: "publicada",
      commentId: published.commentId,
      url: published.url,
    });
  } catch (error) {
    if (!isOperatorError(error)) throw error;
    logger.error(
      { err: error, storyId, ...(error instanceof AdoError && { kind: error.kind }) },
      "não foi possível publicar a Investigação",
    );
    return stampPublication(run, {
      status: publicationMayHaveLanded(error) ? "incerta" : "falhou",
      message: error.message,
    });
  }
}

function releasePublication(key: string, publication: Promise<Publication>): void {
  if (publicationsInFlight.get(key) === publication) {
    publicationsInFlight.delete(key);
  }
}

/**
 * Erros já escritos para o Operador ler — credencial ausente e credencial
 * recusada dão na mesma tela. O resto é bug nosso e sobe para o error boundary.
 */
function isOperatorError(error: unknown): error is AdoError | ConfigError {
  return error instanceof AdoError || error instanceof ConfigError;
}

/** Só esses erros podem acontecer depois de o ADO já ter aceitado a escrita. */
function publicationMayHaveLanded(error: AdoError | ConfigError): boolean {
  return (
    error instanceof AdoError &&
    (error.kind === "connection" || error.kind === "unexpected-response")
  );
}

/**
 * Guarda o resultado no run — a não ser que um redisparo já tenha tomado o
 * lugar dele enquanto o ADO respondia: aí a publicação foi do relatório antigo,
 * e carimbá-la no run novo diria que o comment na US é o que está na tela.
 */
function stampPublication(run: ReportRun, publication: Publication): Publication {
  const current = runs.get(run.storyId);
  if (current?.startedAt === run.startedAt && current.status === run.status) {
    runs.set(run.storyId, { ...run, publication });
  }

  return publication;
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
