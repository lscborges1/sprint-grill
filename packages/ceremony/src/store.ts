import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "@sprint-griller/core";
import Database from "better-sqlite3";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import { CeremonyError } from "./ceremony-error";
import {
  SCHEMA_DDL,
  SCHEMA_VERSION,
  consultations,
  decisions,
  events,
  questions,
  sessions,
  specDrafts,
} from "./schema";
import type {
  CeremonyCitation,
  CeremonyConsultation,
  CeremonyDecision,
  CeremonyQuestion,
  PersistedCeremonyQuestion,
  CeremonySession,
  ConsultationOutcome,
  SpecDraft,
  TranscriptEntry,
  TranscriptEvent,
  UnverifiedConsultation,
  VerifiedConsultation,
} from "./types";

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
  readonly decidedBy: string;
  /** Referência preenchida quando o Registro de decisão é despejado no ADO. */
  readonly recordId?: number | null;
  readonly recordUrl?: string | null;
}

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

export type FinishSessionOutcome =
  | { readonly status: "encerrada" }
  | { readonly status: "falhou"; readonly message: string };

/**
 * A única porta do estado de cerimônia. `recordDecision` é a única escrita em
 * `decisions` do repositório inteiro — e ela exige `decidedBy`, que só o
 * formulário do Palco tem. É assim que "nenhum Registro de decisão sem humano"
 * deixa de ser promessa de prompt e vira tipo.
 */
export interface CeremonyStore {
  createSession(input: CreateSessionInput): CeremonySession;
  getSession(sessionId: string): CeremonySession | undefined;
  findOpenSessionByStory(storyId: number): CeremonySession | undefined;
  finishSession(sessionId: string, outcome: FinishSessionOutcome): void;
  askQuestions(sessionId: string, asked: readonly CeremonyQuestion[]): void;
  currentQuestion(sessionId: string): PersistedCeremonyQuestion | undefined;
  listOpenQuestions(sessionId: string): readonly PersistedCeremonyQuestion[];
  unansweredQuestions(sessionId: string): readonly CeremonyQuestion[];
  abandonPendingQuestions(sessionId: string): void;
  recordDecision(input: RecordDecisionInput): CeremonyDecision;
  countDecisions(sessionId: string): number;
  lastDecision(sessionId: string): CeremonyDecision | undefined;
  listDecisions(sessionId: string): readonly CeremonyDecision[];
  /**
   * Abre uma Consulta factual. Não tem `decidedBy` porque não é decisão: quem
   * responde é o repositório. É a contraparte de `recordDecision`, e as duas
   * escritas nunca se cruzam.
   */
  openConsultation(sessionId: string, question: string): CeremonyConsultation;
  answerConsultation(consultationId: string, outcome: ConsultationOutcome): void;
  lastConsultation(sessionId: string): CeremonyConsultation | undefined;
  /** Respostas ao vivo que passaram pela checagem e entram como impacto conhecido. */
  listVerifiedConsultations(sessionId: string): readonly VerifiedConsultation[];
  /** Respostas ao vivo que precisam constar como hipótese, não como fato. */
  listUnverifiedConsultations(sessionId: string): readonly UnverifiedConsultation[];
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
    decidedBy: z.string(),
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

  const db = drizzle(sqlite);

  function requireSession(sessionId: string): CeremonySession {
    const session = store.getSession(sessionId);
    if (!session) throw new CeremonyError(`cerimônia ${sessionId} não existe.`);
    return session;
  }

  const store: CeremonyStore = {
    createSession(input) {
      const session: CeremonySession = {
        ...input,
        createdAt: Date.now(),
        status: "ativa",
        failureMessage: null,
      };
      db.insert(sessions).values(session).run();
      return session;
    },

    getSession(sessionId) {
      return db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    },

    findOpenSessionByStory(storyId) {
      return db
        .select()
        .from(sessions)
        .where(and(eq(sessions.storyId, storyId), eq(sessions.status, "ativa")))
        .orderBy(desc(sessions.createdAt))
        .get();
    },

    finishSession(sessionId, outcome) {
      db.update(sessions)
        .set({
          status: outcome.status,
          failureMessage: outcome.status === "falhou" ? outcome.message : null,
        })
        .where(eq(sessions.id, sessionId))
        .run();
    },

    askQuestions(sessionId, asked) {
      requireSession(sessionId);
      if (asked.length === 0) return;

      const askedAt = Date.now();
      db.transaction((tx) => {
        for (const question of asked) {
          tx.insert(questions)
            .values({
              sessionId,
              questionId: question.id,
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
      db.update(questions)
        .set({ status: "abandonada" })
        .where(and(eq(questions.sessionId, sessionId), eq(questions.status, "aberta")))
        .run();
    },

    recordDecision({ sessionId, questionId, answer, decidedBy, recordId, recordUrl }) {
      const who = decidedBy.trim();
      if (who === "") throw new CeremonyError("registre quem decidiu antes de gravar a decisão.");

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
        decidedBy: who,
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
            decidedBy: decision.decidedBy,
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
              decidedBy: decision.decidedBy,
            } satisfies TranscriptEvent),
          })
          .run();
      });

      return decision;
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
      requireSession(sessionId);

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

      const answeredAt = Date.now();
      db.transaction((tx) => {
        tx.update(consultations)
          .set({
            status: outcome.status,
            answer: outcome.status === "falhou" ? null : outcome.answer,
            citations: outcome.status === "falhou" ? null : JSON.stringify(outcome.citations),
            motivo: outcome.status === "sem-lastro" ? outcome.motivo : null,
            message: outcome.status === "falhou" ? outcome.message : null,
            answeredAt,
          })
          .where(eq(consultations.seq, seq))
          .run();

        // Consulta que não chegou a responder não deixa fato no transcript: o
        // registro é do que o código respondeu, não do que se tentou perguntar.
        if (outcome.status === "falhou") return;

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

    appendEvent(sessionId, event) {
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
      requireSession(sessionId);

      // Só valida vazio: `.trim()` no conteúdo apagaria Markdown legítimo
      // (ex.: bloco de código indentado na primeira linha).
      if (markdown.trim() === "") {
        throw new CeremonyError("a Spec da US não pode ficar vazia — regenere o documento.");
      }

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
type ParsedTranscriptEvent = z.infer<typeof transcriptEventSchema>;

const LEGACY_UNVERIFIED_REASON = "a citação não fechou com o código.";

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
    header: row.header,
    question: row.question,
    recommendation: row.recommendation,
    evidence: evidenceSchema.parse(JSON.parse(row.evidence)),
    options: optionsSchema.parse(JSON.parse(row.options)),
    allowFreeText: row.allowFreeText,
  };
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

function toDecision(row: DecisionRow): CeremonyDecision {
  return {
    questionSeq: row.questionSeq,
    questionId: row.questionId,
    question: row.question,
    recommendation: row.recommendation,
    answer: row.answer,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    ...(row.recordId == null ? {} : { recordId: row.recordId }),
    ...(row.recordUrl == null ? {} : { recordUrl: row.recordUrl }),
  };
}
