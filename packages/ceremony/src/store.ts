import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "@sprint-griller/core";
import type { RefinementSpecSubmission, RefinementTicketsSubmission } from "@sprint-griller/agent-runtime";
import Database from "better-sqlite3";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import { CeremonyError } from "./ceremony-error";
import {
  artifactHash,
  parseStoredSpecSubmission,
  parseStoredTicketsSubmission,
} from "./artifact-workflow";
import type {
  ApprovedRefinementArtifacts,
  ArtifactApproval,
  RefinementArtifactState,
  SpecArtifact,
  TicketArtifact,
} from "./artifact-workflow";
import { findSignedDumpInputConflict } from "./dump-state";
import {
  assertValidPublicationSpecMarkdown,
  assertValidStructuredSpecMarkdown,
  renderStructuredSpecMarkdown,
} from "./spec";
import { assertValidStructuredTickets, renderStructuredTicketsMarkdown } from "./task-draft";
import {
  SCHEMA_DDL,
  SCHEMA_VERSION,
  consultations,
  decisions,
  events,
  questions,
  refinementItems,
  sessions,
  specArtifacts,
  specDrafts,
  ticketArtifacts,
} from "./schema";
import type {
  CeremonyCitation,
  CeremonyConsultation,
  CeremonyDecision,
  CeremonyQuestion,
  PersistedCeremonyQuestion,
  RefinementItem,
  RefinementItemTransition,
  RefinementPhase,
  RefinementState,
  SeedRefinementItemInput,
  CeremonySession,
  ConsultationOutcome,
  SignedDumpInputs,
  SpecDraft,
  TranscriptEntry,
  TranscriptEvent,
  UnverifiedConsultation,
  UnresolvedConsultation,
  VerifiedConsultation,
} from "./types";

type SessionRow = typeof sessions.$inferSelect;

export interface OpenCeremonyStoreOptions {
  readonly logger?: Logger;
}

export interface CreateSessionInput {
  readonly id: string;
  readonly storyId: number;
  readonly storyTitle: string;
  readonly storyUrl: string;
  readonly investigationMarkdown: string;
  /** IANA timezone captured when the ceremony starts. */
  readonly timeZone: string;
}

export interface RecordDecisionInput {
  readonly sessionId: string;
  readonly questionId: string;
  readonly answer: string;
  /** Referência preenchida quando o Registro de decisão é despejado no ADO. */
  readonly recordId?: number | null;
  readonly recordUrl?: string | null;
}

export interface UpdateRefinementPhaseInput {
  readonly sessionId: string;
  readonly phase: RefinementPhase;
  readonly expectedRevision: number;
}

export type TransitionRefinementItemInput = {
  readonly sessionId: string;
  readonly expectedRevision: number;
} & RefinementItemTransition;

export interface SaveSpecDraftInput {
  readonly sessionId: string;
  readonly markdown: string;
  /** O Markdown gerado que estava na tela quando o Operador editou. */
  readonly base: string;
  /** `null` para a primeira gravação; depois, a revisão exibida pela tela. */
  readonly expectedSavedAt: number | null;
  /** Só é true no envio explícito de confirmação após um conflito. */
  readonly overwrite?: boolean;
}

export interface DiscardSpecDraftInput {
  readonly sessionId: string;
  /** `null` só é válido quando ainda não existe rascunho para descartar. */
  readonly expectedSavedAt: number | null;
}

export interface ArtifactGateInput {
  readonly sessionId: string;
  readonly expectedRevision: number;
}

export interface AttachDecisionRecordInput {
  readonly sessionId: string;
  readonly questionSeq: number;
  readonly recordId: number;
  readonly recordUrl: string;
}

export type BeginDumpInput = SignedDumpInputs;

export type FinishSessionOutcome =
  | { readonly status: "encerrada" }
  | { readonly status: "falhou"; readonly message: string };

/**
 * A única porta do estado de cerimônia. O estado do Refina pertence à sessão:
 * toda mudança de fase ou agenda avança uma revisão monotônica para que ações
 * baseadas numa tela velha falhem em vez de sobrescrever trabalho novo.
 */
export interface CeremonyStore {
  createSession(input: CreateSessionInput): CeremonySession;
  getSession(sessionId: string): CeremonySession | undefined;
  findOpenSessionByStory(storyId: number): CeremonySession | undefined;
  /** Sessão cujo despejo começou e ainda não concluiu — bloqueia nova cerimônia da mesma US. */
  findIncompleteDumpByStory(storyId: number): CeremonySession | undefined;
  updateRefinementPhase(input: UpdateRefinementPhaseInput): RefinementState;
  seedRefinementItems(
    sessionId: string,
    items: readonly SeedRefinementItemInput[],
  ): readonly RefinementItem[];
  listRefinementItems(sessionId: string): readonly RefinementItem[];
  transitionRefinementItem(input: TransitionRefinementItemInput): RefinementItem;
  submitSpec(sessionId: string, submission: RefinementSpecSubmission): SpecArtifact;
  approveSpec(input: ArtifactGateInput): ArtifactApproval;
  submitTickets(sessionId: string, submission: RefinementTicketsSubmission): TicketArtifact;
  approveTickets(input: ArtifactGateInput): NonNullable<TicketArtifact["approval"]>;
  reopenRefinement(input: ArtifactGateInput): RefinementState;
  getArtifactState(sessionId: string): RefinementArtifactState;
  getApprovedArtifacts(sessionId: string): ApprovedRefinementArtifacts | undefined;
  finishSession(sessionId: string, outcome: FinishSessionOutcome): void;
  askQuestions(sessionId: string, asked: readonly CeremonyQuestion[]): void;
  currentQuestion(sessionId: string): PersistedCeremonyQuestion | undefined;
  listOpenQuestions(sessionId: string): readonly PersistedCeremonyQuestion[];
  unansweredQuestions(sessionId: string): readonly CeremonyQuestion[];
  abandonPendingQuestions(sessionId: string): void;
  recordDecision(input: RecordDecisionInput): CeremonyDecision;
  /** Persiste o comment criado no ADO para que um retry não duplique o Registro. */
  attachDecisionRecord(input: AttachDecisionRecordInput): void;
  /**
   * Congela a cerimônia e grava o fingerprint do despejo com os inputs assinados.
   * Retries posteriores precisam reutilizar o mesmo `dumpId` — senão Tasks já
   * marcadas no ADO deixam de ser reconhecidas e o retry cria duplicatas. Spec,
   * Markdown de Tasks e estimativa ficam gravados para o F5 restaurar o form.
   */
  beginDump(sessionId: string, input: BeginDumpInput): void;
  /** Libera o congelamento; mantém o `dumpId` para o retry reconciliar no ADO. */
  abortDump(sessionId: string): void;
  /** Persiste o sucesso para que um novo processo não repita as Tasks. */
  markDumpCompleted(sessionId: string, expectedDecisionCount?: number): void;
  countDecisions(sessionId: string): number;
  lastDecision(sessionId: string): CeremonyDecision | undefined;
  listDecisions(sessionId: string): readonly CeremonyDecision[];
  /**
   * Abre uma Consulta factual: quem responde é o repositório. É a contraparte
   * de `recordDecision`, e as duas escritas nunca se cruzam.
   */
  openConsultation(sessionId: string, question: string): CeremonyConsultation;
  answerConsultation(consultationId: string, outcome: ConsultationOutcome): void;
  lastConsultation(sessionId: string): CeremonyConsultation | undefined;
  /** Respostas ao vivo que passaram pela checagem e entram como impacto conhecido. */
  listVerifiedConsultations(sessionId: string): readonly VerifiedConsultation[];
  /** Respostas ao vivo que precisam constar como hipótese, não como fato. */
  listUnverifiedConsultations(sessionId: string): readonly UnverifiedConsultation[];
  /** Perguntas factuais que ainda participam do gate de maturidade. */
  listUnresolvedConsultations(sessionId: string): readonly UnresolvedConsultation[];
  appendEvent(sessionId: string, event: TranscriptEvent): void;
  listTranscript(sessionId: string): readonly TranscriptEntry[];
  saveSpecDraft(input: SaveSpecDraftInput): SpecDraft;
  getSpecDraft(sessionId: string): SpecDraft | undefined;
  discardSpecDraft(input: DiscardSpecDraftInput): void;
  close(): void;
}

