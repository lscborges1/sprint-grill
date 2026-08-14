import type { RefinementStatus } from "@sprint-griller/ado-client";
import { describe, expect, it } from "vitest";
import type { InvestigationRun } from "./investigations";
import { deriveInvestigationUiStatus } from "./investigation-ui-status";

function run(status: InvestigationRun["status"]): InvestigationRun {
  if (status === "em-andamento") {
    return {
      storyId: 42,
      story: undefined,
      startedAt: 1,
      previous: undefined,
      publication: undefined,
      status,
    };
  }

  return {
    storyId: 42,
    story: undefined,
    startedAt: 1,
    finishedAt: 2,
    previous: undefined,
    publication: undefined,
    status,
    report: {
      summary: "Resumo",
      gaps: [],
      impacts: [],
      externalRepos: [],
      unverified: [],
    },
    markdown: "# Relatório",
    violations: [],
  } as InvestigationRun;
}

describe("deriveInvestigationUiStatus", () => {
  it.each([
    ["sem-investigacao", undefined, "ready"],
    ["investigada", undefined, "ready"],
    ["refinada", undefined, "ready"],
    ["sem-investigacao", run("em-andamento"), "running"],
    ["investigada", run("falhou"), "failure"],
    ["investigada", run("reprovado"), "review-rejected"],
    ["investigada", run("aprovado"), "review-approved"],
  ] as const)("should combine %s persistence with %s local execution", (persisted, local, kind) => {
    const result = deriveInvestigationUiStatus(persisted as RefinementStatus, local);

    expect(result.kind).toBe(kind);
    expect(result.persisted).toBe(persisted);
  });

  it("should expose publication uncertainty without turning it into a persisted ADO status", () => {
    const approved = run("aprovado");
    const result = deriveInvestigationUiStatus("investigada", {
      ...approved,
      publication: { status: "incerta", message: "Confira o ADO." },
    });

    expect(result.kind).toBe("publication-uncertain");
    expect(result.persisted).toBe("investigada");
  });
});
