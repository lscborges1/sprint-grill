import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ConfigError } from "../config-error";

export const CONFIG_PATH_ENV_VAR = "SPRINT_GRILLER_CONFIG";
export const CONFIG_FILENAME = "sprint-griller.config.json";
export const CONFIG_EXAMPLE_FILENAME = "sprint-griller.config.example.json";

const repoConfigSchema = z.object({
  name: z.string().min(1, "informe um nome curto para o repo"),
  path: z
    .string()
    .min(1, "informe o caminho do checkout local")
    .refine((value) => path.isAbsolute(value), {
      message: "deve ser um caminho absoluto",
    }),
});

/**
 * Config da squad: definida uma vez pelo Operador, nunca por User Story.
 * O PAT do Azure DevOps não mora aqui — vem do ambiente (ver `ado-credentials`).
 */
export const squadConfigSchema = z.object({
  azureDevOps: z.object({
    organization: z.string().min(1, "informe a organização do Azure DevOps"),
    project: z.string().min(1, "informe o projeto do Azure DevOps"),
  }),
  repos: z.object({
    primary: repoConfigSchema,
    related: z.array(repoConfigSchema).readonly().default([]),
  }),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type SquadConfig = z.infer<typeof squadConfigSchema>;

/** Caminho da config: `SPRINT_GRILLER_CONFIG` ou o arquivo no diretório atual. */
export function defaultSquadConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env[CONFIG_PATH_ENV_VAR];
  return path.resolve(fromEnv ? fromEnv : CONFIG_FILENAME);
}

/**
 * Lê e valida a config da squad. Lança {@link ConfigError} apontando o campo
 * quando algo está errado — não existe config "meio válida".
 */
export function loadSquadConfig(
  configPath: string = defaultSquadConfigPath(),
): SquadConfig {
  const result = squadConfigSchema.safeParse(readConfigFile(configPath));

  if (!result.success) {
    throw new ConfigError(invalidConfigMessage(configPath, result.error));
  }

  assertRepoDirectoriesExist(result.data, configPath);
  return result.data;
}

function readConfigFile(configPath: string): unknown {
  let contents: string;

  try {
    contents = readFileSync(configPath, "utf8");
  } catch (cause) {
    if (isErrnoException(cause) && cause.code === "ENOENT") {
      throw new ConfigError(
        `Config da squad não encontrada em ${configPath}.\n` +
          `Na raiz do repo, copie ${CONFIG_EXAMPLE_FILENAME} para ${CONFIG_FILENAME} ` +
          `e rode \`pnpm dev\` de lá, ou aponte a variável de ambiente ` +
          `${CONFIG_PATH_ENV_VAR} para o arquivo.`,
        { cause },
      );
    }
    throw new ConfigError(
      `Não foi possível ler a config da squad em ${configPath}.`,
      { cause },
    );
  }

  try {
    return JSON.parse(contents);
  } catch (cause) {
    throw new ConfigError(
      `Config da squad em ${configPath} não é um JSON válido.`,
      { cause },
    );
  }
}

/**
 * Caminho apontando para lugar nenhum é o erro de config mais comum, e só
 * apareceria muito depois (no meio de uma Investigação) se não fosse checado aqui.
 */
function assertRepoDirectoriesExist(
  config: SquadConfig,
  configPath: string,
): void {
  const repos = [
    { path: ["repos", "primary", "path"], repo: config.repos.primary },
    ...config.repos.related.map((repo, index) => ({
      path: ["repos", "related", index, "path"],
      repo,
    })),
  ];

  const issues = repos
    .filter(({ repo }) => !isDirectory(repo.path))
    .map(({ path: issuePath, repo }) => ({
      code: "custom" as const,
      path: issuePath,
      input: repo.path,
      message: `diretório não encontrado: ${repo.path}`,
    }));

  if (issues.length > 0) {
    throw new ConfigError(
      invalidConfigMessage(configPath, new z.ZodError(issues)),
    );
  }
}

function invalidConfigMessage(configPath: string, error: z.ZodError): string {
  return `Config da squad inválida em ${configPath}:\n${z.prettifyError(error)}`;
}

/** Caminho inexistente ou sem permissão conta como "não é um diretório". */
function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
