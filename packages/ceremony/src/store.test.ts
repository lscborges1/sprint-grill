import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./schema";
import { openCeremonyStore } from "./store";
import type { CeremonyStore } from "./store";
import type { CeremonyQuestion } from "./types";

const opened: CeremonyStore[] = [];

afterEach(() => {
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

describe("openCeremonyStore", () => {
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

    expect(store.currentQuestion("thread-1")).toEqual(question());
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
