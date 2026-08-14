/**
 * Vocabulário da cerimônia. Os termos são os do glossário (CONTEXT.md): sessão,
 * Registro de decisão, Palco — em português, porque é o que a sala fala.
 */

import type { CeremonyDumpState } from "./dump-state";
import type { RefinementArtifactState } from "./artifact-workflow";

export type { CeremonyDumpState, SignedDumpInputs } from "./dump-state";

export type SessionStatus = "ativa" | "encerrada" | "falhou";

export type RefinementPhase =
  | "refinando"
  | "aguardando-confirmacao"
  | "revisando-spec"
  | "revisando-tickets"
  | "pronto-para-publicar"
  | "publicado";

export interface RefinementState {
  readonly phase: RefinementPhase;
  /** Revisão monotônica de qualquer mudança no refinamento persistido. */
  readonly revision: number;
}

export interface CeremonySession {
  readonly id: string;
  readonly storyId: number;
  readonly storyTitle: string;
  readonly storyUrl: string;
  readonly investigationMarkdown: string;
  readonly timeZone: string;
  readonly createdAt: number;
  readonly status: SessionStatus;
  readonly failureMessage: string | null;
  readonly refinement: RefinementState;
  readonly dump: CeremonyDumpState;
}

export interface CeremonyQuestionOption {
  readonly label: string;
  readonly description: string;
}

/**
 * Uma pergunta que o Palco pode exibir. `recommendation` é campo, não texto
 * solto: é o que separa uma *decisão* de um fato que o agente deveria ter
 * buscado sozinho — e o tipo não deixa existir pergunta sem ela.
 */
export interface CeremonyQuestion {
  readonly id: string;
  /** Item da Agenda que receberá a Resolução desta escolha. */
  readonly agendaItemId?: string;
  /** Perguntas da sala sobrevivem ao turno; perguntas do agente não. */
  readonly source?: "agent" | "room-doubt";
  readonly header: string;
  readonly question: string;
  readonly recommendation: string;
  readonly evidence: readonly string[];
  readonly options: readonly CeremonyQuestionOption[];
  readonly allowFreeText: boolean;
}

/** A pergunta como ela volta do store, com a identidade persistida da linha. */
export interface PersistedCeremonyQuestion extends CeremonyQuestion {
  readonly questionSeq: number;
  readonly agendaItemId: string;
  readonly source: "agent" | "room-doubt";
}

/** Registro de decisão: o artefato que a cerimônia existe para produzir. */
export interface CeremonyDecision {
  /** Sequência da pergunta persistida, não o id efêmero que o agente forneceu. */
  readonly questionSeq: number;
  readonly questionId: string;
  readonly question: string;
  readonly recommendation: string;
  readonly answer: string;
  readonly decidedAt: number;
  /** Referência opcional ao Registro de decisão que o despejo gravou no ADO. */
  readonly recordId?: number | undefined;
  readonly recordUrl?: string | undefined;
}

/** Pendência do Dossiê: o texto é para leitura, o id é a identidade da linha. */
export interface DossiePendingQuestion {
  readonly id: string;
  readonly question: string;
}

/**
 * Evidência de uma resposta factual: um arquivo de um repo do config da squad.
 * Mesma forma da citação da Investigação — é o que a checagem mecânica confere
 * contra o disco antes de a resposta valer como fato.
 */
export interface CeremonyCitation {
  readonly repo: string;
  readonly path: string;
  /** `| undefined` explícito: é o que `exactOptionalPropertyTypes` exige do zod. */
  readonly symbol?: string | undefined;
}

