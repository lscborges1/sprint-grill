import { describe, expect, it } from "vitest";
import { askOperatorArgumentsSchema } from "./protocol";

const baseQuestion = {
  id: "q1",
  header: "Escopo",
  question: "Vale para o mobile?",
  recommendation: "Só web: o mobile não consome esse endpoint.",
  evidence: ["core-api · src/routes/commissions.ts"],
};

describe("askOperatorArgumentsSchema", () => {
  it("should accept a well-formed question", () => {
    const parsed = askOperatorArgumentsSchema.safeParse({ questions: [baseQuestion] });

    expect(parsed.success).toBe(true);
  });

  it("should refuse a question without evidence", () => {
    const parsed = askOperatorArgumentsSchema.safeParse({
      questions: [{ ...baseQuestion, evidence: [] }],
    });

    expect(parsed.success).toBe(false);
  });

  it("should refuse options: [] with allowFreeText: false", () => {
    const parsed = askOperatorArgumentsSchema.safeParse({
      questions: [{ ...baseQuestion, options: [], allowFreeText: false }],
    });

    expect(parsed.success).toBe(false);
  });

  it("should refuse duplicate question ids in the same round", () => {
    const parsed = askOperatorArgumentsSchema.safeParse({
      questions: [
        baseQuestion,
        { ...baseQuestion, header: "Outra", question: "E o app?" },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});
