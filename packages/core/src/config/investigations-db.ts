import path from "node:path";
import { defaultSquadConfigPath } from "./squad-config";

export const INVESTIGATIONS_DB_PATH_ENV_VAR = "SPRINT_GRILLER_INVESTIGATIONS_DB";
export const INVESTIGATIONS_DB_DIRNAME = ".sprint-griller";
export const INVESTIGATIONS_DB_FILENAME = "investigacoes.db";

/**
 * Onde moram os runs de Investigação ([ADR 0005](../../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md)):
 * previews, fila e publicações locais. Irmão do banco de cerimônia — mesmo
 * diretório do Operador, mesmo contrato de estado local descartável
 * ([ADR 0003](../../../docs/adr/0003-azure-devops-como-fonte-da-verdade.md)).
 */
export function defaultInvestigationsDbPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env[INVESTIGATIONS_DB_PATH_ENV_VAR];
  if (fromEnv) return path.resolve(fromEnv);

  return path.join(
    path.dirname(defaultSquadConfigPath(env)),
    INVESTIGATIONS_DB_DIRNAME,
    INVESTIGATIONS_DB_FILENAME,
  );
}