interface RefinementItemBase {
  /** Identidade estável do furo dentro da sessão. */
  readonly id: string;
  readonly question: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type RefinementResolution =
  | {
      readonly kind: "fato";
      readonly answer: string;
      readonly citations: readonly CeremonyCitation[];
      readonly resolvedAt: number;
    }
  | {
      readonly kind: "escolha";
      readonly answer: string;
      readonly recommendation: string;
      readonly resolvedAt: number;
    }
  | {
      readonly kind: "fora-de-escopo";
      readonly justification: string;
      readonly resolvedAt: number;
    };

export type RefinementItem = RefinementItemBase &
  (
    | { readonly status: "aberto" | "pesquisando" | "aguardando-sala" }
    | {
        readonly status: "resolvido";
        readonly resolution: Extract<RefinementResolution, { readonly kind: "fato" | "escolha" }>;
      }
    | {
        readonly status: "fora-de-escopo";
        readonly resolution: Extract<RefinementResolution, { readonly kind: "fora-de-escopo" }>;
      }
  );

export interface SeedRefinementItemInput {
  readonly id: string;
  readonly question: string;
}

export type RefinementItemTransition =
  | {
      readonly itemId: string;
      readonly status: "aberto" | "pesquisando" | "aguardando-sala";
    }
  | {
      readonly itemId: string;
      readonly status: "resolvido";
      readonly resolution:
        | Omit<Extract<RefinementResolution, { readonly kind: "fato" }>, "resolvedAt">
        | Omit<Extract<RefinementResolution, { readonly kind: "escolha" }>, "resolvedAt">;
    }
  | {
      readonly itemId: string;
      readonly status: "fora-de-escopo";
      readonly resolution: Omit<
        Extract<RefinementResolution, { readonly kind: "fora-de-escopo" }>,
        "resolvedAt"
      >;
    };

/** Como uma Consulta termina. `buscando` é o único estado que não está aqui. */
export type ConsultationOutcome =
  | {
      readonly status: "respondida";
      readonly answer: string;
      readonly citations: readonly CeremonyCitation[];
    }
  | {
      /** Respondeu, mas a citação não fechou com o disco: não pode se apresentar como fato. */
      readonly status: "sem-lastro";
      readonly answer: string;
      readonly citations: readonly CeremonyCitation[];
      readonly motivo: string;
    }
  | {
      readonly status: "precisa-sala";
      readonly question: string;
      readonly recommendation: string;
      readonly evidence: readonly string[];
      readonly options: readonly CeremonyQuestionOption[];
      readonly allowFreeText: boolean;
    }
  | { readonly status: "falhou"; readonly message: string };

interface ConsultationAsked {
  readonly id: string;
  readonly question: string;
  readonly askedAt: number;
}

/**
 * Consulta: dúvida **factual** que surge na sala e o agente resolve ao vivo,
 * lendo o código. É o mecanismo que mata o "alguém verifica depois".
 *
 * Nada disto é Registro de decisão: não há o que decidir — quem responde é o
 * repositório, não a sala.
 */
export type CeremonyConsultation =
  | (ConsultationAsked & { readonly status: "buscando" })
  | (ConsultationAsked & ConsultationOutcome & { readonly answeredAt: number });

/** Consulta que respondeu, mas cuja alegação não passou pela checagem no disco. */
export type UnverifiedConsultation = Extract<
  CeremonyConsultation,
  { readonly status: "sem-lastro" }
>;

/** Consulta cuja pergunta ainda precisa ficar explícita no gate de maturidade. */
export type UnresolvedConsultation = Extract<
  CeremonyConsultation,
  { readonly status: "buscando" | "sem-lastro" | "falhou" }
>;

/** Consulta factual cuja resposta e evidências passaram pela checagem no disco. */
export type VerifiedConsultation = Extract<
  CeremonyConsultation,
  { readonly status: "respondida" }
>;

export type RoomChoiceConsultation = Extract<
  CeremonyConsultation,
  { readonly status: "precisa-sala" }
>;

/** O transcript. Deltas de mensagem não entram: ruído não é registro. */
export type TranscriptEvent =
  | { readonly kind: "mensagem"; readonly text: string }
  | {
      readonly kind: "pergunta";
      readonly questionId: string;
      readonly question: string;
      readonly recommendation: string;
    }
  | {
      readonly kind: "decisao";
      readonly questionId: string;
      readonly answer: string;
    }
  | { readonly kind: "pergunta-recusada"; readonly question: string; readonly motivo: string }
  | { readonly kind: "consulta"; readonly consultationId: string; readonly question: string }
  | {
      /**
       * Fato resolvido ao vivo — não é `decisao`, e é de propósito: o transcript
       * precisa dizer o que a sala **decidiu** e o que ela só **descobriu**.
       */
      readonly kind: "resposta-factual";
      readonly consultationId: string;
      readonly answer: string;
      readonly citations: readonly CeremonyCitation[];
      readonly verificada: true;
    }
  | {
      readonly kind: "resposta-factual";
      readonly consultationId: string;
      readonly answer: string;
      readonly citations: readonly CeremonyCitation[];
      readonly verificada: false;
      /** Por que a resposta não pôde ser tratada como fato conferido. */
      readonly motivo: string;
    }
  | { readonly kind: "turno-encerrado" }
  | { readonly kind: "turno-falhou"; readonly message: string }
  | { readonly kind: "retomada" };

export interface TranscriptEntry {
  readonly at: number;
  readonly event: TranscriptEvent;
}

/**
 * O que o Palco mostra agora. `retomavel` é a marca do crash: a sessão está
 * aberta no banco mas nenhum turno vive neste processo.
 */
export type PalcoPhase =
  | { readonly phase: "perguntando"; readonly question: PersistedCeremonyQuestion }
  | { readonly phase: "pensando" }
  | { readonly phase: "retomavel" }
  | { readonly phase: "encerrada" }
  | { readonly phase: "falhou"; readonly message: string };

/** A US como as telas a referenciam: o suficiente para nomear e abrir no ADO. */
export interface StoryRef {
  readonly id: number;
  readonly title: string;
  readonly url: string;
}

export interface PalcoState {
  readonly sessionId: string;
  readonly story: StoryRef;
  readonly decisionCount: number;
  /** Histórico completo para a árvore de decisões do Palco. */
  readonly decisions: readonly CeremonyDecision[];
  /** Perguntas já levantadas pelo agente, ainda sem decisão da sala. */
  readonly pendingQuestions: readonly PersistedCeremonyQuestion[];
  readonly lastDecision: CeremonyDecision | null;
  /**
   * A Consulta da vez. Só a última: o Palco orienta a sala *agora*, e o
   * histórico de fatos já está no transcript. Por isso a cerimônia serializa —
   * uma consulta nova no meio da busca faria a anterior sumir da tela.
   */
  readonly consultation: CeremonyConsultation | null;
  /** Trabalho que ainda precisa de uma decisão da sala. */
  readonly pending: readonly DossiePendingQuestion[];
  /** Se existe um turno de agente vivo neste processo. `false` depois de um crash. */
  readonly live: boolean;
  readonly current: PalcoPhase;
}

/**
 * O documento vivo do Dossiê: a Spec da US como ela está agora, montada só do
 * que a cerimônia gravou. É a fonte do Markdown do despejo — o Operador edita o
 * texto, nunca o documento.
 */
export interface DossieDocument {
  readonly story: StoryRef;
  readonly decisions: readonly CeremonyDecision[];
  /** Perguntas que a sala ainda não respondeu — as pendências do documento. */
  readonly pending: readonly DossiePendingQuestion[];
  /** Trechos da Investigação que a Spec carrega: impacto no código e hipóteses. */
  readonly investigation: {
    readonly impact: string;
    readonly unverified: string;
  };
}

/**
 * A edição do Operador sobre o Markdown do despejo. `base` é o texto gerado de
 * que ela partiu: sem ele, uma decisão registrada depois da edição sumiria do
 * artefato sem ninguém perceber.
 */
export interface SpecDraft {
  readonly markdown: string;
  readonly base: string;
  readonly savedAt: number;
}

/** A aba do Operador: o documento vivo mais o preview editável do despejo. */
export interface DossieState extends DossieDocument {
  readonly sessionId: string;
  readonly status: SessionStatus;
  /** Fuso capturado na abertura da cerimônia, usado para exibir decisões. */
  readonly timeZone: string;
  readonly refinement: RefinementState;
  readonly artifacts: RefinementArtifactState;
  /** Rascunho de Tasks que o agente redigiu no encerramento da cerimônia. */
  readonly taskPreview: string;
  readonly dump: CeremonyDumpState;
  readonly spec: {
    readonly generated: string;
    readonly draft: SpecDraft | null;
  };
}