const evidenceSchema = z.array(z.string());
const optionsSchema = z.array(z.object({ label: z.string(), description: z.string() }));
const citationsSchema: z.ZodType<readonly CeremonyCitation[]> = z.array(
  z.object({ repo: z.string(), path: z.string(), symbol: z.string().optional() }),
);
const refinementStateSchema: z.ZodType<RefinementState> = z.object({
  phase: z.enum([
    "refinando",
    "aguardando-confirmacao",
    "revisando-spec",
    "revisando-tickets",
    "pronto-para-publicar",
    "publicado",
  ]),
  revision: z.number().int().nonnegative(),
});

const ORPHANED_CONSULTATION_MESSAGE =
  "A consulta foi interrompida porque o processo foi reiniciado. Pergunte de novo.";

/** O transcript é lido de volta como dado externo: arquivo antigo não pode virar `any`. */
const transcriptEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mensagem"), text: z.string() }),
  z.object({
    kind: z.literal("pergunta"),
    questionId: z.string(),
    question: z.string(),
    recommendation: z.string(),
  }),
  z.object({
    kind: z.literal("decisao"),
    questionId: z.string(),
    answer: z.string(),
  }),
  z.object({ kind: z.literal("pergunta-recusada"), question: z.string(), motivo: z.string() }),
  z.object({ kind: z.literal("consulta"), consultationId: z.string(), question: z.string() }),
  z.object({
    kind: z.literal("resposta-factual"),
    consultationId: z.string(),
    answer: z.string(),
    citations: citationsSchema,
    verificada: z.boolean(),
    motivo: z.string().optional(),
  }),
  z.object({ kind: z.literal("turno-encerrado") }),
  z.object({ kind: z.literal("turno-falhou"), message: z.string() }),
  z.object({ kind: z.literal("retomada") }),
]);

