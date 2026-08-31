import type {
  AdoClientOptions,
  StoryDetails,
} from "@sprint-griller/ado-client";
import { AdoError } from "@sprint-griller/ado-client";
import { ConfigError, type Logger, type SquadConfig } from "@sprint-griller/core";
import type { InvestigationOutcome } from "../investigate";
import type { InvestigationsStore } from "./store";
import type {
  InvestigationOrigin,
  InvestigationRun,
  Publication,
  ReportRun,
  RunSummary,
} from "./types";

/** O que o executor precisa do mundo externo — tudo injetável, nada global. */
export interface RunPorts {
  readonly adoOptions: () => AdoClientOptions;
  readonly fetchStory: (
    options: AdoClientOptions,
    storyId: number,
  ) => Promise<StoryDetails>;
  readonly runtimeFactory: () => Promise<{
    readonly runInvestigation: (input: {
      readonly story: StoryDetails;
      readonly repos: SquadConfig["repos"];
    }) => Promise<InvestigationOutcome>;
    readonly close: () => Promise<void>;
  }>;
}

/**
 * O executor dos runs de Investigação: enfileira, executa e persiste. Um
 * executor por processo — o turno AFK vive nele, e o scheduler do preparo e o
 * clique do Operador compartilham a mesma fila e o mesmo turno em curso
 * (concorrência 1, [ADR 0005](../../../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md)).
 * Toda escrita no ADO continua nascendo de um clique — o executor só produz
 * preview.
 */
export class RunExecutor {
  private readonly turnInFlight = new Set<number>();

