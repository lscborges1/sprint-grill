import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Estado de cerimônia, e só ele ([ADR 0003](../../../docs/adr/0003-azure-devops-como-fonte-da-verdade.md)):
 * sessão, perguntas, Registros de decisão e transcript. Nada aqui é fonte da
 * verdade — depois do despejo o arquivo pode sumir sem perda.
 */

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  storyId: integer("story_id").notNull(),
  storyTitle: text("story_title").notNull(),
  storyUrl: text("story_url").notNull(),
  investigationMarkdown: text("investigation_markdown").notNull(),
  timeZone: text("time_zone").notNull(),
  createdAt: integer("created_at").notNull(),
  status: text("status", { enum: ["ativa", "encerrada", "falhou"] }).notNull(),
  failureMessage: text("failure_message"),
  dumpStartedAt: integer("dump_started_at"),
  /** Fingerprint do despejo: sobrevive ao abort para o retry não criar Tasks duplicadas. */
  dumpId: text("dump_id"),
  /** Spec assinada no beginDump — editar depois mudaria o fingerprint e travaria o retry. */
  dumpMarkdown: text("dump_markdown"),
  /** Markdown de Tasks assinado no beginDump — sobrevive ao F5 para o retry hashear igual. */
  dumpTasksMarkdown: text("dump_tasks_markdown"),
  /** Estimativa assinada no beginDump — mesma razão do Markdown de Tasks. */
  dumpEstimate: real("dump_estimate"),
  dumpedAt: integer("dumped_at"),
});

export const questions = sqliteTable(
  "questions",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    // O id que o agente deu à pergunta: é a chave da resposta no `ask_operator`.
    questionId: text("question_id").notNull(),
    header: text("header").notNull(),
    question: text("question").notNull(),
    recommendation: text("recommendation").notNull(),
    evidence: text("evidence").notNull(),
    options: text("options").notNull(),
    allowFreeText: integer("allow_free_text", { mode: "boolean" }).notNull(),
    askedAt: integer("asked_at").notNull(),
    // `abandonada`: o turno que perguntou morreu com o processo.
    status: text("status", { enum: ["aberta", "respondida", "abandonada"] }).notNull(),
  },
  (table) => [index("questions_por_sessao").on(table.sessionId, table.status)],
);

export const decisions = sqliteTable(
  "decisions",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    questionSeq: integer("question_seq").notNull(),
    questionId: text("question_id").notNull(),
    question: text("question").notNull(),
    recommendation: text("recommendation").notNull(),
    answer: text("answer").notNull(),
    decidedBy: text("decided_by").notNull(),
    decidedAt: integer("decided_at").notNull(),
    recordId: integer("record_id"),
    recordUrl: text("record_url"),
  },
  (table) => [index("decisions_por_sessao").on(table.sessionId)],
);

/**
 * Consultas factuais respondidas ao vivo. Tabela à parte de `decisions` de
 * propósito: fato que o agente leu no código e decisão que a sala tomou são
 * artefatos diferentes, e misturá-los é exatamente o que o produto evita.
 */
export const consultations = sqliteTable(
  "consultations",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    question: text("question").notNull(),
    askedAt: integer("asked_at").notNull(),
    status: text("status", {
      enum: ["buscando", "respondida", "sem-lastro", "falhou"],
    }).notNull(),
    answer: text("answer"),
    /** JSON das citações; nulo enquanto a resposta não chega. */
    citations: text("citations"),
    /** Por que a citação não fechou, em `sem-lastro`. */
    motivo: text("motivo"),
    /** Por que não houve resposta, em `falhou`. */
    message: text("message"),
    answeredAt: integer("answered_at"),
  },
  (table) => [index("consultations_por_sessao").on(table.sessionId)],
);

/**
 * A edição do Operador sobre o Markdown do despejo — uma por sessão. Fica aqui,
 * e não em memória, porque a promessa da aba Dossiê é sobreviver ao F5.
 */
export const specDrafts = sqliteTable("spec_drafts", {
  sessionId: text("session_id").primaryKey(),
  markdown: text("markdown").notNull(),
  // O texto gerado de que a edição partiu: é como o Dossiê percebe que a
  // cerimônia andou desde então, em vez de despejar um documento desatualizado.
  base: text("base").notNull(),
  savedAt: integer("saved_at").notNull(),
});

export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    at: integer("at").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [index("events_por_sessao").on(table.sessionId)],
);

/**
 * Sobe junto com qualquer mudança nas tabelas acima. Qualquer versão anterior é
 * recusada na abertura, mandando apagar o arquivo — descobrir a divergência no
 * meio de uma cerimônia seria o pior momento possível.
 */
export const SCHEMA_VERSION = 11;

/**
 * ponytail: o schema é aplicado assim, e não por migration do drizzle-kit,
 * porque o caminho da pasta de migrations não sobrevive ao bundle do Next
 * (`import.meta.url` aponta para o chunk, não para o fonte). A duplicação com
 * as tabelas acima é segurada pelos testes do store, que passam por cada
 * coluna via drizzle — coluna divergente quebra em SQL, não em silêncio.
 * Quando o app tiver build próprio, trocar por `drizzle-kit generate` + `migrate()`.
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  story_id INTEGER NOT NULL,
  story_title TEXT NOT NULL,
  story_url TEXT NOT NULL,
  investigation_markdown TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  failure_message TEXT,
  dump_started_at INTEGER,
  dump_id TEXT,
  dump_markdown TEXT,
  dump_tasks_markdown TEXT,
  dump_estimate REAL,
  dumped_at INTEGER
);

CREATE TABLE IF NOT EXISTS questions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  header TEXT NOT NULL,
  question TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  evidence TEXT NOT NULL,
  options TEXT NOT NULL,
  allow_free_text INTEGER NOT NULL,
  asked_at INTEGER NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_por_sessao ON questions (session_id, status);

CREATE TABLE IF NOT EXISTS decisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  session_id TEXT NOT NULL,
  question_seq INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  question TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  answer TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  record_id INTEGER,
  record_url TEXT
);
CREATE INDEX IF NOT EXISTS decisions_por_sessao ON decisions (session_id);

CREATE TABLE IF NOT EXISTS consultations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  session_id TEXT NOT NULL,
  question TEXT NOT NULL,
  asked_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  answer TEXT,
  citations TEXT,
  motivo TEXT,
  message TEXT,
  answered_at INTEGER
);
CREATE INDEX IF NOT EXISTS consultations_por_sessao ON consultations (session_id);

CREATE TABLE IF NOT EXISTS spec_drafts (
  session_id TEXT PRIMARY KEY NOT NULL,
  markdown TEXT NOT NULL,
  base TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  session_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_por_sessao ON events (session_id);
`;
