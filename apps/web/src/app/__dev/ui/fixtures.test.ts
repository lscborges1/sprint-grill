import { describe, expect, it } from "vitest";
import { parseUiQuery } from "./fixtures";

describe("development UI fixture query", () => {
  it("should parse one supported production view", () => {
    expect(parseUiQuery({ view: "palco" })).toEqual({ view: "palco" });
  });

  it("should reject unknown or legacy fixture dimensions", () => {
    expect(() => parseUiQuery({ view: "picker", state: "empty" })).toThrow();
  });
});
