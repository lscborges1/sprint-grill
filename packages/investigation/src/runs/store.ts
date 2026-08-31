import { mkdirSync } from "node:fs";
import path from "node:path";
import type { StoryDetails } from "@sprint-griller/ado-client";
import type { Logger } from "@sprint-griller/core";
import Database from "better-sqlite3";
import type { InvestigationOutcome } from "../investigate";
import type {
  InvestigationRun,
  InvestigationStatus,
  Publication,
  ReportRun,
  RunSummary,
} from "./types";

export const INVESTIGATIONS_SCHEMA_VERSION = 1;

/**
 * Estado dos runs de Investigação ([ADR 0005](../../../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md)):
 * fila do preparo, turnos em curso, relatórios e publicações locais. Não é
 * fonte da verdade — o que diz se uma US está investigada é o artefato no Azure
 * DevOps ([ADR 0003](../../../../docs/adr/0003-azure-devops-como-fonte-da-verdade.md)).
 * Um run por US: o atual na linha, o anterior embutido como `previous`.
 */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS runs (
  story_id INTEGER PRIMARY KEY NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  story_json TEXT,
  story_rev INTEGER,
  queued_rev INTEGER,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  report_json TEXT,
  markdown TEXT,
  violations_json TEXT,
  message TEXT,
  previous_json TEXT,
  publication_json TEXT
);
`;

export const ORPHANED_RUN_MESSAGE =
  "O processo foi reiniciado no meio deste turno — a Investigação não " +
  "continuou. Redispare quando quiser; nada foi publicado.";

export class InvestigationsDbError extends Error {}

interface RunRow {
  readonly story_id: number;
  readonly origin: "operador" | "automatico";
  readonly status: InvestigationStatus;
  readonly story_json: string | null;
  readonly story_rev: number | null;
  readonly queued_rev: number | null;
  readonly started_at: number;
  readonly finished_at: number | null;
  readonly report_json: string | null;
  readonly markdown: string | null;
  readonly violations_json: string | null;
  readonly message: string | null;
  readonly previous_json: string | null;
  readonly publication_json: string | null;
}

export interface InvestigationsStore {
  get(storyId: number): InvestigationRun | undefined;
  listSummaries(): Map<number, RunSummary>;
  oldestAguardando(): InvestigationRun | undefined;
  replace(run: InvestigationRun): void;
  close(): void;
}

export function openInvestigationsStore(
  dbPath: string,
  options: { readonly logger?: Logger } = {},
): InvestigationsStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  applySchema(sqlite, dbPath, options.logger);

  // Um turno vive só no processo que o disparou. Run `em-andamento` num banco
  // que acabou de abrir é órfão de um processo morto: vira falha explícita,
  // com retomada segura pelo disparo — nunca um turno fantasma "rodando".
  const recovered = sqlite
    .prepare(
      "UPDATE runs SET status = 'falhou', finished_at = ?, message = ? " +
        "WHERE status = 'em-andamento'",
    )
    .run(Date.now(), ORPHANED_RUN_MESSAGE);
  if (recovered.changes > 0) {
    options.logger?.warn(
      { runs: recovered.changes },
      "runs órfãos marcados como falhos na recuperação",
    );
  }

  const insert = sqlite.prepare(
    "INSERT OR REPLACE INTO runs (" +
      "story_id, origin, status, story_json, story_rev, queued_rev, " +
      "started_at, finished_at, report_json, markdown, violations_json, " +
      "message, previous_json, publication_json" +
      ") VALUES (" +
      ":story_id, :origin, :status, :story_json, :story_rev, :queued_rev, " +
      ":started_at, :finished_at, :report_json, :markdown, :violations_json, " +
      ":message, :previous_json, :publication_json)",
  );
  const selectById = sqlite.prepare(
    "SELECT * FROM runs WHERE story_id = ?",
  );
  const selectOldestQueued = sqlite.prepare(
    "SELECT * FROM runs WHERE status = 'aguardando' ORDER BY started_at ASC LIMIT 1",
  );
  const selectSummaries = sqlite.prepare(
    "SELECT story_id, status, story_rev, queued_rev FROM runs",
  );

  return {
    get(storyId) {
      const row = selectById.get(storyId) as RunRow | undefined;
      return row === undefined ? undefined : parseRun(row, dbPath);
    },

    listSummaries() {
      const summaries = new Map<number, RunSummary>();
      for (const row of selectSummaries.all() as readonly {
        story_id: number;
        status: InvestigationStatus;
        story_rev: number | null;
        queued_rev: number | null;
      }[]) {
        summaries.set(row.story_id, {
          status: row.status,
          storyRev: row.story_rev ?? undefined,
          queuedRev: row.queued_rev ?? undefined,
        });
      }
      return summaries;
    },

    oldestAguardando() {
      const row = selectOldestQueued.get() as RunRow | undefined;
      return row === undefined ? undefined : parseRun(row, dbPath);
    },

    replace(run) {
      insert.run(rowOf(run));
    },

    close() {
      sqlite.close();
    },
  };
}

function rowOf(run: InvestigationRun): RunRow {
  return {
    story_id: run.storyId,
    origin: run.origin,
    status: run.status,
    story_json: run.story === undefined ? null : JSON.stringify(run.story),
    story_rev: run.story?.rev ?? null,
    queued_rev: run.status === "aguardando" ? run.queuedRev ?? null : null,
    started_at: run.startedAt,
    finished_at: "finishedAt" in run ? run.finishedAt : null,
    report_json:
      "report" in run && run.report !== undefined
        ? JSON.stringify(run.report)
        : null,
    markdown: "markdown" in run ? run.markdown ?? null : null,
    violations_json:
      "violations" in run && run.violations !== undefined
        ? JSON.stringify(run.violations)
        : null,
    message: "message" in run ? run.message ?? null : null,
    previous_json:
      run.previous === undefined ? null : JSON.stringify(run.previous),
    publication_json:
      run.publication === undefined ? null : JSON.stringify(run.publication),
  };
}

/**
 * A linha volta a run sem revalidar schema do relatório: quem escreveu foi o
 * nosso serializador, no mesmo ciclo de vida do produto — payload de estado
 * local, não entrada de fora (mesmo contrato do transcript de cerimônia).
 */
function parseRun(row: RunRow, dbPath: string): InvestigationRun {
  const base = {
    storyId: row.story_id,
    origin: row.origin,
    story: (row.story_json === null
      ? undefined
      : (JSON.parse(row.story_json) as StoryDetails)),
    startedAt: row.started_at,
    previous: (row.previous_json === null
      ? undefined
      : (JSON.parse(row.previous_json) as ReportRun)) satisfies
      | ReportRun
      | undefined,
    publication: (row.publication_json === null
      ? undefined
      : (JSON.parse(row.publication_json) as Publication)) satisfies
      | Publication
      | undefined,
  };

  const outcome = outcomeOf(row, dbPath);
  if (row.status === "aguardando" || row.status === "em-andamento") {
    if (outcome !== undefined) throw corrupt(row.story_id, dbPath);
    if (row.status === "aguardando") {
      return { ...base, status: "aguardando", queuedRev: row.queued_rev ?? undefined };
    }
    return { ...base, status: "em-andamento" };
  }

  if (row.finished_at === null || outcome === undefined) {
    throw corrupt(row.story_id, dbPath);
  }
  return { ...base, finishedAt: row.finished_at, ...outcome };
}

function outcomeOf(
  row: RunRow,
  dbPath: string,
): (InvestigationOutcome & { readonly status: InvestigationStatus }) | undefined {
  switch (row.status) {
    // Estados sem resultado: o turno ainda não terminou (ou nem começou).
    case "aguardando":
    case "em-andamento":
      return undefined;
    case "falhou":
      if (row.message === null) throw corrupt(row.story_id, dbPath);
      return { status: "falhou", message: row.message };
    case "aprovado":
    case "reprovado": {
      if (row.report_json === null || row.markdown === null) {
        throw corrupt(row.story_id, dbPath);
      }
      const shared = {
        report: JSON.parse(row.report_json) as InvestigationOutcome extends never
          ? never
          : Extract<InvestigationOutcome, { status: "aprovado" | "reprovado" }>["report"],
        markdown: row.markdown,
      };
      if (row.status === "aprovado") return { status: "aprovado", ...shared };
      if (row.violations_json === null) throw corrupt(row.story_id, dbPath);
      return {
        status: "reprovado",
        ...shared,
        violations: JSON.parse(row.violations_json) as Extract<
          InvestigationOutcome,
          { status: "reprovado" }
        >["violations"],
      };
    }
    default:
      throw corrupt(row.story_id, dbPath);
  }
}

function corrupt(storyId: number, dbPath: string): InvestigationsDbError {
  return new InvestigationsDbError(
    `A linha do run da US #${storyId} em ${dbPath} não fecha com nenhum estado ` +
      `conhecido. Apague o arquivo (estado local descartável) ou aponte ` +
      `SPRINT_GRILLER_INVESTIGATIONS_DB para outro.`,
  );
}

