import { z } from "zod";
import { ConfigError } from "../config-error";

export const ADO_PAT_ENV_VAR = "AZURE_DEVOPS_PAT";

const adoEnvSchema = z.object({
  [ADO_PAT_ENV_VAR]: z
    .string({ error: "defina a variável com um Personal Access Token do Azure DevOps" })
    .min(1, "defina a variável com um Personal Access Token do Azure DevOps"),
});

export interface AdoCredentials {
  readonly pat: string;
}

/**
 * Credenciais do Azure DevOps vêm do ambiente, não do arquivo de config: segredo
 * não entra em arquivo que o Operador edita à mão e nunca é logado.
 */
export function loadAdoCredentials(
  env: Record<string, string | undefined> = process.env,
): AdoCredentials {
  const result = adoEnvSchema.safeParse(env);

  if (!result.success) {
    throw new ConfigError(
      `Credenciais do Azure DevOps inválidas:\n${z.prettifyError(result.error)}`,
    );
  }

  return { pat: result.data[ADO_PAT_ENV_VAR] };
}
