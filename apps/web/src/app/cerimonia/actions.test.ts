import { beforeEach, describe, expect, it, vi } from "vitest";

const adapter = vi.hoisted(() => ({
  addDoubt: vi.fn(),
  approveSpec: vi.fn(),
  approveTickets: vi.fn(),
  confirmRefinement: vi.fn(),
  continueRefining: vi.fn(),
  discardSpecDraft: vi.fn(),
  dumpCeremony: vi.fn(),
  reopenRefinement: vi.fn(),
  resumeCeremony: vi.fn(),
  saveSpecDraft: vi.fn(),
  startCeremony: vi.fn(),
  submitDecision: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/ceremonies", async () => {
  const { z } = await import("zod");
  const sessionId = z.string().min(1);
  return {
    ...adapter,
    artifactGateSchema: z.object({
      sessionId,
      expectedRevision: z.coerce.number().int().nonnegative(),
    }),
    consultationSchema: z.object({ sessionId, question: z.string().trim().min(1) }),
    decisionSchema: z.object({
      sessionId,
      questionId: z.string().min(1),
      answer: z.string().trim().min(1),
    }),
    discardSpecDraftSchema: z.object({
      sessionId,
      expectedSavedAt: z.coerce.number().nullable(),
    }),
    dumpCeremonySchema: z.object({
      sessionId,
      estimate: z.coerce.number().positive(),
    }),
    sessionIdSchema: sessionId,
    specDraftSchema: z.object({
      sessionId,
      markdown: z.string(),
      base: z.string(),
      expectedSavedAt: z.coerce.number().nullable(),
      overwrite: z.boolean(),
    }),
  };
});
vi.mock("@/lib/investigations", async () => {
  const { z } = await import("zod");
  return { storyIdSchema: z.coerce.number().int().positive() };
});
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

const {
  confirmRefinementAction,
  dumpCeremonyAction,
  submitDecisionAction,
} = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Refina server actions", () => {
  it("should submit a room answer without individual authorship", async () => {
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("questionId", "q1");
    form.set("answer", "Regra bancária");
    form.set("decidedBy", "campo forjado");

    await submitDecisionAction(null, form);

    expect(adapter.submitDecision).toHaveBeenCalledWith({
      sessionId: "session-1",
      questionId: "q1",
      answer: "Regra bancária",
    });
  });

  it("should publish with only server-owned artifact identity and estimate", async () => {
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("estimate", "5");
    form.set("markdown", "Spec forjada");
    form.set("tasksMarkdown", "Tickets forjados");

    await dumpCeremonyAction({ status: "idle" }, form);

    expect(adapter.dumpCeremony).toHaveBeenCalledWith({ sessionId: "session-1", estimate: 5 });
  });

  it("should forward the displayed revision to collective confirmation", async () => {
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("expectedRevision", "7");

    await confirmRefinementAction(null, form);

    expect(adapter.confirmRefinement).toHaveBeenCalledWith({
      sessionId: "session-1",
      expectedRevision: 7,
    });
  });
});
