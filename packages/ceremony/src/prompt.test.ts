import type { SquadConfig } from "@sprint-griller/core";
import { describe, expect, it } from "vitest";
import { ceremonyInstructions, ceremonyOpeningPrompt, ceremonyResumePrompt } from "./prompt";
import type { CeremonyDecision } from "./types";

const repos: SquadConfig["repos"] = {
  primary: { name: "core-api", path: "/dev/core-api" },
  related: [{ name: "web-app", path: "/dev/web-app" }],
};

const story = {
  id: 4242,
  title: "Exportar relatório de comissões",
  description: "<p>O gerente precisa baixar o CSV.</p>",
  url: "https://dev.azure.com/org/proj/_workitems/edit/4242",
};

const decision = (overrides: Partial<CeremonyDecision> = {}): CeremonyDecision => ({
  questionId: "q1",
  question: "A comissão arredonda para cima?",
  recommendation: "Seguir a regra bancária.",
  answer: "Regra bancária",
  decidedBy: "PO",
  decidedAt: 1_700_000_000_000,
  ...overrides,
});

describe("ceremonyInstructions", () => {
  it("should list every repo the agent may read with its absolute path", () => {
    const instructions = ceremonyInstructions(repos);

    expect(instructions).toContain("`core-api` — /dev/core-api");
    expect(instructions).toContain("`web-app` — /dev/web-app");
  });

  it("should forbid asking the room anything the code answers", () => {
    const instructions = ceremonyInstructions(repos);

    expect(instructions).toMatch(/fato.*(busque|você busca)/i);
    expect(instructions).toContain("ask_operator");
  });

  it("should require a recommendation on every question", () => {
    expect(ceremonyInstructions(repos)).toMatch(/recommendation/);
  });
});

describe("ceremonyOpeningPrompt", () => {
  it("should hand the investigation to the agent as the input of the grilling", () => {
    const prompt = ceremonyOpeningPrompt(story, "## Furos da US\n\n- Sem regra de arredondamento.");

    expect(prompt).toContain("#4242");
    expect(prompt).toContain("Exportar relatório de comissões");
    expect(prompt).toContain("Sem regra de arredondamento.");
    expect(prompt).toContain("O gerente precisa baixar o CSV.");
  });

  it("should say the story has no description when the PO left it empty", () => {
    const prompt = ceremonyOpeningPrompt({ ...story, description: undefined }, "## Furos da US");

    expect(prompt).toContain("sem descrição");
  });
});

describe("ceremonyResumePrompt", () => {
  it("should replay the decisions already taken so the agent does not ask them again", () => {
    const prompt = ceremonyResumePrompt([
      decision(),
      decision({ questionId: "q2", question: "Entra nesta sprint?", answer: "Sim", decidedBy: "squad" }),
    ]);

    expect(prompt).toContain("A comissão arredonda para cima?");
    expect(prompt).toContain("Regra bancária");
    expect(prompt).toContain("PO");
    expect(prompt).toContain("Entra nesta sprint?");
    expect(prompt).toContain("squad");
  });

  it("should tell the agent the ceremony is starting over with nothing decided", () => {
    expect(ceremonyResumePrompt([])).toMatch(/nenhuma decisão/i);
  });
});
