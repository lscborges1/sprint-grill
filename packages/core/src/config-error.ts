/**
 * Erro de configuração do Operador — sempre acionável: aponta o campo (ou a
 * variável de ambiente) que precisa ser corrigido. É o que derruba o app na
 * inicialização quando a config da squad não presta.
 */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}
