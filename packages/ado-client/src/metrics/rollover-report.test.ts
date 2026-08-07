import { describe, expect, it } from "vitest";
import { renderRolloverReport } from "./rollover-report";
import type { RolloverBaseline, SprintRollover } from "./rollover";

const SQUAD = { organization: "acme", project: "Plataforma" };

function sprint(
  name: string,
  counts: Pick<SprintRollover, "scope" | "completed" | "removed">,
): SprintRollover {
  const rolled = counts.scope - counts.completed;
  return {
    name,
    path: `Plataforma\\${name}`,
    startDate: new Date("2026-01-19T00:00:00Z"),
    finishDate: new Date("2026-01-30T00:00:00Z"),
    ...counts,
    rolled,
    rate: counts.scope === 0 ? undefined : rolled / counts.scope,
  };
}

function baselineOf(sprints: readonly SprintRollover[]): RolloverBaseline {
  const scope = sum(sprints, "scope");
  const completed = sum(sprints, "completed");
  return {
    sprints,
    total: {
      scope,
      completed,
      removed: sum(sprints, "removed"),
      rolled: scope - completed,
      rate: scope === 0 ? undefined : (scope - completed) / scope,
    },
  };
}

function sum(
  sprints: readonly SprintRollover[],
  field: "scope" | "completed" | "removed",
): number {
  return sprints.reduce((total, item) => total + item[field], 0);
}

describe("renderRolloverReport", () => {
  it("should lay the sprints out as a table the squad can paste into the retro", () => {
    const report = renderRolloverReport(
      baselineOf([
        sprint("Sprint 40", { scope: 10, completed: 9, removed: 0 }),
        sprint("Sprint 41", { scope: 12, completed: 4, removed: 0 }),
      ]),
      SQUAD,
    );

    expect(report).toContain("Baseline de rolagem — acme/Plataforma");
    expect(report).toContain(
      [
        "Sprint      Fechou em  Escopo  Concluíram  Rolaram  Rolagem",
        "Sprint 40  30/01/2026      10           9        1    10,0%",
        "Sprint 41  30/01/2026      12           4        8    66,7%",
        "───────────────────────────────────────────────────────────",
        "Total                      22          13        9    40,9%",
      ].join("\n"),
    );
  });

  it("should say the numbers are aggregated and read-only, since that is the deal with the squad", () => {
    const report = renderRolloverReport(
      baselineOf([sprint("Sprint 41", { scope: 4, completed: 2, removed: 0 })]),
      SQUAD,
    );

    expect(report).toMatch(/nunca por pessoa/);
    expect(report).toMatch(/somente leitura/);
  });

  it("should own up to the US it left out of the count when any were removed", () => {
    const report = renderRolloverReport(
      baselineOf([sprint("Sprint 41", { scope: 4, completed: 2, removed: 3 })]),
      SQUAD,
    );

    expect(report).toContain("3 US removida(s) da sprint ficaram fora da conta");
  });

  it("should keep quiet about removed US when there were none", () => {
    const report = renderRolloverReport(
      baselineOf([sprint("Sprint 41", { scope: 4, completed: 2, removed: 0 })]),
      SQUAD,
    );

    expect(report).not.toMatch(/removida/);
  });

  it("should show a dash instead of a flattering 0% for a sprint nobody planned", () => {
    const report = renderRolloverReport(
      baselineOf([sprint("Sprint 41", { scope: 0, completed: 0, removed: 0 })]),
      SQUAD,
    );

    expect(report).not.toMatch(/0,0%/);
    expect(report).toMatch(/—/);
  });

  it("should say plainly that there is no baseline instead of printing an empty table", () => {
    const report = renderRolloverReport(baselineOf([]), SQUAD);

    expect(report).toContain("Nenhuma sprint encerrada com datas no Azure DevOps");
    expect(report).not.toContain("Rolagem");
  });
});