export function openCeremonyStore(
  dbPath: string,
  options: OpenCeremonyStoreOptions = {},
): CeremonyStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  // WAL: a cerimônia grava a cada evento enquanto o Palco lê na mesma máquina.
  sqlite.pragma("journal_mode = WAL");
  applySchema(sqlite, dbPath, options.logger);

  // Um worker de Consulta vive só neste processo. Qualquer busca que sobre no
  // banco quando ele abre já perdeu o worker e não pode continuar bloqueando a
  // sala.
  const recoveredAt = Date.now();
  const recovered = sqlite
    .prepare(
      `UPDATE consultations
       SET status = 'falhou', message = ?, answered_at = ?
       WHERE status = 'buscando'`,
    )
    .run(ORPHANED_CONSULTATION_MESSAGE, recoveredAt);
  if (recovered.changes > 0) {
    options.logger?.warn(
      { consultations: recovered.changes },
      "consultas órfãs marcadas como falhas durante a recuperação",
    );
  }

  const recoveredDumps = sqlite
    .prepare(
      `UPDATE sessions
       SET dump_started_at = NULL
       WHERE dump_started_at IS NOT NULL
         AND dump_id IS NOT NULL
         AND dump_markdown IS NOT NULL
         AND dump_tasks_markdown IS NOT NULL
         AND dump_estimate IS NOT NULL
         AND dumped_at IS NULL`,
    )
    .run();
  if (recoveredDumps.changes > 0) {
    options.logger?.warn(
      { dumps: recoveredDumps.changes },
      "despejos interrompidos liberados durante a recuperação",
    );
  }

  const db = drizzle(sqlite);

  function requireSession(sessionId: string): CeremonySession {
    const session = store.getSession(sessionId);
    if (!session) throw new CeremonyError(`cerimônia ${sessionId} não existe.`);
    return session;
  }

  function assertDossieMutable(sessionId: string): void {
    const session = requireSession(sessionId);
    switch (session.dump.status) {
      case "publishing":
      case "retryable":
      case "completed":
        throw new CeremonyError(
          "a cerimônia já iniciou o despejo e não aceita novas alterações no Dossiê.",
        );
      case "not-started":
        return;
    }
  }

  /** Spec e demais inputs do fingerprint ficam congelados até o despejo concluir. */
  function assertDumpInputsUnlocked(sessionId: string): void {
    const session = requireSession(sessionId);
    switch (session.dump.status) {
      case "not-started":
        return;
      case "publishing":
        throw new CeremonyError("a cerimônia está em despejo e não aceita novas alterações.");
      case "retryable":
        throw new CeremonyError(
          "um despejo parcial já assinou a Spec — use a mesma no retry; editar agora mudaria o fingerprint.",
        );
      case "completed":
        throw new CeremonyError("a cerimônia já foi despejada e não aceita novas edições.");
    }
  }

  function staleRevision(sessionId: string, expectedRevision: number): CeremonyError {
    const actual = store.getSession(sessionId)?.refinement.revision;
    return new CeremonyError(
      actual === undefined
        ? `cerimônia ${sessionId} não existe.`
        : `a revisão do refinamento mudou para ${actual}; recarregue antes de continuar ` +
            `(a ação usava a revisão ${expectedRevision}).`,
    );
  }

  function bumpRefinementRevision(sessionId: string, expectedRevision: number): void {
    const result = db
      .update(sessions)
      .set({ refinementRevision: expectedRevision + 1 })
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.refinementRevision, expectedRevision)),
      )
      .run();
    if (result.changes !== 1) throw staleRevision(sessionId, expectedRevision);
  }

  const store: CeremonyStore = {
    createSession(input) {
      const session: SessionRow = {
        ...input,
        createdAt: Date.now(),
        status: "ativa",
        failureMessage: null,
        refinementPhase: "refinando",
        refinementRevision: 0,
        dumpStartedAt: null,
        dumpId: null,
        dumpMarkdown: null,
        dumpTasksMarkdown: null,
        dumpEstimate: null,
        dumpedAt: null,
      };
      db.insert(sessions).values(session).run();
      return toCeremonySession(session);
    },

    getSession(sessionId) {
      const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
      return row && toCeremonySession(row);
    },

    findOpenSessionByStory(storyId) {
      const row = db
        .select()
        .from(sessions)
        .where(and(eq(sessions.storyId, storyId), eq(sessions.status, "ativa")))
        .orderBy(desc(sessions.createdAt))
        .get();
      return row && toCeremonySession(row);
    },

    findIncompleteDumpByStory(storyId) {
      const row = db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.storyId, storyId),
          sql`${sessions.dumpId} IS NOT NULL`,
          sql`${sessions.dumpedAt} IS NULL`,
        ))
        .orderBy(desc(sessions.createdAt))
        .get();
      return row && toCeremonySession(row);
    },

    updateRefinementPhase({ sessionId, phase, expectedRevision }) {
      assertDossieMutable(sessionId);
      const result = db
        .update(sessions)
        .set({ refinementPhase: phase, refinementRevision: expectedRevision + 1 })
        .where(
          and(eq(sessions.id, sessionId), eq(sessions.refinementRevision, expectedRevision)),
        )
        .run();
      if (result.changes !== 1) throw staleRevision(sessionId, expectedRevision);
      return { phase, revision: expectedRevision + 1 };
    },

    submitSpec(sessionId, submission) {
      assertDossieMutable(sessionId);
      const markdown = renderStructuredSpecMarkdown(submission);
      assertValidStructuredSpecMarkdown(markdown);
      const submittedAt = Date.now();
      const submit = sqlite.transaction((): SpecArtifact => {
        const session = requireSession(sessionId);
        if (session.refinement.phase !== "revisando-spec") {
          throw new CeremonyError("a Spec só pode ser submetida durante a revisão da Spec.");
        }
        const current = db
          .select({ revision: specArtifacts.revision })
          .from(specArtifacts)
          .where(eq(specArtifacts.sessionId, sessionId))
          .get();
        const revision = (current?.revision ?? 0) + 1;
        db.insert(specArtifacts)
          .values({
            sessionId,
            revision,
            submission: JSON.stringify(submission),
            markdown,
            submittedAt,
          })
          .onConflictDoUpdate({
            target: specArtifacts.sessionId,
            set: {
              revision,
              submission: JSON.stringify(submission),
              markdown,
              submittedAt,
              approvedRevision: null,
              approvedHash: null,
              approvedMarkdown: null,
              approvedAt: null,
            },
          })
          .run();
        bumpRefinementRevision(sessionId, session.refinement.revision);
        return { revision, submission, markdown, submittedAt, approval: null };
      });
      return submit.immediate();
    },

    approveSpec({ sessionId, expectedRevision }) {
      assertDossieMutable(sessionId);
      const approve = sqlite.transaction((): ArtifactApproval => {
        const session = requireSession(sessionId);
        if (session.refinement.phase !== "revisando-spec") {
          throw new CeremonyError("a Spec só pode ser aprovada durante a revisão da Spec.");
        }
        if (session.refinement.revision !== expectedRevision) {
          throw staleRevision(sessionId, expectedRevision);
        }
        const artifact = store.getArtifactState(sessionId).spec;
        if (!artifact) throw new CeremonyError("o agente ainda não submeteu uma Spec para revisão.");
        const humanDraft = store.getSpecDraft(sessionId);
        if (humanDraft && humanDraft.base !== artifact.markdown) {
          throw new CeremonyError("o rascunho humano partiu de outra revisão da Spec; regenere antes de aprovar.");
        }
        const markdown = humanDraft?.markdown ?? artifact.markdown;
        assertValidStructuredSpecMarkdown(markdown);
        const approval: ArtifactApproval = {
          revision: artifact.revision,
          hash: artifactHash(markdown),
          markdown,
          approvedAt: Date.now(),
        };
        const artifactUpdate = db
          .update(specArtifacts)
          .set({
            approvedRevision: approval.revision,
            approvedHash: approval.hash,
            approvedMarkdown: approval.markdown,
            approvedAt: approval.approvedAt,
          })
          .where(and(
            eq(specArtifacts.sessionId, sessionId),
            eq(specArtifacts.revision, artifact.revision),
          ))
          .run();
        if (artifactUpdate.changes !== 1) {
          throw new CeremonyError("a Spec mudou durante a aprovação; recarregue antes de continuar.");
        }
        const phaseUpdate = db
          .update(sessions)
          .set({ refinementPhase: "revisando-tickets", refinementRevision: expectedRevision + 1 })
          .where(and(eq(sessions.id, sessionId), eq(sessions.refinementRevision, expectedRevision)))
          .run();
        if (phaseUpdate.changes !== 1) throw staleRevision(sessionId, expectedRevision);
        return approval;
      });
      return approve.immediate();
    },

    submitTickets(sessionId, submission) {
      assertDossieMutable(sessionId);
      const submit = sqlite.transaction((): TicketArtifact => {
        const session = requireSession(sessionId);
        if (session.refinement.phase !== "revisando-tickets") {
          throw new CeremonyError("os Tickets só podem ser submetidos durante a revisão de Tickets.");
        }
        const spec = store.getArtifactState(sessionId).spec;
        if (!spec?.approval || spec.approval.revision !== spec.revision) {
          throw new CeremonyError("aprove a revisão atual da Spec antes de gerar Tickets.");
        }
        const structured = submission.tickets.map(({ title, description, acceptanceCriteria, blockedBy }) => ({
          title,
          description,
          acceptanceCriteria,
          blockedBy,
        }));
        assertValidStructuredTickets(structured, session.storyUrl);
        const markdown = renderStructuredTicketsMarkdown(structured, session.storyUrl);
        const current = db
          .select({ revision: ticketArtifacts.revision })
          .from(ticketArtifacts)
          .where(eq(ticketArtifacts.sessionId, sessionId))
          .get();
        const revision = (current?.revision ?? 0) + 1;
        const submittedAt = Date.now();
        db.insert(ticketArtifacts)
          .values({
            sessionId,
            revision,
            submission: JSON.stringify(submission),
            markdown,
            submittedAt,
            specRevision: spec.approval.revision,
            specHash: spec.approval.hash,
          })
          .onConflictDoUpdate({
            target: ticketArtifacts.sessionId,
            set: {
              revision,
              submission: JSON.stringify(submission),
              markdown,
              submittedAt,
              specRevision: spec.approval.revision,
              specHash: spec.approval.hash,
              approvedRevision: null,
              approvedHash: null,
              approvedMarkdown: null,
              approvedSpecRevision: null,
              approvedSpecHash: null,
              approvedAt: null,
            },
          })
          .run();
        bumpRefinementRevision(sessionId, session.refinement.revision);
        return {
          revision,
          submission,
          markdown,
          submittedAt,
          specRevision: spec.approval.revision,
          specHash: spec.approval.hash,
          approval: null,
        };
      });
      return submit.immediate();
    },

    approveTickets({ sessionId, expectedRevision }) {
      assertDossieMutable(sessionId);
      const approve = sqlite.transaction((): NonNullable<TicketArtifact["approval"]> => {
        const session = requireSession(sessionId);
        if (session.refinement.phase !== "revisando-tickets") {
          throw new CeremonyError("os Tickets só podem ser aprovados durante a revisão de Tickets.");
        }
        if (session.refinement.revision !== expectedRevision) {
          throw staleRevision(sessionId, expectedRevision);
        }
        const { spec, tickets } = store.getArtifactState(sessionId);
        if (!spec?.approval || spec.approval.revision !== spec.revision) {
          throw new CeremonyError("a aprovação da Spec atual não está mais válida.");
        }
        if (!tickets) throw new CeremonyError("o agente ainda não submeteu Tickets para revisão.");
        if (tickets.specRevision !== spec.approval.revision || tickets.specHash !== spec.approval.hash) {
          throw new CeremonyError("os Tickets foram gerados para outra revisão da Spec.");
        }
        const structured = tickets.submission.tickets.map(
          ({ title, description, acceptanceCriteria, blockedBy }) => ({
            title,
            description,
            acceptanceCriteria,
            blockedBy,
          }),
        );
        assertValidStructuredTickets(structured, session.storyUrl);
        const approval = {
          revision: tickets.revision,
          hash: artifactHash(tickets.markdown),
          markdown: tickets.markdown,
          specRevision: spec.approval.revision,
          specHash: spec.approval.hash,
          approvedAt: Date.now(),
        } satisfies NonNullable<TicketArtifact["approval"]>;
        const artifactUpdate = db
          .update(ticketArtifacts)
          .set({
            approvedRevision: approval.revision,
            approvedHash: approval.hash,
            approvedMarkdown: approval.markdown,
            approvedSpecRevision: approval.specRevision,
            approvedSpecHash: approval.specHash,
            approvedAt: approval.approvedAt,
          })
          .where(and(
            eq(ticketArtifacts.sessionId, sessionId),
            eq(ticketArtifacts.revision, tickets.revision),
          ))
          .run();
        if (artifactUpdate.changes !== 1) {
          throw new CeremonyError("os Tickets mudaram durante a aprovação; recarregue antes de continuar.");
        }
        const phaseUpdate = db
          .update(sessions)
          .set({ refinementPhase: "pronto-para-publicar", refinementRevision: expectedRevision + 1 })
          .where(and(eq(sessions.id, sessionId), eq(sessions.refinementRevision, expectedRevision)))
          .run();
        if (phaseUpdate.changes !== 1) throw staleRevision(sessionId, expectedRevision);
        return approval;
      });
      return approve.immediate();
    },

    reopenRefinement({ sessionId, expectedRevision }) {
      assertDumpInputsUnlocked(sessionId);
      const reopen = sqlite.transaction((): RefinementState => {
        const session = requireSession(sessionId);
        if (!["revisando-spec", "revisando-tickets", "pronto-para-publicar"].includes(session.refinement.phase)) {
          throw new CeremonyError("o refinamento só pode ser reaberto depois da confirmação da sala.");
        }
        if (session.refinement.revision !== expectedRevision) throw staleRevision(sessionId, expectedRevision);
        db.update(specArtifacts)
          .set({ approvedRevision: null, approvedHash: null, approvedMarkdown: null, approvedAt: null })
          .where(eq(specArtifacts.sessionId, sessionId))
          .run();
        db.update(ticketArtifacts)
          .set({
            approvedRevision: null,
            approvedHash: null,
            approvedMarkdown: null,
            approvedSpecRevision: null,
            approvedSpecHash: null,
            approvedAt: null,
          })
          .where(eq(ticketArtifacts.sessionId, sessionId))
          .run();
        const result = db.update(sessions)
          .set({ refinementPhase: "refinando", refinementRevision: expectedRevision + 1 })
          .where(and(eq(sessions.id, sessionId), eq(sessions.refinementRevision, expectedRevision)))
          .run();
        if (result.changes !== 1) throw staleRevision(sessionId, expectedRevision);
        return { phase: "refinando", revision: expectedRevision + 1 };
      });
      return reopen.immediate();
    },

    getArtifactState(sessionId) {
      const specRow = db.select().from(specArtifacts).where(eq(specArtifacts.sessionId, sessionId)).get();
      const ticketRow = db.select().from(ticketArtifacts).where(eq(ticketArtifacts.sessionId, sessionId)).get();
      return {
        spec: specRow ? toSpecArtifact(specRow) : null,
        tickets: ticketRow ? toTicketArtifact(ticketRow) : null,
      };
    },

    getApprovedArtifacts(sessionId) {
      const state = store.getArtifactState(sessionId);
      const spec = state.spec?.approval;
      const tickets = state.tickets?.approval;
      if (!state.spec || !state.tickets || !spec || !tickets) return undefined;
      if (spec.revision !== state.spec.revision || tickets.revision !== state.tickets.revision) return undefined;
      if (tickets.specRevision !== spec.revision || tickets.specHash !== spec.hash) return undefined;
      return { spec, tickets };
    },

    seedRefinementItems(sessionId, items) {
      assertDossieMutable(sessionId);
      if (items.length === 0) return store.listRefinementItems(sessionId);

      const normalized = items.map((item) => ({
        id: requiredText(item.id, "o item da agenda precisa de um id."),
        question: requiredText(item.question, "o item da agenda precisa descrever o furo."),
      }));
      if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
        throw new CeremonyError("a agenda não aceita dois itens com o mesmo id.");
      }

      const seed = sqlite.transaction(() => {
        const session = requireSession(sessionId);
        const existing = db
          .select({ itemId: refinementItems.itemId })
          .from(refinementItems)
          .where(eq(refinementItems.sessionId, sessionId))
          .all();
        const existingIds = new Set(existing.map((item) => item.itemId));
        const duplicate = normalized.find((item) => existingIds.has(item.id));
        if (duplicate) {
          throw new CeremonyError(`o item ${duplicate.id} já existe na agenda desta sessão.`);
        }

        const createdAt = Date.now();
        for (const item of normalized) {
          db.insert(refinementItems)
            .values({
              sessionId,
              itemId: item.id,
              question: item.question,
              status: "aberto",
              createdAt,
              updatedAt: createdAt,
            })
            .run();
        }
        bumpRefinementRevision(sessionId, session.refinement.revision);
      });
      seed.immediate();
      return store.listRefinementItems(sessionId);
    },

    listRefinementItems(sessionId) {
      return db
        .select()
        .from(refinementItems)
        .where(eq(refinementItems.sessionId, sessionId))
        .orderBy(asc(refinementItems.seq))
        .all()
        .map(toRefinementItem);
    },

    transitionRefinementItem(input) {
      assertDossieMutable(input.sessionId);
      const transition = sqlite.transaction((): RefinementItem => {
        const session = requireSession(input.sessionId);
        if (session.refinement.revision !== input.expectedRevision) {
          throw staleRevision(input.sessionId, input.expectedRevision);
        }
        const current = db
          .select()
          .from(refinementItems)
          .where(
            and(
              eq(refinementItems.sessionId, input.sessionId),
              eq(refinementItems.itemId, input.itemId),
            ),
          )
          .get();
        if (!current) {
          throw new CeremonyError(`o item ${input.itemId} não existe na agenda desta sessão.`);
        }

        const updatedAt = Date.now();
        const resolution = refinementResolutionColumns(input, updatedAt);
        const updated = db
          .update(refinementItems)
          .set({ status: input.status, updatedAt, ...resolution })
          .where(eq(refinementItems.seq, current.seq))
          .returning()
          .get();
        if (!updated) {
          throw new CeremonyError(`não foi possível atualizar o item ${input.itemId} da agenda.`);
        }
        bumpRefinementRevision(input.sessionId, input.expectedRevision);
        return toRefinementItem(updated);
      });
      return transition.immediate();
    },

    finishSession(sessionId, outcome) {
      assertDossieMutable(sessionId);
      db.update(sessions)
        .set({
          status: outcome.status,
          failureMessage: outcome.status === "falhou" ? outcome.message : null,
        })
        .where(eq(sessions.id, sessionId))
        .run();
    },

    askQuestions(sessionId, asked) {
      assertDossieMutable(sessionId);
      if (asked.length === 0) return;

      const askedAt = Date.now();
      db.transaction((tx) => {
        for (const question of asked) {
          tx.insert(questions)
            .values({
              sessionId,
              questionId: question.id,
              agendaItemId: question.agendaItemId ?? question.id,
              source: question.source ?? "agent",
              header: question.header,
              question: question.question,
              recommendation: question.recommendation,
              evidence: JSON.stringify(question.evidence),
              options: JSON.stringify(question.options),
              allowFreeText: question.allowFreeText,
              askedAt,
              status: "aberta",
            })
            .run();
          tx.insert(events)
            .values({
              sessionId,
              at: askedAt,
              kind: "pergunta",
              payload: JSON.stringify({
                kind: "pergunta",
                questionId: question.id,
                question: question.question,
                recommendation: question.recommendation,
              } satisfies TranscriptEvent),
            })
            .run();
        }
      });
    },

    currentQuestion(sessionId) {
      const row = db
        .select()
        .from(questions)
        .where(and(eq(questions.sessionId, sessionId), eq(questions.status, "aberta")))
        .orderBy(asc(questions.seq))
        .get();
      return row && toQuestion(row);
    },

    listOpenQuestions(sessionId) {
      return db
        .select()
        .from(questions)
        .where(and(eq(questions.sessionId, sessionId), eq(questions.status, "aberta")))
        .orderBy(asc(questions.seq))
        .all()
        .map(toQuestion);
    },

    unansweredQuestions(sessionId) {
      const rows = db
        .select()
        .from(questions)
        .where(eq(questions.sessionId, sessionId))
        .orderBy(asc(questions.seq))
        .all();

      /**
       * Uma pergunta abandonada por crash costuma voltar com o mesmo id depois
       * da retomada. O id é a identidade explícita da pergunta dentro da rodada;
       * o texto não é, porque duas decisões podem ser formuladas igual.
       */
      const unica = new Map(rows.map((row) => [row.questionId, row]));
      return [...unica.values()].filter((row) => row.status !== "respondida").map(toQuestion);
    },

    abandonPendingQuestions(sessionId) {
      assertDossieMutable(sessionId);
      db.update(questions)
        .set({ status: "abandonada" })
        .where(
          and(
            eq(questions.sessionId, sessionId),
            eq(questions.status, "aberta"),
            eq(questions.source, "agent"),
          ),
        )
        .run();
    },

    recordDecision({ sessionId, questionId, answer, recordId, recordUrl }) {
      assertDossieMutable(sessionId);

      const chosen = answer.trim();
      if (chosen === "") throw new CeremonyError("a resposta da sala não pode ser vazia.");

      const pending = db
        .select()
        .from(questions)
        .where(
          and(
            eq(questions.sessionId, sessionId),
            eq(questions.questionId, questionId),
            eq(questions.status, "aberta"),
          ),
        )
        .orderBy(asc(questions.seq))
        .get();

      if (!pending) {
        throw new CeremonyError(`a pergunta ${questionId} não está aberta nesta cerimônia.`);
      }

      const decision: CeremonyDecision = {
        questionSeq: pending.seq,
        questionId,
        question: pending.question,
        recommendation: pending.recommendation,
        answer: chosen,
        decidedAt: Date.now(),
        ...(recordId == null ? {} : { recordId }),
        ...(recordUrl == null ? {} : { recordUrl }),
      };

      db.transaction((tx) => {
        tx.update(questions).set({ status: "respondida" }).where(eq(questions.seq, pending.seq)).run();
        tx.insert(decisions)
          .values({
            sessionId,
            questionSeq: pending.seq,
            questionId: decision.questionId,
            question: decision.question,
            recommendation: decision.recommendation,
            answer: decision.answer,
            decidedAt: decision.decidedAt,
            recordId: recordId ?? null,
            recordUrl: recordUrl ?? null,
          })
          .run();
        tx.insert(events)
          .values({
            sessionId,
            at: decision.decidedAt,
            kind: "decisao",
            payload: JSON.stringify({
              kind: "decisao",
              questionId,
              answer: decision.answer,
            } satisfies TranscriptEvent),
          })
          .run();
      });

      return decision;
    },

    attachDecisionRecord({ sessionId, questionSeq, recordId, recordUrl }) {
      const current = db
        .select({ recordId: decisions.recordId, recordUrl: decisions.recordUrl })
        .from(decisions)
        .where(and(eq(decisions.sessionId, sessionId), eq(decisions.questionSeq, questionSeq)))
        .get();

      if (!current) {
        throw new CeremonyError(`a decisão ${questionSeq} não existe nesta cerimônia.`);
      }
      if (current.recordId !== null || current.recordUrl !== null) {
        throw new CeremonyError(`a decisão ${questionSeq} já tem Registro no Azure DevOps.`);
      }

      const result = db
        .update(decisions)
        .set({ recordId, recordUrl })
        .where(and(eq(decisions.sessionId, sessionId), eq(decisions.questionSeq, questionSeq)))
        .run();
      if (result.changes !== 1) {
        throw new CeremonyError(`não foi possível vincular o Registro à decisão ${questionSeq}.`);
      }
    },

    beginDump(sessionId, input) {
      const fingerprint = input.dumpId.trim();
      if (fingerprint === "") {
        throw new CeremonyError("o despejo precisa de um fingerprint antes de começar.");
      }
      const markdown = input.markdown;
      if (markdown.trim() === "") {
        throw new CeremonyError("o despejo precisa da Spec assinada antes de começar.");
      }
      assertValidPublicationSpecMarkdown(markdown, store.listDecisions(sessionId));
      const tasksMarkdown = input.tasksMarkdown;
      if (tasksMarkdown.trim() === "") {
        throw new CeremonyError("o despejo precisa das Tasks assinadas antes de começar.");
      }
      if (!Number.isFinite(input.estimate) || input.estimate <= 0) {
        throw new CeremonyError("o despejo precisa de uma estimativa positiva antes de começar.");
      }

      const session = requireSession(sessionId);
      if (session.dump.status === "publishing" || session.dump.status === "completed") {
        throw new CeremonyError("a cerimônia já está em despejo ou já foi despejada.");
      }
      if (
        session.dump.status === "retryable" &&
        (
          session.dump.inputs.dumpId !== input.dumpId ||
          findSignedDumpInputConflict(session.dump.inputs, input) !== undefined
        )
      ) {
        throw new CeremonyError(
          "o despejo já começou com outra Spec, outras Tasks ou outra estimativa — use os mesmos valores assinados no retry.",
        );
      }

      const retrying = session.dump.status === "retryable";
      const result = db
        .update(sessions)
        .set(retrying
          ? { dumpStartedAt: Date.now() }
          : {
              dumpStartedAt: Date.now(),
              dumpId: fingerprint,
              dumpMarkdown: markdown,
              dumpTasksMarkdown: tasksMarkdown,
              dumpEstimate: input.estimate,
            })
        .where(and(
          eq(sessions.id, sessionId),
          sql`${sessions.dumpStartedAt} IS NULL`,
          sql`${sessions.dumpedAt} IS NULL`,
          ...(retrying
            ? [
                eq(sessions.dumpId, input.dumpId),
                eq(sessions.dumpMarkdown, input.markdown),
                eq(sessions.dumpTasksMarkdown, input.tasksMarkdown),
                eq(sessions.dumpEstimate, input.estimate),
              ]
            : [sql`${sessions.dumpId} IS NULL`]),
        ))
        .run();
      if (result.changes !== 1) {
        throw new CeremonyError("a cerimônia já está em despejo ou já foi despejada.");
      }
    },

    abortDump(sessionId) {
      db
        .update(sessions)
        .set({ dumpStartedAt: null })
        .where(and(
          eq(sessions.id, sessionId),
          sql`${sessions.dumpStartedAt} IS NOT NULL`,
          sql`${sessions.dumpedAt} IS NULL`,
        ))
        .run();
    },

    markDumpCompleted(sessionId, expectedDecisionCount) {
      const expectedDecisions = expectedDecisionCount === undefined
        ? undefined
        : sql`(SELECT count(*) FROM decisions WHERE session_id = ${sessionId}) = ${expectedDecisionCount}`;
      const result = db
        .update(sessions)
        .set({
          status: "encerrada",
          refinementPhase: "publicado",
          refinementRevision: sql`${sessions.refinementRevision} + 1`,
          dumpStartedAt: null,
          dumpedAt: Date.now(),
        })
        .where(and(
          eq(sessions.id, sessionId),
          ...(expectedDecisions === undefined ? [] : [expectedDecisions]),
          sql`${sessions.dumpStartedAt} IS NOT NULL`,
          sql`${sessions.dumpId} IS NOT NULL`,
          sql`${sessions.dumpMarkdown} IS NOT NULL`,
          sql`${sessions.dumpTasksMarkdown} IS NOT NULL`,
          sql`${sessions.dumpEstimate} IS NOT NULL`,
          sql`${sessions.dumpedAt} IS NULL`,
        ))
        .run();
      if (result.changes !== 1) {
        throw new CeremonyError("não foi possível persistir a conclusão do despejo.");
      }
    },

    countDecisions(sessionId) {
      const row = db
        .select({ total: sql<number>`count(*)` })
        .from(decisions)
        .where(eq(decisions.sessionId, sessionId))
        .get();
      return row?.total ?? 0;
    },

    lastDecision(sessionId) {
      const row = db
        .select()
        .from(decisions)
        .where(eq(decisions.sessionId, sessionId))
        .orderBy(desc(decisions.seq))
        .get();
      return row && toDecision(row);
    },

    listDecisions(sessionId) {
      return db
        .select()
        .from(decisions)
        .where(eq(decisions.sessionId, sessionId))
        .orderBy(asc(decisions.seq))
        .all()
        .map(toDecision);
    },

    openConsultation(sessionId, question) {
      assertDossieMutable(sessionId);

      const asked = question.trim();
      if (asked === "") throw new CeremonyError("escreva a pergunta de fato para o agente.");

      const askedAt = Date.now();
      return db.transaction((tx) => {
        const row = tx
          .insert(consultations)
          .values({ sessionId, question: asked, askedAt, status: "buscando" })
          .returning()
          .get();
        tx.insert(events)
          .values({
            sessionId,
            at: askedAt,
            kind: "consulta",
            payload: JSON.stringify({
              kind: "consulta",
              consultationId: String(row.seq),
              question: asked,
            } satisfies TranscriptEvent),
          })
          .run();
        return toConsultation(row);
      });
    },

    answerConsultation(consultationId, outcome) {
      const seq = Number(consultationId);
      const open = db
        .select()
        .from(consultations)
        .where(and(eq(consultations.seq, seq), eq(consultations.status, "buscando")))
        .get();

      if (!open) throw new CeremonyError(`a consulta ${consultationId} não está aberta.`);
      assertDossieMutable(open.sessionId);

      const answeredAt = Date.now();
      db.transaction((tx) => {
        tx.update(consultations)
          .set({
            status: outcome.status,
            question: outcome.status === "precisa-sala" ? outcome.question : open.question,
            answer:
              outcome.status === "respondida" || outcome.status === "sem-lastro"
                ? outcome.answer
                : null,
            citations:
              outcome.status === "respondida" || outcome.status === "sem-lastro"
                ? JSON.stringify(outcome.citations)
                : null,
            motivo: outcome.status === "sem-lastro" ? outcome.motivo : null,
            message: outcome.status === "falhou" ? outcome.message : null,
            recommendation:
              outcome.status === "precisa-sala" ? outcome.recommendation : null,
            evidence:
              outcome.status === "precisa-sala" ? JSON.stringify(outcome.evidence) : null,
            options:
              outcome.status === "precisa-sala" ? JSON.stringify(outcome.options) : null,
            allowFreeText:
              outcome.status === "precisa-sala" ? outcome.allowFreeText : null,
            answeredAt,
          })
          .where(eq(consultations.seq, seq))
          .run();

        // Consulta que não chegou a responder não deixa fato no transcript: o
        // registro é do que o código respondeu, não do que se tentou perguntar.
        if (outcome.status === "falhou" || outcome.status === "precisa-sala") return;

        const factualEvent: TranscriptEvent =
          outcome.status === "respondida"
            ? {
                kind: "resposta-factual",
                consultationId,
                answer: outcome.answer,
                citations: outcome.citations,
                verificada: true,
              }
            : {
                kind: "resposta-factual",
                consultationId,
                answer: outcome.answer,
                citations: outcome.citations,
                verificada: false,
                motivo: outcome.motivo,
              };

        tx.insert(events)
          .values({
            sessionId: open.sessionId,
            at: answeredAt,
            kind: "resposta-factual",
            payload: JSON.stringify(factualEvent),
          })
          .run();
      });
    },

    lastConsultation(sessionId) {
      const row = db
        .select()
        .from(consultations)
        .where(eq(consultations.sessionId, sessionId))
        .orderBy(desc(consultations.seq))
        .get();
      return row && toConsultation(row);
    },

    listVerifiedConsultations(sessionId) {
      return db
        .select()
        .from(consultations)
        .where(
          and(
            eq(consultations.sessionId, sessionId),
            eq(consultations.status, "respondida"),
          ),
        )
        .orderBy(asc(consultations.seq))
        .all()
        .map(toConsultation)
        .filter(isVerifiedConsultation);
    },

    listUnverifiedConsultations(sessionId) {
      return db
        .select()
        .from(consultations)
        .where(
          and(
            eq(consultations.sessionId, sessionId),
            eq(consultations.status, "sem-lastro"),
          ),
        )
        .orderBy(asc(consultations.seq))
        .all()
        .map(toConsultation)
        .filter(isUnverifiedConsultation);
    },

    listUnresolvedConsultations(sessionId) {
      return db
        .select()
        .from(consultations)
        .where(
          and(
            eq(consultations.sessionId, sessionId),
            inArray(consultations.status, ["buscando", "sem-lastro", "falhou"]),
          ),
        )
        .orderBy(asc(consultations.seq))
        .all()
        .map(toConsultation)
        .filter(isUnresolvedConsultation);
    },

    appendEvent(sessionId, event) {
      assertDossieMutable(sessionId);
      db.insert(events)
        .values({ sessionId, at: Date.now(), kind: event.kind, payload: JSON.stringify(event) })
        .run();
    },

    listTranscript(sessionId) {
      return db
        .select()
        .from(events)
        .where(eq(events.sessionId, sessionId))
        .orderBy(asc(events.seq))
        .all()
        .map((row) => ({
          at: row.at,
          event: normalizeTranscriptEvent(
            transcriptEventSchema.parse(JSON.parse(row.payload)),
            (consultationId) => {
              const seq = Number(consultationId);
              if (!Number.isInteger(seq)) return undefined;

              return db
                .select({ motivo: consultations.motivo })
                .from(consultations)
                .where(eq(consultations.seq, seq))
                .get()?.motivo;
            },
          ),
        }));
    },

    saveSpecDraft({ sessionId, markdown, base, expectedSavedAt, overwrite = false }) {
      assertDumpInputsUnlocked(sessionId);

      // Só valida vazio: `.trim()` no conteúdo apagaria Markdown legítimo
      // (ex.: bloco de código indentado na primeira linha).
      if (markdown.trim() === "") {
        throw new CeremonyError("a Spec da US não pode ficar vazia — regenere o documento.");
      }
      assertValidPublicationSpecMarkdown(markdown, store.listDecisions(sessionId));

      /**
       * A revisão nasce da linha gravada, nunca da que a tela esperava: num
       * overwrite a esperada é justamente a velha, e repeti-la faria a aba que
       * exibe a revisão sobrescrita não ver conflito nenhum no próximo save.
       *
       * O `SELECT` no `INSERT` impede criar uma linha quando a tela já espera
       * uma revisão, e o `WHERE` do UPSERT impede atualizar outra revisão.
       * Assim a decisão inteira é uma operação CAS do SQLite; o `BEGIN
       * IMMEDIATE` em volta fecha a janela entre ler a revisão e escrever.
       */
      const save = sqlite.transaction((): SpecDraft => {
        const current = db
          .select({ savedAt: specDrafts.savedAt })
          .from(specDrafts)
          .where(eq(specDrafts.sessionId, sessionId))
          .get();
        const savedAt = Math.max(Date.now(), (current?.savedAt ?? 0) + 1);

        const result = overwrite
          ? sqlite
              .prepare(
                `INSERT INTO spec_drafts (session_id, markdown, base, saved_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(session_id) DO UPDATE SET
                   markdown = excluded.markdown,
                   base = excluded.base,
                   saved_at = excluded.saved_at`,
              )
              .run(sessionId, markdown, base, savedAt)
          : sqlite
              .prepare(
                `INSERT INTO spec_drafts (session_id, markdown, base, saved_at)
                 SELECT ?, ?, ?, ?
                 WHERE ? IS NULL
                    OR EXISTS (
                      SELECT 1 FROM spec_drafts
                      WHERE session_id = ? AND saved_at = ?
                    )
                 ON CONFLICT(session_id) DO UPDATE SET
                   markdown = excluded.markdown,
                   base = excluded.base,
                   saved_at = excluded.saved_at
                   WHERE spec_drafts.saved_at = ?`,
              )
              .run(
                sessionId,
                markdown,
                base,
                savedAt,
                expectedSavedAt,
                sessionId,
                expectedSavedAt,
                expectedSavedAt,
              );

        if (result.changes !== 1) {
          throw new CeremonyError(
            "o rascunho está desatualizado — recarregue a edição antes de salvar.",
          );
        }

        return { markdown, base, savedAt };
      });

      return save.immediate();
    },

    getSpecDraft(sessionId) {
      const row = db
        .select()
        .from(specDrafts)
        .where(eq(specDrafts.sessionId, sessionId))
        .get();
      return row && { markdown: row.markdown, base: row.base, savedAt: row.savedAt };
    },

    discardSpecDraft({ sessionId, expectedSavedAt }) {
      assertDumpInputsUnlocked(sessionId);
      const discard = sqlite.transaction(() => {
        const current = db
          .select({ savedAt: specDrafts.savedAt })
          .from(specDrafts)
          .where(eq(specDrafts.sessionId, sessionId))
          .get();

        if (!current) {
          if (expectedSavedAt !== null) {
            throw new CeremonyError(
              "o rascunho está desatualizado — recarregue a edição antes de descartar.",
            );
          }
          return;
        }
        if (expectedSavedAt === null || current.savedAt !== expectedSavedAt) {
          throw new CeremonyError(
            "o rascunho está desatualizado — recarregue a edição antes de descartar.",
          );
        }

        const result = db
          .delete(specDrafts)
          .where(and(eq(specDrafts.sessionId, sessionId), eq(specDrafts.savedAt, expectedSavedAt)))
          .run();
        if (result.changes !== 1) {
          throw new CeremonyError(
            "o rascunho está desatualizado — recarregue a edição antes de descartar.",
          );
        }
      });
      discard.immediate();
    },

    close() {
      sqlite.close();
    },
  };

  return store;
}

