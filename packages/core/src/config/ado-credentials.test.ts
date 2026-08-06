import { describe, expect, it } from "vitest";
import { loadAdoCredentials } from "./ado-credentials";

describe("loadAdoCredentials", () => {
  it("should return the personal access token when the env var is set", () => {
    const credentials = loadAdoCredentials({ AZURE_DEVOPS_PAT: "abc123" });

    expect(credentials).toEqual({ pat: "abc123" });
  });

  it("should name the env var when it is missing", () => {
    expect(() => loadAdoCredentials({})).toThrowError(/AZURE_DEVOPS_PAT/);
  });

  it("should name the env var when it is empty", () => {
    expect(() => loadAdoCredentials({ AZURE_DEVOPS_PAT: "" })).toThrowError(
      /AZURE_DEVOPS_PAT/,
    );
  });
});
