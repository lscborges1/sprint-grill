import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  createdAt: integer("created_at").notNull(),
  status: text("status", { enum: ["ativa", "encerrada", "falhou"] }).notNull(),
  failureMessage: text("failure_message"),
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
  },
  (table) => [index("decisions_por_sessao").on(table.sessionId)],
);

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
 * Sobe junto com qualquer mudança nas tabelas acima. Banco de versão diferente
 * é recusado na abertura, com a mensagem mandando apagar o arquivo — descobrir
 * a divergência no meio de uma cerimônia seria o pior momento possível.
 */
export const SCHEMA_VERSION = 1;

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
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  failure_message TEXT
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
  decided_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_por_sessao ON decisions (session_id);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  session_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_por_sessao ON events (session_id);
`;
