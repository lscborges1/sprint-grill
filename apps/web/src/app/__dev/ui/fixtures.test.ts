import { describe, expect, it } from "vitest";
import { parseUiQuery } from "./fixtures";

describe("development UI fixture query", () => {
  it("should accept known views and states", () => {
    expect(parseUiQuery({ view: "picker", state: "empty" })).toEqual({ view: "picker", state: "empty" });
  });

  it("should reject unknown fixture values", () => {
    expect(() => parseUiQuery({ view: "ado", state: "live" })).toThrow();
  });
});
