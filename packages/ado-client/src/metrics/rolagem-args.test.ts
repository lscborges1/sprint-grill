import { ConfigError } from "@sprint-griller/core";
import { describe, expect, it } from "vitest";
import { parseRolagemArgs } from "./rolagem-args";

describe("parseRolagemArgs", () => {
  it("should leave the sprint window unset when no flags are passed", () => {
    expect(parseRolagemArgs([])).toEqual({});
  });

  it("should accept --sprints with a positive integer", () => {
    expect(parseRolagemArgs(["--sprints", "10"])).toEqual({ sprints: 10 });
  });

  it("should accept a rollout cutoff date", () => {
    expect(parseRolagemArgs(["--before", "2026-02-01"])).toEqual({
      before: new Date("2026-02-01T00:00:00.000Z"),
    });
  });

  it.each([
    ["--sprints before --before", ["--sprints", "10", "--before", "2026-02-01"]],
    ["--before before --sprints", ["--before", "2026-02-01", "--sprints", "10"]],
  ] as const)("should accept sprint count and cutoff when %s", (_, argv) => {
    expect(parseRolagemArgs(argv)).toEqual({
      before: new Date("2026-02-01T00:00:00.000Z"),
      sprints: 10,
    });
  });

  it.each([
    ["--sprints without a value", ["--sprints"]],
    ["--sprints with zero", ["--sprints", "0"]],
    ["--sprints with a decimal", ["--sprints", "1.5"]],
    ["--sprints with non-numeric text", ["--sprints", "abc"]],
    ["--before with an invalid date", ["--before", "2026-02-30"]],
  ] as const)("should reject %s", (_, argv) => {
    expect(() => parseRolagemArgs(argv)).toThrow(ConfigError);
  });

  it("should reject --sprints=N instead of silently using the six-sprint default", () => {
    expect(() => parseRolagemArgs(["--sprints=10"])).toThrow(ConfigError);
  });

  it.each([
    ["an unknown flag", ["--foo"]],
    ["a positional argument", ["10"]],
    ["an extra argument", ["--sprints", "10", "--extra"]],
  ] as const)("should reject %s", (_, argv) => {
    expect(() => parseRolagemArgs(argv)).toThrow(ConfigError);
  });
});