function toCeremonySession(row: SessionRow): CeremonySession {
  const {
    dumpStartedAt,
    dumpId,
    dumpMarkdown,
    dumpTasksMarkdown,
    dumpEstimate,
    dumpedAt,
    refinementPhase,
    refinementRevision,
    ...session
  } = row;
  return {
    ...session,
    refinement: toRefinementState(row.id, refinementPhase, refinementRevision),
    dump: toDumpState(row.id, {
      dumpStartedAt,
      dumpId,
      dumpMarkdown,
      dumpTasksMarkdown,
      dumpEstimate,
      dumpedAt,
    }),
  };
}

function toRefinementState(
  sessionId: string,
  phase: SessionRow["refinementPhase"],
  revision: number,
): RefinementState {
  const parsed = refinementStateSchema.safeParse({ phase, revision });
  if (parsed.success) return parsed.data;
  throw new CeremonyError(
    `a cerimônia ${sessionId} tem estado de refinamento inconsistente no banco local. ` +
      "Apague o banco de cerimônias antes de continuar.",
  );
}

function toDumpState(
  sessionId: string,
  columns: Pick<
    SessionRow,
    "dumpStartedAt" | "dumpId" | "dumpMarkdown" | "dumpTasksMarkdown" | "dumpEstimate" | "dumpedAt"
  >,
): CeremonySession["dump"] {
  const { dumpStartedAt, dumpId, dumpMarkdown, dumpTasksMarkdown, dumpEstimate, dumpedAt } = columns;
  const hasNoInputs = dumpId === null
    && dumpMarkdown === null
    && dumpTasksMarkdown === null
    && dumpEstimate === null;
  if (hasNoInputs && dumpStartedAt === null && dumpedAt === null) return { status: "not-started" };

  const hasAllInputs = dumpId !== null
    && dumpMarkdown !== null
    && dumpTasksMarkdown !== null
    && dumpEstimate !== null;
  if (!hasAllInputs || (dumpedAt !== null && dumpStartedAt !== null)) {
    throw new CeremonyError(
      `a cerimônia ${sessionId} tem estado de despejo inconsistente no banco local. ` +
        "Apague o banco de cerimônias antes de continuar.",
    );
  }

  const inputs = {
    dumpId,
    markdown: dumpMarkdown,
    tasksMarkdown: dumpTasksMarkdown,
    estimate: dumpEstimate,
  };
  if (dumpedAt !== null) return { status: "completed", inputs, completedAt: dumpedAt };
  if (dumpStartedAt !== null) return { status: "publishing", inputs, startedAt: dumpStartedAt };
  return { status: "retryable", inputs };
}

