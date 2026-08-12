import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION } from "./schema";
import { SPEC_SECTIONS } from "./spec-vocabulary";
import { openCeremonyStore } from "./store";
import type { CeremonyStore } from "./store";
import type { CeremonyQuestion } from "./types";

const opened: CeremonyStore[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (opened.length > 0) opened.pop()?.close();
});

function dbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-")), "cerimonias.db");
}

function open(file: string): CeremonyStore {
  const store = openCeremonyStore(file);
  opened.push(store);
  return store;
}

function newSession(store: CeremonyStore, id = "thread-1") {
  return store.createSession({
    id,
    storyId: 4242,
    storyTitle: "Exportar relatório de comissões",
    storyUrl: "https://dev.azure.com/org/proj/_workitems/edit/4242",
    investigationMarkdown: "## Furos da US\n\n- Sem regra de arredondamento.",
    timeZone: "UTC",
  });
}

const question = (overrides: Partial<CeremonyQuestion> = {}): CeremonyQuestion => ({
  id: "q1",
  header: "Arredondamento",
  question: "A comissão arredonda para cima ou segue a regra bancária?",
  recommendation: "Seguir a regra bancária, que é o que o cálculo de folha já usa.",
  evidence: ["core-api · src/payroll/rounding.ts"],
  options: [
    { label: "Regra bancária", description: "Igual à folha." },
    { label: "Para cima", description: "Favorece o vendedor." },
  ],
  allowFreeText: true,
  ...overrides,
});

function validSpec(note: string): string {
  return [
    `# ${note}`,
    ...Object.values(SPEC_SECTIONS).flatMap((section) => [
      `## ${section.heading}`,
      `${section.heading}: ${note}`,
    ]),
  ].join("\n\n");
}

const DUMP_DETAILS = {
  markdown: validSpec("Spec assinada"),
  tasksMarkdown: "## Task\n\nEntrega um slice vertical.\n\n### Critérios de aceite\n\n- Critério.",
  estimate: 5,
} as const;

function beginDump(
  store: CeremonyStore,
  sessionId = "thread-1",
  dumpId = "dump-fingerprint",
): void {
  store.beginDump(sessionId, { dumpId, ...DUMP_DETAILS });
}

