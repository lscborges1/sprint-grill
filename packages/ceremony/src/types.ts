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
 * Nada disto é Registro de decisão: consulta não tem `decidedBy` porque não há
 * o que decidir — quem responde é o repositório, não a sala.
 */
export type CeremonyConsultation =
  | (ConsultationAsked & { readonly status: "buscando" })
  | (ConsultationAsked & ConsultationOutcome & { readonly answeredAt: number });

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
      /** `false` quando a citação não fechou com o disco. */
      readonly verificada: boolean;
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
  /**
   * A Consulta da vez. Só a última: o Palco orienta a sala *agora*, e o
   * histórico de fatos já está no transcript.
   */
  readonly consultation: CeremonyConsultation | null;
  /** Se existe um turno de agente vivo neste processo. `false` depois de um crash. */
  readonly live: boolean;
  readonly current: PalcoPhase;
}