/**
 * `CREATE TABLE IF NOT EXISTS` não corrige tabela de formato antigo: um banco
 * de qualquer versão anterior abriria calado e só quebraria numa consulta, no
 * meio da cerimônia. Como o banco é estado local descartável (ADR 0003), a
 * recusa na abertura, mandando apagar o arquivo, sai mais barata que migrar.
 */
function applySchema(sqlite: Database.Database, dbPath: string, logger?: Logger): void {
  const version = Number(sqlite.pragma("user_version", { simple: true }));

  // Banco novo abre em 0 e sem tabela nenhuma — só nesse caso o 0 não é o
  // `user_version` que uma versão anterior do Sprint Griller deixou para trás.
  const isNew =
    version === 0 && sqlite.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get() === undefined;

  if (!isNew && version !== SCHEMA_VERSION) {
    logger?.error(
      { dbPath, version, expectedVersion: SCHEMA_VERSION },
      "banco de cerimônia em versão incompatível",
    );
    throw new CeremonyError(
      `O banco de cerimônia está ${version === 0 ? "numa versão anterior" : `na versão ${version}`}` +
        `, e esta versão do Sprint Griller fala a ${SCHEMA_VERSION}. Apague o arquivo ` +
        `(ele guarda só estado de cerimônia) ou aponte SPRINT_GRILLER_DB para outro.`,
    );
  }

  sqlite.exec(SCHEMA_DDL);
  sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
}

