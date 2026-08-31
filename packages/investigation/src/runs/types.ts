import type { StoryDetails } from "@sprint-griller/ado-client";
import type { InvestigationOutcome } from "../investigate";

/** Quem disparou o run: um clique do Operador ou o preparo automático. */
export type InvestigationOrigin = "operador" | "automatico";

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

export type InvestigationStatus =
  | "aguardando"
  | "em-andamento"
  | "aprovado"
  | "reprovado"
  | "falhou";

interface RunBase {
  readonly storyId: number;
  readonly origin: InvestigationOrigin;
  /** Só depois de ler a US no ADO — até lá a tela mostra o número. */
  readonly story: StoryDetails | undefined;
  /**
   * Identidade do run: o timestamp de quando ele entrou no ciclo atual
   * (enfileiramento no preparo, disparo no manual). Chave da coalescência de
   * publicação e da guarda contra escrita de um turno morto.
   */
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
 * Uma Investigação disparada nesta máquina. `aguardando` é a fila do preparo
 * automático (concorrência 1); `em-andamento` é o estado AFK: o Operador fecha
 * a tela, o turno segue no processo, e o resultado espera aqui.
 */
export type InvestigationRun =
  | (RunBase & {
      readonly status: "aguardando";
      /** A `rev` do backlog no momento do enfileiramento — para deduplicar. */
      readonly queuedRev: number | undefined;
    })
  | (RunBase & { readonly status: "em-andamento" })
  | (RunBase & { readonly finishedAt: number } & InvestigationOutcome);

/** Um run que chegou a ter relatório — o que sobrevive a um redisparo. */
export type ReportRun = Extract<
  InvestigationRun,
  { readonly status: "aprovado" | "reprovado" }
>;

/**
 * O que a seleção do preparo precisa saber de cada run local — sem desserializar
 * relatório nenhum. `storyRev` é a rev da US que o turno leu; `queuedRev`, a do
 * enfileiramento.
 */
export interface RunSummary {
  readonly status: InvestigationStatus;
  readonly storyRev: number | undefined;
  readonly queuedRev: number | undefined;
}
