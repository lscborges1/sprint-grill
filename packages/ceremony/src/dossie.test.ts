import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderReportMarkdown } from "@sprint-griller/investigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDossie } from "./dossie";
import { SPEC_SECTIONS } from "./spec-vocabulary";
import { openCeremonyStore } from "./store";
import type { CeremonyStore } from "./store";
import type { CeremonyQuestion } from "./types";

const opened: CeremonyStore[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (opened.length > 0) opened.pop()?.close();
});

/**
 * A Investigação chega ao Dossiê como o Markdown que a própria ferramenta
 * renderizou — por isso a fixture passa pelo renderer de verdade em vez de
 * imitar o formato à mão.
 */
const INVESTIGATION = renderReportMarkdown(
  {
    id: 4242,
    title: "Exportar relatório de comissões",
    description: undefined,
    url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4242",
  },
  {
    summary: "A US mexe no cálculo de comissão.",
    gaps: [{ question: "Qual arredondamento?", why: "A US não diz." }],
    impacts: [
      {
        claim: "O cálculo de comissão vive no serviço de folha.",
        citations: [{ repo: "core-api", path: "src/payroll/rounding.ts" }],
      },
    ],
    externalRepos: [],
    unverified: ["O portal do vendedor talvez leia o mesmo total."],
  },
  { status: "aprovado" },
);

function open(): CeremonyStore {
  const store = openCeremonyStore(
    path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-")), "cerimonias.db"),
  );
  opened.push(store);
  return store;
}

function newSession(
  store: CeremonyStore,
  investigationMarkdown = INVESTIGATION,
  timeZone = "UTC",
) {
  return store.createSession({
    id: "thread-1",
    storyId: 4242,
    storyTitle: "Exportar relatório de comissões",
    storyUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4242",
    investigationMarkdown,
    timeZone,
  });
}

const question = (overrides: Partial<CeremonyQuestion> = {}): CeremonyQuestion => ({
  id: "q1",
  header: "Arredondamento",
  question: "A comissão arredonda para cima ou segue a regra bancária?",
  recommendation: "Seguir a regra bancária, que é o que o cálculo de folha já usa.",
  evidence: ["core-api · src/payroll/rounding.ts"],
  options: [{ label: "Regra bancária", description: "Igual à folha." }],
  allowFreeText: true,
  ...overrides,
});

function decide(store: CeremonyStore, decidedBy = "PO + squad"): void {
  store.askQuestions("thread-1", [question()]);
  store.recordDecision({
    sessionId: "thread-1",
    questionId: "q1",
    answer: "Regra bancária",
    decidedBy,
  });
}

describe("readDossie", () => {
  it("should not find a Dossiê for a ceremony that does not exist", () => {
    expect(readDossie(open(), "fantasma")).toBeUndefined();
  });

  it("should show each decision with who decided it", () => {
    const store = open();
    newSession(store);
    decide(store);

    expect(readDossie(store, "thread-1")?.decisions).toMatchObject([
      { answer: "Regra bancária", decidedBy: "PO + squad" },
    ]);
  });

  it("should carry the impact context of the Investigação into the document", () => {
    const store = open();
    newSession(store);

    expect(readDossie(store, "thread-1")?.investigation.impact).toContain(
      "O cálculo de comissão vive no serviço de folha.",
    );
  });

  it("should keep unverified claims out of the impact context", () => {
    const store = open();
    newSession(store);

    const dossie = readDossie(store, "thread-1");

    expect(dossie?.investigation.unverified).toContain("O portal do vendedor");
    expect(dossie?.investigation.impact).not.toContain("O portal do vendedor");
  });

  it("should survive an Investigação without the expected headings", () => {
    const store = open();
    newSession(store, "Um relatório sem seção nenhuma.");

    expect(readDossie(store, "thread-1")?.investigation).toEqual({
      impact: "",
      unverified: "",
    });
  });

  it("should list a question the room has not answered as pending", () => {
    const store = open();
    newSession(store);
    store.askQuestions("thread-1", [question()]);

    expect(readDossie(store, "thread-1")?.pending).toEqual([
      { id: question().id, question: question().question },
    ]);
  });

  it("should preserve ids for pending questions with the same wording", () => {
    const store = open();
    newSession(store);
    const wording = "Qual é o comportamento esperado?";
    store.askQuestions("thread-1", [
      question({ id: "q1", question: wording }),
      question({ id: "q2", question: wording }),
    ]);

    expect(readDossie(store, "thread-1")?.pending).toEqual([
      { id: "q1", question: wording },
      { id: "q2", question: wording },
    ]);
  });

  it("should generate the despejo Markdown from what is recorded", () => {
    const store = open();
    newSession(store);
    decide(store);

    const generated = readDossie(store, "thread-1")?.spec.generated ?? "";

    expect(generated).toContain("# Spec da US #4242 — Exportar relatório de comissões");
    expect(generated).toContain("Decidido por PO + squad");
    expect(generated).toContain(`## ${SPEC_SECTIONS.impact.heading}`);
  });

  it("should have no draft until the Operator edits the Markdown", () => {
    const store = open();
    newSession(store);

    expect(readDossie(store, "thread-1")?.spec.draft).toBeNull();
  });

  it("should hand back the Operator edit alongside the generated Markdown", () => {
    const store = open();
    newSession(store);
    const generated = readDossie(store, "thread-1")?.spec.generated ?? "";

    store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: `${generated}\n\nFora de escopo: relatório mensal.`,
      base: generated,
      expectedSavedAt: null,
    });

    const spec = readDossie(store, "thread-1")?.spec;
    expect(spec?.draft?.markdown).toContain("Fora de escopo: relatório mensal.");
    expect(spec?.draft?.base).toBe(spec?.generated);
  });

  it("should move the generated Markdown past the edit when a decision comes in after it", () => {
    const store = open();
    newSession(store);
    const before = readDossie(store, "thread-1")?.spec.generated ?? "";
    store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: "assinado",
      base: before,
      expectedSavedAt: null,
    });

    decide(store);

    const spec = readDossie(store, "thread-1")?.spec;
    expect(spec?.draft?.base).not.toBe(spec?.generated);
  });

  it("should keep a saved Spec base stable when the host timezone changes", () => {
    const store = open();
    newSession(store, INVESTIGATION, "America/Sao_Paulo");
    decide(store);

    const before = readDossie(store, "thread-1")?.spec.generated ?? "";
    store.saveSpecDraft({
      sessionId: "thread-1",
      markdown: before,
      base: before,
      expectedSavedAt: null,
    });

    vi.stubEnv("TZ", "America/Los_Angeles");

    expect(readDossie(store, "thread-1")?.spec.generated).toBe(before);
  });

  it("should keep a multiline claim containing a Markdown heading in the impact section", () => {
    const store = open();
    const investigation = renderReportMarkdown(
      {
        id: 4242,
        title: "Exportar relatório de comissões",
        description: undefined,
        url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4242",
      },
      {
        summary: "A US mexe no cálculo de comissão.",
        gaps: [],
        impacts: [
          {
            claim: "O cálculo tem contexto:\n## Nota escrita pelo agente\nA regra está no serviço de folha.",
            citations: [{ repo: "core-api", path: "src/payroll/rounding.ts" }],
          },
        ],
        externalRepos: [],
        unverified: ["O portal do vendedor talvez leia o mesmo total."],
      },
      { status: "aprovado" },
    );
    newSession(store, investigation);

    const dossie = readDossie(store, "thread-1");

    expect(dossie?.investigation.impact).toContain("A regra está no serviço de folha.");
    expect(dossie?.investigation.unverified).toContain("O portal do vendedor");
  });
});