type QuestionRow = typeof questions.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;
type ConsultationRow = typeof consultations.$inferSelect;
type RefinementItemRow = typeof refinementItems.$inferSelect;
type SpecArtifactRow = typeof specArtifacts.$inferSelect;
type TicketArtifactRow = typeof ticketArtifacts.$inferSelect;
type ParsedTranscriptEvent = z.infer<typeof transcriptEventSchema>;

const LEGACY_UNVERIFIED_REASON = "a citação não fechou com o código.";

function toSpecArtifact(row: SpecArtifactRow): SpecArtifact {
  const approvalColumns = [
    row.approvedRevision,
    row.approvedHash,
    row.approvedMarkdown,
    row.approvedAt,
  ];
  const hasApproval = approvalColumns.every((value) => value !== null);
  if (!hasApproval && approvalColumns.some((value) => value !== null)) {
    throw new CeremonyError(`a Spec da cerimônia ${row.sessionId} tem aprovação inconsistente.`);
  }
  return {
    revision: row.revision,
    submission: parseStoredSpecSubmission(row.submission),
    markdown: row.markdown,
    submittedAt: row.submittedAt,
    approval: hasApproval
      ? {
          revision: row.approvedRevision!,
          hash: row.approvedHash!,
          markdown: row.approvedMarkdown!,
          approvedAt: row.approvedAt!,
        }
      : null,
  };
}

