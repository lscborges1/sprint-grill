import path from "node:path";
import { defaultSquadConfigPath } from "./squad-config";

export const DB_PATH_ENV_VAR = "SPRINT_GRILLER_DB";
export const DB_DIRNAME = ".sprint-griller";
export const DB_FILENAME = "cerimonias.db";

/**
 * Onde mora o estado de cerimônia. Fica ao lado da config da squad porque é o
 * diretório que já pertence ao Operador — o banco é estado local descartável
 * ([ADR 0003](../../../../docs/adr/0003-azure-devops-como-fonte-da-verdade.md)),
 * não um segundo sistema de registro.
 */
export function defaultCeremonyDbPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env[DB_PATH_ENV_VAR];
  if (fromEnv) return path.resolve(fromEnv);

  return path.join(path.dirname(defaultSquadConfigPath(env)), DB_DIRNAME, DB_FILENAME);
}
