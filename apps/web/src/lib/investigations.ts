import { createAgentRuntime } from "@sprint-griller/agent-runtime";
import {
  AdoError,
  fetchStory,
  publishInvestigation as publishToAdo,
} from "@sprint-griller/ado-client";
import type { StoryDetails } from "@sprint-griller/ado-client";
import {
  ConfigError,
  defaultInvestigationsDbPath,
  loadAdoCredentials,
} from "@sprint-griller/core";
import { runInvestigation } from "@sprint-griller/investigation";
import {
  isRunStale,
  openInvestigationsStore,
  RunExecutor,
} from "@sprint-griller/investigation/runs";
import type {
  InvestigationOrigin,
  InvestigationRun,
  Publication,
  ReportRun,
  RunSummary,
} from "@sprint-griller/investigation/runs";
import { z } from "zod";
import { logger } from "./logger";
import { getSquadConfig } from "./squad-config";

export type {
  InvestigationOrigin,
  InvestigationRun,
  Publication,
  ReportRun,
  RunSummary,
} from "@sprint-griller/investigation/runs";
export { isRunStale } from "@sprint-griller/investigation/runs";

/** Um id de US vem do formulário e da URL: os dois passam por aqui. */
export const storyIdSchema = z.coerce.number().int().positive();

type ExecutorGlobal = typeof globalThis & {
  __sprintGrillerRunExecutor?: RunExecutor;
};

/**
 * A única fronteira de infraestrutura dos runs: executor + SQLite num holder
 * global — o turno AFK, a fila do preparo e o banco sobrevivem ao HMR do
 * `next dev` ([ADR 0005](../../../../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md)).
 * O `Map` em memória morreu: o banco é o estado, e better-sqlite3 lê em
 * microssegundos — cache nenhum no meio.
 */
export function getRunExecutor(): RunExecutor {
  const holder = globalThis as ExecutorGlobal;
  if (holder.__sprintGrillerRunExecutor) return holder.__sprintGrillerRunExecutor;

  const squadConfig = getSquadConfig();
  holder.__sprintGrillerRunExecutor = new RunExecutor(
    openInvestigationsStore(defaultInvestigationsDbPath(), { logger }),
    squadConfig.repos,
    {
      adoOptions: () => ({
        azureDevOps: squadConfig.azureDevOps,
        credentials: loadAdoCredentials(),
        logger,
      }),
      fetchStory,
      runtimeFactory: async () => {
        const runtime = await createAgentRuntime({
          cwd: squadConfig.repos.primary.path,
          logger,
        });
        return {
          runInvestigation: (input: { readonly story: StoryDetails }) =>
            runInvestigation({
              runtime,
              story: input.story,
              repos: squadConfig.repos,
              logger,
            }),
          close: () => runtime.close(),
        };
      },
    },
    logger,
  );
  return holder.__sprintGrillerRunExecutor;
}

export function getInvestigation(storyId: number) {
  return getRunExecutor().get(storyId);
}

/** Resumos de todos os runs locais — para o Picker decidir `US mudou`. */
export function getRunSummaries() {
  return getRunExecutor().summaries();
}

/**
 * Dispara a Investigação e volta na hora: quem chama redireciona para o preview
 * em vez de segurar a request pelo turno inteiro. Clicar de novo enquanto roda
 * não abre uma segunda — o Operador só volta a olhar o mesmo run.
 */
export function startInvestigation(storyId: number) {
  return getRunExecutor().start(storyId);
}

/**
 * Uma escrita em voo por relatório (`storyId:startedAt`), não por US: redisparar
 * troca o relatório, e a publicação do anterior não pode responder pelo novo.
 */
const publicationsInFlight: Map<string, Promise<Publication>> = ((globalThis as {
  __sprintGrillerPublicationsInFlight?: Map<string, Promise<Publication>>;
}).__sprintGrillerPublicationsInFlight ??= new Map());

function publicationKey(storyId: number, startedAt: number): string {
  return `${storyId}:${startedAt}`;
}

/**
 * Grava a Investigação como comment na US — a única escrita no ADO que existe
 * hoje, e ela nasce de um clique do Operador, nunca de uma tool-call do modelo
 * (ADR 0002) nem do preparo automático (ADR 0005). Diferente do disparo, esta
 * chamada é rápida e a request espera.
 *
 * Só o relatório aprovado passa: o reprovado não é fato (ver `verifyGrounding`),
 * e mandá-lo para a US seria publicar citação que não fecha com o código.
 */
export function publishInvestigation(storyId: number): Promise<Publication> {
  const run = getInvestigation(storyId);
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
  const executor = getRunExecutor();
  const run = executor.get(storyId);
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

    const publication = {
      status: "publicada" as const,
      commentId: published.commentId,
      url: published.url,
    };
    executor.stampPublication(run, publication);
    return publication;
  } catch (error) {
    if (!isOperatorError(error)) throw error;
    logger.error(
      { err: error, storyId, ...(error instanceof AdoError && { kind: error.kind }) },
      "não foi possível publicar a Investigação",
    );
    const publication = {
      status: publicationMayHaveLanded(error) ? ("incerta" as const) : ("falhou" as const),
      message: error.message,
    };
    executor.stampPublication(run, publication);
    return publication;
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
