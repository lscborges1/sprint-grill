import { describe, expect, it } from "vitest";
import { renderSprintMetricsReport } from "./sprint-metrics-report";

describe("renderSprintMetricsReport", () => {
  it("should combine rollover, coverage, doubts and the diagnostic interpretation for the retro", () => {
    const report = renderSprintMetricsReport({
      rollover: { scope: 2, completed: 1, rolled: 1, removed: 0, rate: 0.5 },
      coverage: { scope: 2, refined: 1, rate: 0.5 },
      sprints: [{
        name: "Sprint 41",
        finishDate: new Date("2026-01-30T00:00:00Z"),
        rollover: { scope: 2, completed: 1, rolled: 1, removed: 0, rate: 0.5 },
        coverage: { scope: 2, refined: 1, rate: 0.5 },
        doubts: [{ id: 42, title: "Auditar acesso", openQuestions: 2, rolled: true }],
      }],
    }, { organization: "acme", project: "Plataforma" });

    expect(report).toMatch(
      /(?=.*Trio anti-vaidade — acme\/Plataforma)(?=.*US #42 — Auditar acesso: 2 dúvida\(s\) aberta\(s\) ⚠ rolou com muitas dúvidas)(?=.*rolagem caindo \+ cobertura alta = funciona)(?=.*rolagem estável \+ cobertura alta = tese falhou)/s,
    );
  });
});
