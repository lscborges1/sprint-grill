import { describe, expect, expectTypeOf, it } from "vitest";
import {
  dumpStateSchema,
  signedDumpInputs,
  signedDumpInputsSchema,
} from "./dump-state";
import type { CeremonyDumpState, SignedDumpInputs } from "./dump-state";

const INPUTS = {
  dumpId: "dump-1",
  markdown: "# Spec",
  tasksMarkdown: "## Task",
  estimate: 8,
} as const;

describe("dump state contract", () => {
  it("should infer the public dump input type from its runtime schema", () => {
    expectTypeOf(signedDumpInputsSchema.parse(INPUTS)).toEqualTypeOf<SignedDumpInputs>();
  });

  it("should parse every persisted state and project its signed inputs", () => {
    const states = [
      { status: "not-started" },
      { status: "publishing", inputs: INPUTS, startedAt: 1 },
      { status: "retryable", inputs: INPUTS },
      { status: "completed", inputs: INPUTS, completedAt: 2 },
    ] as const satisfies readonly CeremonyDumpState[];

    expect(states.map((state) => signedDumpInputs(dumpStateSchema.parse(state)))).toEqual([
      undefined,
      INPUTS,
      INPUTS,
      INPUTS,
    ]);
  });

  it("should reject invalid signed inputs at the runtime boundary", () => {
    expect(() => signedDumpInputsSchema.parse({ ...INPUTS, estimate: 0 })).toThrow();
  });
});