function toTicketArtifact(row: TicketArtifactRow): TicketArtifact {
  const approvalColumns = [
    row.approvedRevision,
    row.approvedHash,
    row.approvedMarkdown,
    row.approvedSpecRevision,
    row.approvedSpecHash,
    row.approvedAt,
  ];
  const hasApproval = approvalColumns.every((value) => value !== null);
  if (!hasApproval && approvalColumns.some((value) => value !== null)) {
    throw new CeremonyError(`os Tickets da cerimônia ${row.sessionId} têm aprovação inconsistente.`);
  }
  return {
    revision: row.revision,
    submission: parseStoredTicketsSubmission(row.submission),
    markdown: row.markdown,
    submittedAt: row.submittedAt,
    specRevision: row.specRevision,
    specHash: row.specHash,
    approval: hasApproval
      ? {
          revision: row.approvedRevision!,
          hash: row.approvedHash!,
          markdown: row.approvedMarkdown!,
          specRevision: row.approvedSpecRevision!,
          specHash: row.approvedSpecHash!,
          approvedAt: row.approvedAt!,
        }
      : null,
  };
}

function normalizeTranscriptEvent(
  event: ParsedTranscriptEvent,
  getConsultationMotivo: (consultationId: string) => string | null | undefined,
): TranscriptEvent {
  if (event.kind !== "resposta-factual") return event;

  if (event.verificada) {
    return {
      kind: "resposta-factual",
      consultationId: event.consultationId,
      answer: event.answer,
      citations: event.citations,
      verificada: true,
    };
  }

  return {
    kind: "resposta-factual",
    consultationId: event.consultationId,
    answer: event.answer,
    citations: event.citations,
    verificada: false,
    motivo:
      event.motivo ?? getConsultationMotivo(event.consultationId) ?? LEGACY_UNVERIFIED_REASON,
  };
}

