import type { SquadConfig } from "@sprint-griller/core";
import { describe, expect, it } from "vitest";
import {
  ceremonyInstructions,
  ceremonyOpeningPrompt,
  ceremonyResumePrompt,
  consultationInstructions,
  consultationPrompt,
  investigationAgenda,
} from "./prompt";
import { TASK_DRAFT_START } from "./task-draft";
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
  questionSeq: 1,
  questionId: "q1",
  question: "A comissão arredonda para cima?",
  recommendation: "Seguir a regra bancária.",
  answer: "Regra bancária",
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

  it("should require a task preview when the agent closes the ceremony", () => {
    expect(ceremonyInstructions(repos)).toContain(TASK_DRAFT_START);
    expect(ceremonyInstructions(repos)).toContain("Critérios de aceite");
    expect(ceremonyInstructions(repos)).toMatch(/exatamente a URL/i);
    expect(ceremonyInstructions(repos)).toMatch(/autocontida/i);
    expect(ceremonyInstructions(repos)).toMatch(/uma sessão de agente/i);
  });
});

describe("ceremonyOpeningPrompt", () => {
  it("should hand the investigation to the agent as the input of the grilling", () => {
    const prompt = ceremonyOpeningPrompt(story, "## Furos da US\n\n- Sem regra de arredondamento.");

    expect(prompt).toContain("#4242");
    expect(prompt).toContain("Exportar relatório de comissões");
    expect(prompt).toContain("Sem regra de arredondamento.");
    expect(prompt).toContain("O gerente precisa baixar o CSV.");
    expect(prompt).toContain(story.url);
    expect(prompt).toContain(`[Spec da US](${story.url})`);
  });

  it("should say the story has no description when the PO left it empty", () => {
    const prompt = ceremonyOpeningPrompt({ ...story, description: undefined }, "## Furos da US");

    expect(prompt).toContain("sem descrição");
  });
});

describe("investigationAgenda", () => {
  it("should preserve only the gap question from rendered Investigation markdown", () => {
    expect(
      investigationAgenda(
        "## Furos da US\n\n- **Qual regra de arredondamento?** — muda a estimativa\n\n## Impacto mapeado\n\n- outro texto",
      ),
    ).toEqual([
      { id: "investigacao-1", question: "Qual regra de arredondamento?" },
    ]);
  });
});

describe("consultationInstructions", () => {
  it("should list every repo the agent may read with its absolute path", () => {
    const instructions = consultationInstructions(repos);

    expect(instructions).toContain("`core-api` — /dev/core-api");
    expect(instructions).toContain("`web-app` — /dev/web-app");
  });

  it("should classify a doubt that needs a room choice instead of guessing", () => {
    const instructions = consultationInstructions(repos);

    expect(instructions).toContain('"kind": "room-choice"');
    expect(instructions).toMatch(/escolha.*sala/i);
  });

  it("should forbid recommending when the classified answer is a fact", () => {
    expect(consultationInstructions(repos)).toMatch(/fato.*não recomende/i);
  });

  it("should ask for the answer with citations in the structured contract", () => {
    const instructions = consultationInstructions(repos);

    expect(instructions).toContain('"citations"');
    expect(instructions).toContain("```json");
  });
});

describe("consultationPrompt", () => {
  it("should carry the room question with the story as context", () => {
    const prompt = consultationPrompt(story, "Quem mais consome o CreateOrder?");

    expect(prompt).toContain("Quem mais consome o CreateOrder?");
    expect(prompt).toContain("#4242");
    expect(prompt).toContain("Exportar relatório de comissões");
  });
});

describe("ceremonyResumePrompt", () => {
  it("should replay the decisions already taken so the agent does not ask them again", () => {
    const prompt = ceremonyResumePrompt([
      decision(),
      decision({ questionId: "q2", question: "Entra nesta sprint?", answer: "Sim" }),
    ]);

    expect(prompt).toContain("A comissão arredonda para cima?");
    expect(prompt).toContain("Regra bancária");
    expect(prompt).toContain("Entra nesta sprint?");
    expect(prompt).not.toContain("decidido por");
  });

  it("should tell the agent the ceremony is starting over with nothing decided", () => {
    expect(ceremonyResumePrompt([])).toMatch(/nenhuma decisão/i);
  });
});
