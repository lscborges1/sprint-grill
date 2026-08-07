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
} from "./schema";
import type {
  CeremonyCitation,
  CeremonyConsultation,
  CeremonyDecision,
  CeremonyQuestion,
  PersistedCeremonyQuestion,
  CeremonySession,
  ConsultationOutcome,
  TranscriptEntry,
  TranscriptEvent,
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
}

export interface RecordDecisionInput {
  readonly sessionId: string;
  readonly questionId: string;
  readonly answer: string;
  readonly decidedBy: string;
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
  appendEvent(sessionId: string, event: TranscriptEvent): void;
  listTranscript(sessionId: string): readonly TranscriptEntry[];
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

    abandonPendingQuestions(sessionId) {
      db.update(questions)
        .set({ status: "abandonada" })
        .where(and(eq(questions.sessionId, sessionId), eq(questions.status, "aberta")))
        .run();
    },

    recordDecision({ sessionId, questionId, answer, decidedBy }) {
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
      };

      db.transaction((tx) => {
        tx.update(questions).set({ status: "respondida" }).where(eq(questions.seq, pending.seq)).run();
        tx.insert(decisions)
          .values({ sessionId, ...decision })
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

    close() {
      sqlite.close();
    },
  };

  return store;
}

/**
 * `CREATE TABLE IF NOT EXISTS` não corrige tabela de formato antigo: sem esta
 * checagem, um banco de uma versão anterior abriria calado e só quebraria numa
 * consulta, no meio da cerimônia. O arquivo é estado local descartável, então a
 * saída honesta é mandar apagá-lo.
 */
function applySchema(sqlite: Database.Database, dbPath: string, logger?: Logger): void {
  const version = Number(sqlite.pragma("user_version", { simple: true }));

  // 0 é banco novo (ou de antes desta checagem, com o mesmo formato).
  if (version !== 0 && version !== SCHEMA_VERSION) {
    logger?.error(
      { dbPath, version, expectedVersion: SCHEMA_VERSION },
      "banco de cerimônia em versão incompatível",
    );
    throw new CeremonyError(
      `O banco de cerimônia está na versão ${version}, e esta versão do ` +
        `Sprint Griller fala a ${SCHEMA_VERSION}. Apague o arquivo (ele guarda só ` +
        `estado de cerimônia) ou aponte SPRINT_GRILLER_DB para outro.`,
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

function toDecision(row: DecisionRow): CeremonyDecision {
  return {
    questionSeq: row.questionSeq,
    questionId: row.questionId,
    question: row.question,
    recommendation: row.recommendation,
    answer: row.answer,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
  };
}
