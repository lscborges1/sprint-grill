import type { BacklogStory, RefinementStatus } from "@sprint-griller/ado-client";
import { describe, expect, it } from "vitest";
import { isRunStale, selectPreparoBatch, shouldEnqueue } from "./selection";
import type { RunSummary } from "./types";

function story(overrides: Partial<BacklogStory> & { id: number }): BacklogStory {
  return {
    title: `US ${overrides.id}`,
    type: "User Story",
    state: "New",
    rev: 1,
    assignedTo: undefined,
    url: `https://example.com/${overrides.id}`,
    refinement: "sem-investigacao",
    ...overrides,
  };
}

const CONFIG = { limit: 5, states: ["New"] } as const;

describe("selectPreparoBatch", () => {
  it("should pick the top eligible stories: sem investigação, estado configurado, pela ordem do backlog", () => {
    const backlog = [
      story({ id: 1, rev: 3 }),
      story({ id: 2, refinement: "investigada" as RefinementStatus, rev: 1 }),
      story({ id: 3, state: "Active", rev: 1 }),
      story({ id: 4, rev: 7 }),
      story({ id: 5, state: "Removed", rev: 1 }),
    ];

    const batch = selectPreparoBatch(backlog, new Map(), CONFIG);

    expect(batch.map((s) => s.id)).toEqual([1, 4]);
  });

  it("should cap the batch at the configured limit", () => {
    const backlog = [1, 2, 3, 4, 5, 6, 7].map((id) => story({ id }));

    expect(selectPreparoBatch(backlog, new Map(), CONFIG)).toHaveLength(5);
    expect(
      selectPreparoBatch(backlog, new Map(), { limit: 2, states: ["New"] }),
    ).toHaveLength(2);
  });

  it("should not re-enqueue a run already queued or running for the same rev", () => {
    const backlog = [story({ id: 1, rev: 3 })];
    const runs = new Map<number, RunSummary>([
      [1, { status: "aguardando", storyRev: undefined, queuedRev: 3 }],
    ]);

    expect(selectPreparoBatch(backlog, runs, CONFIG)).toEqual([]);

    runs.set(1, { status: "em-andamento", storyRev: undefined, queuedRev: 3 });
    expect(selectPreparoBatch(backlog, runs, CONFIG)).toEqual([]);
  });

  it("should skip a failed run of the same rev — sem retry automático", () => {
    const backlog = [story({ id: 1, rev: 3 })];
    const runs = new Map<number, RunSummary>([
      [1, { status: "falhou", storyRev: 3, queuedRev: 3 }],
    ]);

    expect(selectPreparoBatch(backlog, runs, CONFIG)).toEqual([]);
  });

  it("should re-enqueue when the story rev moved past the last analyzed rev", () => {
    const runs = new Map<number, RunSummary>([
      [1, { status: "falhou", storyRev: 3, queuedRev: 3 }],
      [2, { status: "aprovado", storyRev: 4, queuedRev: 4 }],
    ]);

    expect(selectPreparoBatch([story({ id: 1, rev: 5 }), story({ id: 2, rev: 5 })], runs, CONFIG).map((s) => s.id)).toEqual([1, 2]);
  });

  it("should accept custom states — CMMI propõe Proposed, não New", () => {
    const backlog = [
      story({ id: 1, state: "Proposed" }),
      story({ id: 2, state: "New" }),
    ];

    const batch = selectPreparoBatch(backlog, new Map(), {
      limit: 5,
      states: ["Proposed"],
    });

    expect(batch.map((s) => s.id)).toEqual([1]);
  });
});

describe("shouldEnqueue", () => {
  it.each([
    [3, undefined, true],
    [3, { status: "aguardando", storyRev: undefined, queuedRev: 3 } as RunSummary, false],
    [3, { status: "em-andamento", storyRev: 3, queuedRev: 3 } as RunSummary, false],
    [3, { status: "falhou", storyRev: 3, queuedRev: 3 } as RunSummary, false],
    [5, { status: "falhou", storyRev: 3, queuedRev: 3 } as RunSummary, true],
    [5, { status: "aprovado", storyRev: 3, queuedRev: 3 } as RunSummary, true],
  ] as const)("rev %s com run %j deve enfileirar %s", (backlogRev, run, expected) => {
    expect(shouldEnqueue(backlogRev, run)).toBe(expected);
  });
});

describe("isRunStale", () => {
  it("should flag a local analysis left behind by a newer backlog rev", () => {
    expect(
      isRunStale(5, { status: "aprovado", storyRev: 3, queuedRev: 3 }),
    ).toBe(true);
    expect(
      isRunStale(3, { status: "aprovado", storyRev: 3, queuedRev: 3 }),
    ).toBe(false);
    expect(isRunStale(9, undefined)).toBe(false);
  });
});