/**
 * Mesmo contrato do banco de cerimônia: banco novo recebe o schema; banco de
 * versão diferente é recusado em vez de migrado — o arquivo é estado local
 * descartável, e uma migração silenciosa aqui valeria mais que a verdade dele.
 */
function applySchema(
  sqlite: Database.Database,
  dbPath: string,
  logger?: Logger,
): void {
  const version = Number(sqlite.pragma("user_version", { simple: true }));
  const isNew =
    version === 0 &&
    sqlite.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get() === undefined;

  if (!isNew && version !== INVESTIGATIONS_SCHEMA_VERSION) {
    logger?.error(
      { dbPath, version, expectedVersion: INVESTIGATIONS_SCHEMA_VERSION },
      "banco de investigações em versão incompatível",
    );
    throw new InvestigationsDbError(
      `O banco de investigações está ${
        version === 0 ? "numa versão anterior" : `na versão ${version}`
      }, e esta versão do Refina fala a ${INVESTIGATIONS_SCHEMA_VERSION}. ` +
        `Apague o arquivo (ele guarda só estado local de Investigação) ou ` +
        `aponte SPRINT_GRILLER_INVESTIGATIONS_DB para outro.`,
    );
  }

  sqlite.exec(SCHEMA_DDL);
  sqlite.pragma(`user_version = ${INVESTIGATIONS_SCHEMA_VERSION}`);
}
