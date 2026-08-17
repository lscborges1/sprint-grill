import { describe, expect, it } from "vitest";
import {
  agendaResolutionArgumentsSchema,
  askOperatorArgumentsSchema,
  completionProposalArgumentsSchema,
  refinementTicketsSubmissionSchema,
} from "./protocol";

const baseQuestion = {
  id: "q1",
  agendaItemId: "gap-1",
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

  it("should refuse more than one room question in the same call", () => {
    const parsed = askOperatorArgumentsSchema.safeParse({
      questions: [baseQuestion, { ...baseQuestion, id: "q2", agendaItemId: "gap-2" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("should require the agenda item identity", () => {
    const { agendaItemId: _agendaItemId, ...withoutAgendaItem } = baseQuestion;

    expect(askOperatorArgumentsSchema.safeParse({ questions: [withoutAgendaItem] }).success).toBe(
      false,
    );
  });
});

describe("completionProposalArgumentsSchema", () => {
  it("should accept an explicit completion summary", () => {
    expect(
      completionProposalArgumentsSchema.safeParse({ summary: "Todos os furos foram resolvidos." })
        .success,
    ).toBe(true);
  });
});

describe("agendaResolutionArgumentsSchema", () => {
  it("should require at least one citation for a factual resolution", () => {
    expect(
      agendaResolutionArgumentsSchema.safeParse({
        kind: "fact",
        agendaItemId: "gap-1",
        answer: "A regra já existe.",
        citations: [],
      }).success,
    ).toBe(false);
  });

  it("should reject a whitespace-only factual answer", () => {
    expect(
      agendaResolutionArgumentsSchema.safeParse({
        kind: "fact",
        agendaItemId: "gap-1",
        answer: "   ",
        citations: [{ repo: "core-api", path: "src/checkout.ts" }],
      }).success,
    ).toBe(false);
  });

  it("should accept a justified out-of-scope resolution without citations", () => {
    expect(
      agendaResolutionArgumentsSchema.safeParse({
        kind: "out-of-scope",
        agendaItemId: "gap-1",
        justification: "O mobile terá uma US própria.",
      }).success,
    ).toBe(true);
  });

  it("should reject a whitespace-only out-of-scope justification", () => {
    expect(
      agendaResolutionArgumentsSchema.safeParse({
        kind: "out-of-scope",
        agendaItemId: "gap-1",
        justification: "   ",
      }).success,
    ).toBe(false);
  });
});

const ticket = {
  id: "ticket-1",
  title: "Implementar exportação",
  description: "Entrega o CSV da US.",
  acceptanceCriteria: ["Retorna CSV em UTF-8."],
  specUrl: "https://dev.azure.com/org/project/_workitems/edit/117",
  blockedBy: [],
} as const;

describe("refinementTicketsSubmissionSchema", () => {
  it("should reject duplicate ticket ids", () => {
    const parsed = refinementTicketsSubmissionSchema.safeParse({
      tickets: [
        ticket,
        { ...ticket, title: "Validar exportação" },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it.each([
    ["critérios de aceite", { ...ticket, acceptanceCriteria: ["Duplicado", "Duplicado"] }],
    ["dependências", { ...ticket, blockedBy: ["ticket-0", "ticket-0"] }],
  ] as const)("should reject duplicate %s", (_label, candidate) => {
    expect(refinementTicketsSubmissionSchema.safeParse({ tickets: [candidate] }).success).toBe(false);
  });
});
