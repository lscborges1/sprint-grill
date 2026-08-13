import { describe, expect, it } from "vitest";
import { CEREMONY_ESTIMATES, isCeremonyEstimate } from "./estimate";

describe("ceremony estimates", () => {
  it("should allow the squad's Fibonacci estimate scale", () => {
    expect(CEREMONY_ESTIMATES).toEqual([1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
    expect(CEREMONY_ESTIMATES.every(isCeremonyEstimate)).toBe(true);
  });

  it.each([0, 4, 6, 90, Number.NaN, Number.POSITIVE_INFINITY])(
    "should reject %p when it is outside the estimate scale",
    (estimate) => {
      expect(isCeremonyEstimate(estimate)).toBe(false);
    },
  );
});
