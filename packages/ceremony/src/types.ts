/**
 * Vocabulário da cerimônia. Os termos são os do glossário (CONTEXT.md): sessão,
 * Registro de decisão, Palco — em português, porque é o que a sala fala.
 */

export type SessionStatus = "ativa" | "encerrada" | "falhou";

export interface CeremonySession {
  readonly id: string;
  readonly storyId: number;
  readonly storyTitle: string;
  readonly storyUrl: string;
  readonly investigationMarkdown: string;
  readonly createdAt: number;
  readonly status: SessionStatus;
  readonly failureMessage: string | null;
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
  readonly header: string;
  readonly question: string;
  readonly recommendation: string;
  readonly evidence: readonly string[];
  readonly options: readonly CeremonyQuestionOption[];
  readonly allowFreeText: boolean;
}

/** Registro de decisão: o artefato que a cerimônia existe para produzir. */
export interface CeremonyDecision {
  readonly questionId: string;
  readonly question: string;
  readonly recommendation: string;
  readonly answer: string;
  readonly decidedBy: string;
  readonly decidedAt: number;
}

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
      readonly decidedBy: string;
    }
  | { readonly kind: "pergunta-recusada"; readonly question: string; readonly motivo: string }
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
  | { readonly phase: "perguntando"; readonly question: CeremonyQuestion }
  | { readonly phase: "pensando" }
  | { readonly phase: "retomavel" }
  | { readonly phase: "encerrada" }
  | { readonly phase: "falhou"; readonly message: string };

export interface PalcoState {
  readonly sessionId: string;
  readonly story: {
    readonly id: number;
    readonly title: string;
    readonly url: string;
  };
  readonly decisionCount: number;
  /** Histórico completo para a árvore de decisões do Palco. */
  readonly decisions: readonly CeremonyDecision[];
  /** Perguntas já levantadas pelo agente, ainda sem decisão da sala. */
  readonly pendingQuestions: readonly CeremonyQuestion[];
  readonly lastDecision: CeremonyDecision | null;
  /** Se existe um turno de agente vivo neste processo. `false` depois de um crash. */
  readonly live: boolean;
  readonly current: PalcoPhase;
}