function toQuestion(row: QuestionRow): PersistedCeremonyQuestion {
  return {
    questionSeq: row.seq,
    id: row.questionId,
    agendaItemId: row.agendaItemId,
    source: row.source,
    header: row.header,
    question: row.question,
    recommendation: row.recommendation,
    evidence: evidenceSchema.parse(JSON.parse(row.evidence)),
    options: optionsSchema.parse(JSON.parse(row.options)),
    allowFreeText: row.allowFreeText,
  };
}

type RefinementResolutionColumns = Pick<
  RefinementItemRow,
  "resolutionKind" | "answer" | "recommendation" | "citations" | "justification" | "resolvedAt"
>;

function requiredText(value: string, message: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new CeremonyError(message);
  return normalized;
}

function refinementResolutionColumns(
  transition: RefinementItemTransition,
  resolvedAt: number,
): RefinementResolutionColumns {
  if (!("resolution" in transition)) {
    return {
      resolutionKind: null,
      answer: null,
      recommendation: null,
      citations: null,
      justification: null,
      resolvedAt: null,
    };
  }

  if (transition.resolution.kind === "fato") {
    return {
      resolutionKind: "fato",
      answer: requiredText(transition.resolution.answer, "a resolução factual precisa de resposta."),
      recommendation: null,
      citations: JSON.stringify(citationsSchema.parse(transition.resolution.citations)),
      justification: null,
      resolvedAt,
    };
  }
  if (transition.resolution.kind === "escolha") {
    return {
      resolutionKind: "escolha",
      answer: requiredText(transition.resolution.answer, "a escolha da sala precisa de resposta."),
      recommendation: requiredText(
        transition.resolution.recommendation,
        "a escolha da sala precisa preservar a recomendação do agente.",
      ),
      citations: null,
      justification: null,
      resolvedAt,
    };
  }
  return {
    resolutionKind: "fora-de-escopo",
    answer: null,
    recommendation: null,
    citations: null,
    justification: requiredText(
      transition.resolution.justification,
      "um item fora de escopo precisa de justificativa.",
    ),
    resolvedAt,
  };
}

function toRefinementItem(row: RefinementItemRow): RefinementItem {
  const base = {
    id: row.itemId,
    question: row.question,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.status === "aberto" || row.status === "pesquisando" || row.status === "aguardando-sala") {
    return { ...base, status: row.status };
  }

  const resolvedAt = row.resolvedAt;
  if (resolvedAt === null) throw invalidRefinementItem(row);
  if (row.status === "fora-de-escopo") {
    if (row.resolutionKind !== "fora-de-escopo" || row.justification === null) {
      throw invalidRefinementItem(row);
    }
    return {
      ...base,
      status: "fora-de-escopo",
      resolution: { kind: "fora-de-escopo", justification: row.justification, resolvedAt },
    };
  }
  if (row.status !== "resolvido") throw invalidRefinementItem(row);
  if (row.resolutionKind === "fato" && row.answer !== null && row.citations !== null) {
    return {
      ...base,
      status: "resolvido",
      resolution: {
        kind: "fato",
        answer: row.answer,
        citations: citationsSchema.parse(JSON.parse(row.citations)),
        resolvedAt,
      },
    };
  }
  if (row.resolutionKind === "escolha" && row.answer !== null && row.recommendation !== null) {
    return {
      ...base,
      status: "resolvido",
      resolution: {
        kind: "escolha",
        answer: row.answer,
        recommendation: row.recommendation,
        resolvedAt,
      },
    };
  }
  throw invalidRefinementItem(row);
}

function invalidRefinementItem(row: RefinementItemRow): CeremonyError {
  return new CeremonyError(
    `o item ${row.itemId} da agenda tem resolução inconsistente no banco local. ` +
      "Apague o banco de cerimônias antes de continuar.",
  );
}

/**
 * A linha guarda os campos das quatro variantes lado a lado (é SQL), então a
 * volta para o domínio é onde o estado impossível deixa de existir: quem lê uma
 * Consulta `respondida` tem `answer` e `citations`, e ponto.
 */
function toConsultation(row: ConsultationRow): CeremonyConsultation {
  const asked = { id: String(row.seq), question: row.question, askedAt: row.askedAt };
  if (row.status === "buscando") return { ...asked, status: "buscando" };

  const answeredAt = row.answeredAt ?? row.askedAt;
  if (row.status === "falhou") {
    return {
      ...asked,
      status: "falhou",
      message: row.message ?? "a consulta não devolveu resposta.",
      answeredAt,
    };
  }

  if (row.status === "precisa-sala") {
    return {
      ...asked,
      status: "precisa-sala",
      question: row.question,
      recommendation: row.recommendation ?? "",
      evidence: evidenceSchema.parse(JSON.parse(row.evidence ?? "[]")),
      options: optionsSchema.parse(JSON.parse(row.options ?? "[]")),
      allowFreeText: row.allowFreeText ?? true,
      answeredAt,
    };
  }

  const answer = row.answer ?? "";
  const citations = citationsSchema.parse(JSON.parse(row.citations ?? "[]"));

  return row.status === "respondida"
    ? { ...asked, status: "respondida", answer, citations, answeredAt }
    : {
        ...asked,
        status: "sem-lastro",
        answer,
        citations,
        motivo: row.motivo ?? "a citação não fechou com o código.",
        answeredAt,
      };
}

function isUnverifiedConsultation(
  consultation: CeremonyConsultation,
): consultation is UnverifiedConsultation {
  return consultation.status === "sem-lastro";
}

function isVerifiedConsultation(
  consultation: CeremonyConsultation,
): consultation is VerifiedConsultation {
  return consultation.status === "respondida";
}

function isUnresolvedConsultation(
  consultation: CeremonyConsultation,
): consultation is UnresolvedConsultation {
  return consultation.status !== "respondida";
}

function toDecision(row: DecisionRow): CeremonyDecision {
  return {
    questionSeq: row.questionSeq,
    questionId: row.questionId,
    question: row.question,
    recommendation: row.recommendation,
    answer: row.answer,
    decidedAt: row.decidedAt,
    ...(row.recordId == null ? {} : { recordId: row.recordId }),
    ...(row.recordUrl == null ? {} : { recordUrl: row.recordUrl }),
  };
}
