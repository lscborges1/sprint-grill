import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_EXAMPLE_FILENAME,
  CONFIG_FILENAME,
  CONFIG_PATH_ENV_VAR,
  defaultSquadConfigPath,
  loadSquadConfig,
} from "./squad-config";

let workspace: string;

/** Cria um diretório dentro do sandbox do teste e devolve o caminho absoluto. */
function makeRepoDir(name: string): string {
  const repoPath = path.join(workspace, name);
  mkdirSync(repoPath, { recursive: true });
  return repoPath;
}

/** Escreve o arquivo de config no sandbox e devolve o caminho para o loader. */
function writeConfig(contents: unknown): string {
  const configPath = path.join(workspace, "sprint-griller.config.json");
  writeFileSync(
    configPath,
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
  );
  return configPath;
}

/** Monta uma config válida — e cria os diretórios que ela referencia. */
function makeValidConfig() {
  return {
    azureDevOps: { organization: "acme", project: "Plataforma" },
    repos: {
      primary: { name: "core-api", path: makeRepoDir("core-api") },
      related: [{ name: "web-app", path: makeRepoDir("web-app") }],
    },
  };
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "sprint-griller-config-"));
});

describe("loadSquadConfig", () => {
  it("should return the squad config when the file is valid", () => {
    const raw = makeValidConfig();

    const config = loadSquadConfig(writeConfig(raw));

    expect(config).toEqual(raw);
  });

  it("should default related repos to an empty list when the key is omitted", () => {
    const { related: _omitted, ...repos } = makeValidConfig().repos;

    const config = loadSquadConfig(
      writeConfig({ ...makeValidConfig(), repos }),
    );

    expect(config.repos.related).toEqual([]);
  });

  it("should point at the missing field when a required key is absent", () => {
    const raw = makeValidConfig();
    const { organization: _absent, ...azureDevOps } = raw.azureDevOps;

    expect(() =>
      loadSquadConfig(writeConfig({ ...raw, azureDevOps })),
    ).toThrowError(/azureDevOps\.organization/);
  });

  it("should point at the field when a repo path is not absolute", () => {
    const raw = makeValidConfig();
    raw.repos.primary.path = "./core-api";

    expect(() => loadSquadConfig(writeConfig(raw))).toThrowError(
      /repos\.primary\.path/,
    );
  });

  it("should point at the field when a related repo directory does not exist", () => {
    const raw = makeValidConfig();
    raw.repos.related.push({
      name: "fantasma",
      path: path.join(workspace, "nao-existe"),
    });

    expect(() => loadSquadConfig(writeConfig(raw))).toThrowError(
      /repos\.related\[1\]\.path/,
    );
  });

  it("should name the expected path and the env var when the file is missing", () => {
    const missingPath = path.join(workspace, CONFIG_FILENAME);

    expect(() => loadSquadConfig(missingPath)).toThrowError(
      new RegExp(`${missingPath}[\\s\\S]*${CONFIG_PATH_ENV_VAR}`),
    );
  });

  it("should point at the example file when the config is missing", () => {
    const missingPath = path.join(workspace, CONFIG_FILENAME);

    expect(() => loadSquadConfig(missingPath)).toThrowError(
      new RegExp(CONFIG_EXAMPLE_FILENAME.replaceAll(".", "\\.")),
    );
  });

  it("should name the file when its contents are not valid JSON", () => {
    const configPath = writeConfig("{ nao é json }");

    expect(() => loadSquadConfig(configPath)).toThrowError(
      new RegExp(configPath),
    );
  });
});

describe("defaultSquadConfigPath", () => {
  it("should use the env var when it is set", () => {
    const configPath = path.join(workspace, "outra-config.json");

    expect(defaultSquadConfigPath({ [CONFIG_PATH_ENV_VAR]: configPath })).toBe(
      configPath,
    );
  });

  it("should resolve a relative env var against the working directory", () => {
    expect(defaultSquadConfigPath({ [CONFIG_PATH_ENV_VAR]: "cfg.json" })).toBe(
      path.resolve("cfg.json"),
    );
  });

  it("should fall back to the config file in the working directory", () => {
    expect(defaultSquadConfigPath({})).toBe(path.resolve(CONFIG_FILENAME));
  });
});
