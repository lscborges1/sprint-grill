import { describe, expect, it } from "vitest";
import type { InvestigationRun } from "./investigations";
import { derivePickerAction } from "./picker-action";

const baseRun = {
  storyId: 42,
  story: undefined,
  startedAt: 1,
  previous: undefined,
  publication: undefined,
} as const;

function run(status: InvestigationRun["status"]): InvestigationRun {
  if (status === "em-andamento") return { ...baseRun, status };
  if (status === "falhou") {
    return { ...baseRun, status, finishedAt: 2, message: "A Investigação falhou." };
  }
  if (status === "reprovado") {
    return {
      ...baseRun,
      status,
      finishedAt: 2,
      report: { summary: "Resumo", gaps: [], impacts: [], externalRepos: [], unverified: [] },
      markdown: "# Investigação",
      violations: [],
    };
  }
  return {
    ...baseRun,
    status,
    finishedAt: 2,
    report: { summary: "Resumo", gaps: [], impacts: [], externalRepos: [], unverified: [] },
    markdown: "# Investigação",
  };
}

describe("derivePickerAction", () => {
  it.each([
    ["sem-investigacao", undefined, { kind: "start", label: "Investigar" }],
    ["investigada", undefined, { kind: "start", label: "Investigar novamente" }],
    ["sem-investigacao", run("em-andamento"), { kind: "open", label: "Acompanhar execução" }],
    ["investigada", run("falhou"), { kind: "open", label: "Revisar falha" }],
    ["investigada", run("reprovado"), { kind: "open", label: "Revisar reprovação" }],
    ["investigada", run("aprovado"), { kind: "open", label: "Revisar relatório" }],
  ] as const)("should derive the Picker action from %s and the local run", (persisted, local, expected) => {
    expect(derivePickerAction(persisted, local)).toEqual(expected);
  });

  it.each([
    [{ status: "publicada", commentId: 9, url: "https://example.com/117" }, "Revisar relatório"],
    [{ status: "falhou", message: "Nada foi publicado." }, "Tentar publicação"],
    [{ status: "incerta", message: "Confira o Azure DevOps." }, "Conferir publicação"],
  ] as const)("should derive %s from the publication outcome", (publication, label) => {
    const approved = run("aprovado");
    if (approved.status !== "aprovado") throw new Error("Fixture aprovada inválida.");

    expect(derivePickerAction("investigada", { ...approved, publication })).toEqual({
      kind: "open",
      label,
    });
  });
});
