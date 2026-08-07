import { describe, expect, it } from "vitest";
import { investigationInstructions, investigationPrompt } from "./prompt";
import { investigationReportSchema } from "./report";

const REPOS = {
  primary: { name: "core-api", path: "/dev/core-api" },
  related: [{ name: "web-app", path: "/dev/web-app" }],
};

describe("investigationInstructions", () => {
  it("should name every configured repo with its absolute path", () => {
    const instructions = investigationInstructions(REPOS);

    expect(instructions).toContain("core-api");
    expect(instructions).toContain("/dev/core-api");
    expect(instructions).toContain("web-app");
    expect(instructions).toContain("/dev/web-app");
  });

  it("should describe every field the report schema requires", () => {
    const instructions = investigationInstructions(REPOS);

    for (const field of Object.keys(investigationReportSchema.shape)) {
      expect(instructions).toContain(field);
    }
  });

  it("should say the run is AFK so the agent does not wait on a human", () => {
    expect(investigationInstructions(REPOS)).toContain("AFK");
  });
});

describe("investigationPrompt", () => {
  it("should carry the story id, title and description to the agent", () => {
    const prompt = investigationPrompt({
      id: 4211,
      title: "TTL de sessão configurável",
      description: "<div>O TTL hoje é fixo.</div>",
      url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211",
    });

    expect(prompt).toContain("4211");
    expect(prompt).toContain("TTL de sessão configurável");
    expect(prompt).toContain("O TTL hoje é fixo.");
  });

  it("should say the description is missing instead of leaving a hole", () => {
    const prompt = investigationPrompt({
      id: 7,
      title: "US crua",
      description: undefined,
      url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/7",
    });

    expect(prompt).toContain("sem descrição");
  });
});
