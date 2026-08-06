import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateStartupConfig } from "./startup";

let workspace: string;

/** Escreve uma config no sandbox e aponta o app para ela. */
function useConfig({ omitOrganization = false } = {}) {
  const repoPath = path.join(workspace, "core-api");
  mkdirSync(repoPath, { recursive: true });

  const configPath = path.join(workspace, "sprint-griller.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      azureDevOps: {
        ...(omitOrganization ? {} : { organization: "acme" }),
        project: "Plataforma",
      },
      repos: { primary: { name: "core-api", path: repoPath } },
    }),
  );

  vi.stubEnv("SPRINT_GRILLER_CONFIG", configPath);
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "sprint-griller-startup-"));
  vi.stubEnv("AZURE_DEVOPS_PAT", "pat-de-teste");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("validateStartupConfig", () => {
  it("should let the app boot when the config is valid", () => {
    const exit = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
    useConfig();

    validateStartupConfig();

    expect(exit).not.toHaveBeenCalled();
  });

  it("should kill the process when the config is invalid", () => {
    const exit = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
    useConfig({ omitOrganization: true });

    validateStartupConfig();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("should print the offending field before dying", () => {
    vi.spyOn(process, "exit").mockReturnValue(undefined as never);
    useConfig({ omitOrganization: true });

    validateStartupConfig();

    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toMatch(
      /azureDevOps\.organization/,
    );
  });

  it("should kill the process when the Azure DevOps credential is missing", () => {
    const exit = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
    useConfig();
    vi.stubEnv("AZURE_DEVOPS_PAT", "");

    validateStartupConfig();

    expect(exit).toHaveBeenCalledWith(1);
  });
});