  constructor(
    private readonly store: InvestigationsStore,
    private readonly repos: SquadConfig["repos"],
    private readonly ports: RunPorts,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  get(storyId: number): InvestigationRun | undefined {
    return this.store.get(storyId);
  }

  summaries(): Map<number, RunSummary> {
    return this.store.listSummaries();
  }

  /**
   * O clique do Operador: dispara já — pula a fila. Redisparar enquanto um
   * turno corre é no-op (o Operador volta a olhar o mesmo run); disparar sobre
   * um run na fila o promove imediatamente.
   */
  start(
    storyId: number,
    origin: InvestigationOrigin = "operador",
  ): InvestigationRun {
    const current = this.store.get(storyId);
    if (current?.status === "em-andamento") return current;

    const run: InvestigationRun = {
      storyId,
      origin,
      story: current?.story,
      startedAt: this.now(),
      previous: lastReport(current),
      publication: undefined,
      status: "em-andamento",
    };
    this.store.replace(run);

    void this.execute(run).catch((error: unknown) => {
      this.logger.error(
        { err: error, storyId },
        "investigação morreu fora do fluxo de erro",
      );
      this.finish(run, {
        status: "falhou",
        message: "A Investigação parou por um erro inesperado.",
      });
    });

    return run;
  }

  /** Enfileira um run do preparo — sem turno, sem leitura de US ainda. */
  enqueue(
    storyId: number,
    queuedRev: number | undefined,
  ): InvestigationRun {
    const current = this.store.get(storyId);
    const run: InvestigationRun = {
      storyId,
      origin: "automatico",
      story: current?.story,
      startedAt: this.now(),
      previous: lastReport(current),
      publication: undefined,
      status: "aguardando",
      queuedRev,
    };
    this.store.replace(run);
    return run;
  }

  /** O próximo da fila, se houver e nenhum turno estiver correndo. */
  claimNext(): InvestigationRun | undefined {
    if (this.turnInFlight.size > 0) return undefined;
    const next = this.store.oldestAguardando();
    if (next === undefined) return undefined;

    const started: InvestigationRun = {
      storyId: next.storyId,
      origin: next.origin,
      story: next.story,
      startedAt: this.now(),
      previous: next.previous,
      publication: undefined,
      status: "em-andamento",
    };
    this.store.replace(started);
    void this.execute(started).catch((error: unknown) => {
      this.logger.error(
        { err: error, storyId: next.storyId },
        "investigação do preparo morreu fora do fluxo de erro",
      );
      this.finish(started, {
        status: "falhou",
        message: "A Investigação parou por um erro inesperado.",
      });
    });
    return started;
  }

  /**
   * Drena a fila quando um turno termina: a próxima US aguardando não espera o
   * próximo tick do preparo — quem liberou o slot foi o turno anterior, seja ele
   * manual ou automático. Fila vazia é no-op; manual-only não paga nada.
   */
  private drainIfIdle(): void {
    if (this.turnInFlight.size > 0) return;
    const next = this.store.oldestAguardando();
    if (next !== undefined) this.claimNext();
  }

  private async execute(run: InvestigationRun): Promise<void> {
    this.turnInFlight.add(run.storyId);
    try {
      let story: StoryDetails;
      try {
        story = await this.ports.fetchStory(this.ports.adoOptions(), run.storyId);
      } catch (error) {
        if (!isOperatorError(error)) throw error;
        this.logger.error(
          { err: error, storyId: run.storyId },
          "não foi possível ler a US",
        );
        this.finish(run, { status: "falhou", message: error.message });
        return;
      }

      this.update({
        storyId: run.storyId,
        origin: run.origin,
        story,
        startedAt: run.startedAt,
        previous: run.previous,
        publication: undefined,
        status: "em-andamento",
      });

      const runtime = await this.ports.runtimeFactory();
      try {
        this.finish(
          run,
          await runtime.runInvestigation({ story, repos: this.repos }),
          story,
        );
      } finally {
        await runtime.close();
      }
    } finally {
      this.turnInFlight.delete(run.storyId);
      this.drainIfIdle();
    }
  }

  private finish(
    run: InvestigationRun,
    outcome: InvestigationOutcome,
    story?: StoryDetails,
  ): void {
    this.update({
      storyId: run.storyId,
      origin: run.origin,
      story: story ?? run.story,
      startedAt: run.startedAt,
      // Um relatório novo substitui o antigo; uma falha não substitui nada.
      previous: outcome.status === "falhou" ? run.previous : undefined,
      // Relatório novo nasce sem publicação: o comment na US é do anterior.
      publication: undefined,
      finishedAt: this.now(),
      ...outcome,
    });
  }

  /**
   * Carimba a publicação no run — a não ser que um redisparo já tenha tomado o
   * lugar dele enquanto o ADO respondia: aí a publicação foi do relatório
   * antigo, e carimbá-la no run novo diria que o comment na US é o que está na
   * tela.
   */
  stampPublication(run: ReportRun, publication: Publication): void {
    const current = this.store.get(run.storyId);
    if (current?.startedAt === run.startedAt && current.status === run.status) {
      this.store.replace({ ...run, publication });
    }
  }

  /**
   * O run só anda para a frente: um disparo mais novo já tomou o lugar, e run
   * terminado não é reescrito — senão uma falha na saída do agente apagaria o
   * relatório que ele acabou de entregar.
   */
  private update(next: InvestigationRun): void {
    const current = this.store.get(next.storyId);
    if (
      current &&
      (current.startedAt !== next.startedAt ||
        current.status !== "em-andamento")
    ) {
      return;
    }
    this.store.replace(next);
  }
}

/**
 * O relatório que atravessa o próximo disparo: o do run que acabou de sair de
 * cena, ou — se ele mesmo falhou — o que ele já estava segurando. Guardado sem
 * o `previous` dele para a cadeia não crescer a cada redisparo.
 */
export function lastReport(
  run: InvestigationRun | undefined,
): ReportRun | undefined {
  if (run === undefined) return undefined;
  return run.status === "aprovado" || run.status === "reprovado"
    ? stripPrevious(run)
    : run.previous;
}

/** O `previous` embutido não atravessa mais um nível — a cadeia para aqui. */
function stripPrevious(run: ReportRun): ReportRun {
  return run.previous === undefined
    ? run
    : ({ ...run, previous: undefined } as ReportRun);
}

/** Erros já escritos para o Operador ler — o resto é bug e sobe para o boundary. */
function isOperatorError(
  error: unknown,
): error is AdoError | ConfigError {
  return error instanceof AdoError || error instanceof ConfigError;
}