describe("openCeremonyStore", () => {
  it("should expose only valid dump states through the full lifecycle", () => {
    const store = open(dbPath());

    expect(newSession(store).dump).toEqual({ status: "not-started" });

    beginDump(store);
    expect(store.getSession("thread-1")?.dump).toMatchObject({
      status: "publishing",
      inputs: { dumpId: "dump-fingerprint", ...DUMP_DETAILS },
      startedAt: expect.any(Number),
    });

    store.abortDump("thread-1");
    expect(store.getSession("thread-1")?.dump).toEqual({
      status: "retryable",
      inputs: { dumpId: "dump-fingerprint", ...DUMP_DETAILS },
    });

    beginDump(store);
    store.markDumpCompleted("thread-1");
    expect(store.getSession("thread-1")?.dump).toMatchObject({
      status: "completed",
      inputs: { dumpId: "dump-fingerprint", ...DUMP_DETAILS },
      completedAt: expect.any(Number),
    });
  });

  it("should reject an impossible persisted dump state with an actionable error", () => {
    const file = dbPath();
    const store = open(file);
    newSession(store);
    newSession(store, "thread-2");
    store.close();
    opened.pop();

    const database = new Database(file);
    database.prepare("UPDATE sessions SET dump_id = ? WHERE id = ?").run("partial", "thread-1");
    database.prepare("UPDATE sessions SET dump_started_at = ? WHERE id = ?").run(1, "thread-2");
    database.close();

    const reopened = open(file);

    expect(() => reopened.getSession("thread-1")).toThrow(
      /thread-1.*estado de despejo inconsistente.*Apague o banco/s,
    );
    expect(() => reopened.getSession("thread-2")).toThrow(
      /thread-2.*estado de despejo inconsistente.*Apague o banco/s,
    );
  });

  it("should return the same ceremony when the store is reopened on the same file", () => {
    const file = dbPath();

    const first = open(file);
    newSession(first);
    first.askQuestions("thread-1", [question()]);
    first.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });
    first.askQuestions("thread-1", [question({ id: "q2", question: "Entra nesta sprint?" })]);
    first.close();
    opened.pop();

    const reopened = open(file);

    expect(reopened.getSession("thread-1")?.storyTitle).toBe("Exportar relatório de comissões");
    expect(reopened.countDecisions("thread-1")).toBe(1);
    expect(reopened.currentQuestion("thread-1")?.id).toBe("q2");
  });

  it("should preserve a completed dump when the store is reopened", () => {
    const file = dbPath();
    const first = open(file);
    newSession(first);
    beginDump(first);
    first.markDumpCompleted("thread-1");
    first.close();
    opened.pop();

    const reopened = open(file);

    expect(reopened.getSession("thread-1")?.dump).toMatchObject({
      status: "completed",
      completedAt: expect.any(Number),
    });
  });

  it("should release a dump interrupted by a process restart", () => {
    const file = dbPath();
    const first = open(file);
    newSession(first);
    first.beginDump("thread-1", { dumpId: "dump-fingerprint", ...DUMP_DETAILS });
    first.close();
    opened.pop();

    const reopened = open(file);
    reopened.askQuestions("thread-1", [question()]);

    expect(reopened.currentQuestion("thread-1")?.id).toBe("q1");
    expect(reopened.getSession("thread-1")?.dump).toEqual({
      status: "retryable",
      inputs: { dumpId: "dump-fingerprint", ...DUMP_DETAILS },
    });
  });

  it("should keep the dump fingerprint and signed inputs after abort so a retry can reconcile", () => {
    const store = open(dbPath());
    newSession(store);
    beginDump(store);
    store.abortDump("thread-1");

    expect(store.getSession("thread-1")?.dump).toEqual({
      status: "retryable",
      inputs: { dumpId: "dump-fingerprint", ...DUMP_DETAILS },
    });

    beginDump(store);
    expect(store.getSession("thread-1")?.dump).toMatchObject({
      status: "publishing",
      startedAt: expect.any(Number),
    });
  });

  it("should refuse a retry that changes the dump fingerprint", () => {
    const store = open(dbPath());
    newSession(store);
    beginDump(store);
    store.abortDump("thread-1");

    expect(() => beginDump(store, "thread-1", "outro-fingerprint")).toThrow(/Spec|Tasks|estimativa/i);
    expect(store.getSession("thread-1")?.dump).toMatchObject({
      status: "retryable",
      inputs: { dumpId: "dump-fingerprint" },
    });
  });

  it("should refuse Spec edits after a partial dump freezes the signed inputs", () => {
    const store = open(dbPath());
    newSession(store);
    beginDump(store);
    store.abortDump("thread-1");

    expect(() =>
      store.saveSpecDraft({
        sessionId: "thread-1",
        markdown: "# Spec diferente",
        base: "gerado",
        expectedSavedAt: null,
      }),
    ).toThrow(/fingerprint|Spec assinada/i);
  });

  it("should find an incomplete dump for a story after abort", () => {
    const store = open(dbPath());
    newSession(store);
    store.finishSession("thread-1", { status: "encerrada" });
    beginDump(store);
    store.abortDump("thread-1");

    expect(store.findIncompleteDumpByStory(4242)?.id).toBe("thread-1");
  });

  it("should not treat a completed dump as incomplete", () => {
    const store = open(dbPath());
    newSession(store);
    beginDump(store);
    store.markDumpCompleted("thread-1");

    expect(store.findIncompleteDumpByStory(4242)).toBeUndefined();
  });

  it.each([0, 3])("should refuse a database written by the previous schema %s", (version) => {
    const file = dbPath();
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        story_id INTEGER NOT NULL,
        story_title TEXT NOT NULL,
        story_url TEXT NOT NULL,
        investigation_markdown TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        failure_message TEXT
      );
      INSERT INTO sessions
        (id, story_id, story_title, story_url, investigation_markdown, created_at, status)
      VALUES
        ('legacy', 4242, 'Histórico', 'https://example.test/4242', '## Furos', 1, 'ativa');
      PRAGMA user_version = ${version};
    `);
    legacy.close();

    expect(() => openCeremonyStore(file)).toThrow(/Apague o arquivo/);
  });

  it("should refuse a database written by another schema version instead of failing mid-ceremony", () => {
    const file = dbPath();
    newSession(open(file));
    const bumped = new Database(file);
    bumped.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    bumped.close();

    let thrown: unknown;
    try {
      openCeremonyStore(file);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/Apague o arquivo/);
    expect((thrown as Error).message).not.toContain(file);
  });

  it("should create the database file inside a directory that does not exist yet", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-")), "novo", "c.db");

    expect(() => newSession(open(file))).not.toThrow();
  });
});

describe("askQuestions", () => {
  it("should hand out questions in the order they were asked", () => {
    const store = open(dbPath());
    newSession(store);

    store.askQuestions("thread-1", [
      question({ id: "q1" }),
      question({ id: "q2", question: "Precisa de auditoria?" }),
    ]);

    expect(store.currentQuestion("thread-1")?.id).toBe("q1");
  });

  it("should keep evidence and options intact through the round trip", () => {
    const store = open(dbPath());
    newSession(store);

    store.askQuestions("thread-1", [question()]);

    expect(store.currentQuestion("thread-1")).toMatchObject(question());
    expect(store.currentQuestion("thread-1")?.questionSeq).toBe(1);
  });

  it("should skip questions that were already decided", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question({ id: "q1" }), question({ id: "q2" })]);

    store.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    expect(store.currentQuestion("thread-1")?.id).toBe("q2");
  });
});

describe("recordDecision", () => {
  it("should record who decided and when", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question()]);

    const decision = store.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO + squad",
    });

    expect(decision).toMatchObject({
      questionId: "q1",
      question: question().question,
      recommendation: question().recommendation,
      answer: "Regra bancária",
      decidedBy: "PO + squad",
    });
    expect(decision.decidedAt).toBeGreaterThan(0);
    expect(store.lastDecision("thread-1")).toEqual(decision);
  });

  it("should persist the Azure DevOps record reference with the decision", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question()]);

    const decision = store.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
      recordId: 99,
      recordUrl: "https://dev.azure.com/org/proj/_workitems/edit/99",
    });

    expect(decision).toMatchObject({
      recordId: 99,
      recordUrl: "https://dev.azure.com/org/proj/_workitems/edit/99",
    });
    expect(store.listDecisions("thread-1")[0]).toMatchObject({
      recordId: 99,
      recordUrl: "https://dev.azure.com/org/proj/_workitems/edit/99",
    });
  });

  it("should attach a decision record once so a later dump can skip it", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question()]);
    const decision = store.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    store.attachDecisionRecord({
      sessionId: "thread-1",
      questionSeq: decision.questionSeq,
      recordId: 99,
      recordUrl: "https://dev.azure.com/org/proj/_workitems/edit/4211",
    });

    expect(store.listDecisions("thread-1")[0]).toMatchObject({ recordId: 99 });
    expect(() =>
      store.attachDecisionRecord({
        sessionId: "thread-1",
        questionSeq: decision.questionSeq,
        recordId: 100,
        recordUrl: "https://dev.azure.com/org/proj/_workitems/edit/4211",
      }),
    ).toThrow(/já tem Registro/i);
  });

  it("should refuse a decision with no one behind it", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question()]);

    expect(() =>
      store.recordDecision({
        sessionId: "thread-1",
        questionId: "q1",
        answer: "Regra bancária",
        decidedBy: "   ",
      }),
    ).toThrow(/quem decidiu/i);
    expect(store.countDecisions("thread-1")).toBe(0);
  });

  it("should refuse an empty answer", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question()]);

    expect(() =>
      store.recordDecision({
        sessionId: "thread-1",
        questionId: "q1",
        answer: "  ",
        decidedBy: "PO",
      }),
    ).toThrow(/resposta/i);
  });

  it("should refuse to decide a question that was never asked", () => {
    const store = open(dbPath());
    newSession(store);

    expect(() =>
      store.recordDecision({
        sessionId: "thread-1",
        questionId: "fantasma",
        answer: "Sim",
        decidedBy: "PO",
      }),
    ).toThrow(/pergunta/i);
  });

  it("should write the decision into the transcript", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question()]);

    store.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    expect(store.listTranscript("thread-1").map((entry) => entry.event)).toEqual([
      { kind: "pergunta", questionId: "q1", question: question().question, recommendation: question().recommendation },
      { kind: "decisao", questionId: "q1", answer: "Regra bancária", decidedBy: "PO" },
    ]);
  });
});

describe("abandonPendingQuestions", () => {
  it("should drop questions whose turn died so the room is not asked twice", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question({ id: "q1" }), question({ id: "q2" })]);

    store.abandonPendingQuestions("thread-1");

    expect(store.currentQuestion("thread-1")).toBeUndefined();
    expect(store.countDecisions("thread-1")).toBe(0);
  });
});

describe("unansweredQuestions", () => {
  it("should list what the room still owes a decision on", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [
      question({ id: "q1" }),
      question({ id: "q2", question: "Entra nesta sprint?" }),
    ]);

    store.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    expect(store.unansweredQuestions("thread-1").map((asked) => asked.question)).toEqual([
      "Entra nesta sprint?",
    ]);
  });

  it("should keep a question abandoned by a crash pending, not answered", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question()]);

    store.abandonPendingQuestions("thread-1");

    expect(store.unansweredQuestions("thread-1")).toHaveLength(1);
  });

  it("should count a question asked again after a resume only once", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question({ id: "q1" })]);
    store.abandonPendingQuestions("thread-1");

    store.askQuestions("thread-1", [question({ id: "q1" })]);

    expect(store.unansweredQuestions("thread-1")).toHaveLength(1);
  });

  it("should keep distinct questions with the same wording pending", () => {
    const store = open(dbPath());
    newSession(store);
    const wording = "Qual é o comportamento esperado?";

    store.askQuestions("thread-1", [
      question({ id: "q1", question: wording }),
      question({ id: "q2", question: wording }),
    ]);

    expect(store.unansweredQuestions("thread-1").map((asked) => asked.id)).toEqual(["q1", "q2"]);
  });

  it("should keep a new question pending when an earlier question with that wording was answered", () => {
    const store = open(dbPath());
    newSession(store);
    const wording = "Qual é o comportamento esperado?";
    store.askQuestions("thread-1", [question({ id: "q1", question: wording })]);
    store.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "O novo comportamento",
      decidedBy: "PO",
    });

    store.askQuestions("thread-1", [question({ id: "q1", question: wording })]);

    expect(store.unansweredQuestions("thread-1").map((asked) => asked.id)).toEqual(["q1"]);
  });

  it("should drop an abandoned original once the resumed retry is answered", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question({ id: "q1" })]);
    store.abandonPendingQuestions("thread-1");

    store.askQuestions("thread-1", [question({ id: "q1" })]);
    store.recordDecision({
      sessionId: "thread-1",
      questionId: "q1",
      answer: "Regra bancária",
      decidedBy: "PO",
    });

    expect(store.unansweredQuestions("thread-1")).toHaveLength(0);
  });
});

describe("saveSpecDraft", () => {
  it("should hand back the edit the Operator saved after a restart", () => {
    const file = dbPath();
    const first = open(file);
    newSession(first);

    first.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("Fora de escopo: relatório mensal."),
      base: "# Spec da US #4242",
      expectedSavedAt: null,
    });
    first.close();
    opened.pop();

    expect(open(file).getSpecDraft("thread-1")).toMatchObject({
      markdown: validSpec("Fora de escopo: relatório mensal."),
      base: "# Spec da US #4242",
    });
  });

  it("should keep a single edit per ceremony, the last one", () => {
    const store = open(dbPath());
    newSession(store);

    const first = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("rascunho"),
      base: "gerado",
      expectedSavedAt: null,
    });
    store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("revisado"),
      base: "gerado",
      expectedSavedAt: first.savedAt,
    });

    expect(store.getSpecDraft("thread-1")?.markdown).toBe(validSpec("revisado"));
  });

  it("should assign distinct revisions when saves share the same clock tick", () => {
    const store = open(dbPath());
    newSession(store);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const first = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("primeiro"),
      base: "gerado",
      expectedSavedAt: null,
    });
    const second = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("segundo"),
      base: "gerado",
      expectedSavedAt: first.savedAt,
    });

    expect(second.savedAt).toBeGreaterThan(first.savedAt);
    expect(store.getSpecDraft("thread-1")?.savedAt).toBe(second.savedAt);
  });

  it("should reject a save from a stale revision without overwriting the newer edit", () => {
    const store = open(dbPath());
    newSession(store);
    const first = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("primeiro"),
      base: "gerado",
      expectedSavedAt: null,
    });
    store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("segunda aba"),
      base: "gerado",
      expectedSavedAt: first.savedAt,
    });

    expect(() =>
      store.saveSpecDraft({
        sessionId: "thread-1",
        markdown: validSpec("primeira aba atrasada"),
        base: "gerado",
        expectedSavedAt: first.savedAt,
      }),
    ).toThrow(/desatualizado/i);
    expect(store.getSpecDraft("thread-1")?.markdown).toBe(validSpec("segunda aba"));
  });

  it("should overwrite a stale revision only when explicitly confirmed", () => {
    const store = open(dbPath());
    newSession(store);
    const first = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("primeiro"),
      base: "gerado",
      expectedSavedAt: null,
    });
    store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("segunda aba"),
      base: "gerado",
      expectedSavedAt: first.savedAt,
    });

    store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("primeira aba confirmada"),
      base: "gerado",
      expectedSavedAt: first.savedAt,
      overwrite: true,
    });

    expect(store.getSpecDraft("thread-1")?.markdown).toBe(validSpec("primeira aba confirmada"));
  });

  it("should assign a revision above the one it overwrote when both land on the same tick", () => {
    const store = open(dbPath());
    newSession(store);
    const first = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("primeiro"),
      base: "gerado",
      expectedSavedAt: null,
    });
    const other = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("segunda aba"),
      base: "gerado",
      expectedSavedAt: first.savedAt,
    });
    vi.spyOn(Date, "now").mockReturnValue(other.savedAt);

    const confirmed = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("primeira aba confirmada"),
      base: "gerado",
      expectedSavedAt: first.savedAt,
      overwrite: true,
    });

    // Repetir a revisão sobrescrita esconderia o conflito da aba que a exibe.
    expect(confirmed.savedAt).toBeGreaterThan(other.savedAt);
    expect(store.getSpecDraft("thread-1")?.savedAt).toBe(confirmed.savedAt);
  });

  it("should refuse an empty Spec instead of letting the despejo write nothing", () => {
    const store = open(dbPath());
    newSession(store);

    expect(() =>
      store.saveSpecDraft({
        sessionId: "thread-1",
        markdown: "   \n ",
        base: "gerado",
        expectedSavedAt: null,
      }),
    ).toThrow(/vazia/i);
    expect(store.getSpecDraft("thread-1")).toBeUndefined();
  });

  it("should refuse a draft that removes mandatory Spec sections", () => {
    const store = open(dbPath());
    newSession(store);

    expect(() =>
      store.saveSpecDraft({
        sessionId: "thread-1",
        markdown: "# Nota",
        base: "gerado",
        expectedSavedAt: null,
      }),
    ).toThrow(/Decisões.*Contexto de impacto.*Não verificado.*Pendências.*Fora de escopo/s);
    expect(store.getSpecDraft("thread-1")).toBeUndefined();
  });

  it("should keep leading Markdown whitespace the Operator typed", () => {
    const store = open(dbPath());
    newSession(store);
    const markdown = `    code\n\n${validSpec("Spec")}`;

    store.saveSpecDraft({ sessionId: "thread-1", markdown, base: "gerado", expectedSavedAt: null });

    expect(store.getSpecDraft("thread-1")?.markdown).toBe(markdown);
  });

  it("should refuse an edit for a ceremony that does not exist", () => {
    const store = open(dbPath());

    expect(() =>
      store.saveSpecDraft({
        sessionId: "fantasma",
        markdown: "rascunho",
        base: "gerado",
        expectedSavedAt: null,
      }),
    ).toThrow(/não existe/i);
  });
});

describe("discardSpecDraft", () => {
  it("should drop the edit so the document goes back to what was generated", () => {
    const store = open(dbPath());
    newSession(store);
    const draft = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("rascunho"),
      base: "gerado",
      expectedSavedAt: null,
    });

    store.discardSpecDraft({ sessionId: "thread-1", expectedSavedAt: draft.savedAt });

    expect(store.getSpecDraft("thread-1")).toBeUndefined();
    expect(() =>
      store.discardSpecDraft({ sessionId: "thread-1", expectedSavedAt: draft.savedAt }),
    ).toThrow(/desatualizado/i);
  });

  it("should reject a discard from a stale revision", () => {
    const store = open(dbPath());
    newSession(store);
    const first = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("primeiro"),
      base: "gerado",
      expectedSavedAt: null,
    });
    const second = store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: validSpec("segunda aba"),
      base: "gerado",
      expectedSavedAt: first.savedAt,
    });

    expect(() =>
      store.discardSpecDraft({ sessionId: "thread-1", expectedSavedAt: first.savedAt }),
    ).toThrow(/desatualizado/i);
    expect(store.getSpecDraft("thread-1")?.savedAt).toBe(second.savedAt);
  });
});

describe("findOpenSessionByStory", () => {
  it("should find the open ceremony of a story", () => {
    const store = open(dbPath());
    newSession(store);

    expect(store.findOpenSessionByStory(4242)?.id).toBe("thread-1");
  });

  it("should not find a ceremony that already ended", () => {
    const store = open(dbPath());
    newSession(store);

    store.finishSession("thread-1", { status: "encerrada" });

    expect(store.findOpenSessionByStory(4242)).toBeUndefined();
    expect(store.getSession("thread-1")?.status).toBe("encerrada");
  });
});

describe("dump freeze", () => {
  it("should refuse invalid Spec Markdown before freezing dump inputs", () => {
    const store = open(dbPath());
    newSession(store);

    expect(() =>
      store.beginDump("thread-1", {
        dumpId: "dump-fingerprint",
        ...DUMP_DETAILS,
        markdown: "# Nota",
      }),
    ).toThrow(/Decisões.*Fora de escopo/s);
    expect(store.getSession("thread-1")?.dump).toEqual({ status: "not-started" });
  });

  it("should reject a decision after the dump has started", () => {
    const store = open(dbPath());
    newSession(store);
    store.askQuestions("thread-1", [question()]);
    store.beginDump("thread-1", { dumpId: "dump-fingerprint", ...DUMP_DETAILS });

    expect(() =>
      store.recordDecision({
        sessionId: "thread-1",
        questionId: "q1",
        answer: "Regra bancária",
        decidedBy: "PO",
      }),
    ).toThrow(/despejo/i);
  });

  it("should reject questions and consultations while dumping", () => {
    const store = open(dbPath());
    newSession(store);
    store.beginDump("thread-1", { dumpId: "dump-fingerprint", ...DUMP_DETAILS });

    expect(() => store.askQuestions("thread-1", [question()])).toThrow(/despejo/i);
    expect(() => store.openConsultation("thread-1", "Qual campo a API aceita?")).toThrow(/despejo/i);
  });

  it("should refuse completion when the decision revision changed", () => {
    const store = open(dbPath());
    newSession(store);
    store.beginDump("thread-1", { dumpId: "dump-fingerprint", ...DUMP_DETAILS });

    expect(() => store.markDumpCompleted("thread-1", 1)).toThrow(/conclusão/i);
    expect(store.getSession("thread-1")?.dump).toMatchObject({ status: "publishing" });
  });
});

describe("finishSession", () => {
  it("should keep the failure message of a broken ceremony", () => {
    const store = open(dbPath());
    newSession(store);

    store.finishSession("thread-1", { status: "falhou", message: "o agente caiu" });

    expect(store.getSession("thread-1")).toMatchObject({
      status: "falhou",
      failureMessage: "o agente caiu",
    });
  });
});

describe("consultations", () => {
  it("should open a consultation still looking for the answer", () => {
    const store = open(dbPath());
    newSession(store);

    const consultation = store.openConsultation("thread-1", "Quem mais consome o CreateOrder?");

    expect(consultation).toMatchObject({
      question: "Quem mais consome o CreateOrder?",
      status: "buscando",
    });
    expect(store.lastConsultation("thread-1")).toEqual(consultation);
  });

  it("should keep the answer with the citations that sustain it", () => {
    const store = open(dbPath());
    newSession(store);
    const { id } = store.openConsultation("thread-1", "Quem mais consome o CreateOrder?");

    store.answerConsultation(id, {
      status: "respondida",
      answer: "Só o checkout.",
      citations: [{ repo: "core-api", path: "src/api/order.ts", symbol: "createOrder" }],
    });

    expect(store.lastConsultation("thread-1")).toMatchObject({
      status: "respondida",
      answer: "Só o checkout.",
      citations: [{ repo: "core-api", path: "src/api/order.ts", symbol: "createOrder" }],
    });
  });

  it("should keep an answer whose citations did not check out marked as such", () => {
    const store = open(dbPath());
    newSession(store);
    const { id } = store.openConsultation("thread-1", "Existe cache?");

    store.answerConsultation(id, {
      status: "sem-lastro",
      answer: "Existe um cache em memória.",
      citations: [{ repo: "core-api", path: "src/cache.ts" }],
      motivo: 'core-api: o arquivo "src/cache.ts" não existe.',
    });

    expect(store.lastConsultation("thread-1")).toMatchObject({
      status: "sem-lastro",
      motivo: 'core-api: o arquivo "src/cache.ts" não existe.',
    });
  });

  it("should keep the failure of a consultation that never got an answer", () => {
    const store = open(dbPath());
    newSession(store);
    const { id } = store.openConsultation("thread-1", "Existe cache?");

    store.answerConsultation(id, { status: "falhou", message: "o agente caiu" });

    expect(store.lastConsultation("thread-1")).toMatchObject({
      status: "falhou",
      message: "o agente caiu",
    });
  });

  it("should hand out the most recent consultation of the session", () => {
    const store = open(dbPath());
    newSession(store);

    store.openConsultation("thread-1", "primeira");
    const segunda = store.openConsultation("thread-1", "segunda");

    expect(store.lastConsultation("thread-1")?.id).toBe(segunda.id);
  });

  it("should write the factual answer into the transcript, apart from any decision", () => {
    const store = open(dbPath());
    newSession(store);
    const { id } = store.openConsultation("thread-1", "Quem mais consome o CreateOrder?");

    store.answerConsultation(id, {
      status: "respondida",
      answer: "Só o checkout.",
      citations: [{ repo: "core-api", path: "src/api/order.ts" }],
    });

    expect(store.listTranscript("thread-1").map((entry) => entry.event)).toEqual([
      { kind: "consulta", consultationId: id, question: "Quem mais consome o CreateOrder?" },
      {
        kind: "resposta-factual",
        consultationId: id,
        answer: "Só o checkout.",
        citations: [{ repo: "core-api", path: "src/api/order.ts" }],
        verificada: true,
      },
    ]);
    expect(store.countDecisions("thread-1")).toBe(0);
  });

  it("should mark an unsustained answer as unverified in the transcript", () => {
    const store = open(dbPath());
    newSession(store);
    const { id } = store.openConsultation("thread-1", "Existe cache?");

    store.answerConsultation(id, {
      status: "sem-lastro",
      answer: "Existe um cache em memória.",
      citations: [],
      motivo: "sem citação nenhuma.",
    });

    expect(store.listTranscript("thread-1").at(-1)?.event).toMatchObject({
      kind: "resposta-factual",
      verificada: false,
      motivo: "sem citação nenhuma.",
    });
  });

  it("should preserve an earlier unverified reason after another consultation", () => {
    const store = open(dbPath());
    newSession(store);
    const first = store.openConsultation("thread-1", "Existe cache?");

    store.answerConsultation(first.id, {
      status: "sem-lastro",
      answer: "Existe um cache em memória.",
      citations: [],
      motivo: "sem citação nenhuma.",
    });

    const second = store.openConsultation("thread-1", "Quem chama o CreateOrder?");
    store.answerConsultation(second.id, {
      status: "respondida",
      answer: "Só o checkout.",
      citations: [{ repo: "core-api", path: "src/order.ts" }],
    });

    const firstAnswer = store
      .listTranscript("thread-1")
      .find(
        (entry) =>
          entry.event.kind === "resposta-factual" && entry.event.consultationId === first.id,
      );

    expect(firstAnswer?.event).toMatchObject({
      kind: "resposta-factual",
      verificada: false,
      motivo: "sem citação nenhuma.",
    });
  });

  it("should recover a missing legacy reason from the consultation row", () => {
    const file = dbPath();
    const store = open(file);
    newSession(store);
    const consultation = store.openConsultation("thread-1", "Existe cache?");

    store.answerConsultation(consultation.id, {
      status: "sem-lastro",
      answer: "Existe um cache em memória.",
      citations: [],
      motivo: "sem citação nenhuma.",
    });

    const database = new Database(file);
    database
      .prepare("UPDATE events SET payload = json_remove(payload, '$.motivo') WHERE kind = ?")
      .run("resposta-factual");
    database.close();

    expect(store.listTranscript("thread-1").at(-1)?.event).toMatchObject({
      kind: "resposta-factual",
      verificada: false,
      motivo: "sem citação nenhuma.",
    });
  });

  it("should refuse a consultation with no question behind it", () => {
    const store = open(dbPath());
    newSession(store);

    expect(() => store.openConsultation("thread-1", "   ")).toThrow(/pergunta/i);
  });

  it("should refuse a consultation on a ceremony that does not exist", () => {
    const store = open(dbPath());

    expect(() => store.openConsultation("thread-fantasma", "Existe cache?")).toThrow(/não existe/i);
  });

  it("should refuse to answer a consultation that is not open", () => {
    const store = open(dbPath());
    newSession(store);
    const { id } = store.openConsultation("thread-1", "Existe cache?");
    store.answerConsultation(id, { status: "falhou", message: "o agente caiu" });

    expect(() =>
      store.answerConsultation(id, { status: "falhou", message: "de novo" }),
    ).toThrow(/consulta/i);
  });
});

describe("appendEvent", () => {
  it("should keep the transcript in order", () => {
    const store = open(dbPath());
    newSession(store);

    store.appendEvent("thread-1", { kind: "mensagem", text: "olhei o repo" });
    store.appendEvent("thread-1", { kind: "turno-encerrado" });

    expect(store.listTranscript("thread-1").map((entry) => entry.event)).toEqual([
      { kind: "mensagem", text: "olhei o repo" },
      { kind: "turno-encerrado" },
    ]);
  });
});
