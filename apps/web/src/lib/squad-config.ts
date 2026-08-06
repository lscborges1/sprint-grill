import { loadSquadConfig } from "@sprint-griller/core";
import type { SquadConfig } from "@sprint-griller/core";

let cached: SquadConfig | undefined;

/**
 * Config da squad para Server Components. Lida uma vez por processo: a validação
 * que decide se o app sobe já rodou na inicialização (ver `lib/startup`), e o
 * arquivo não muda enquanto a cerimônia acontece.
 */
export function getSquadConfig(): SquadConfig {
  cached ??= loadSquadConfig();
  return cached;
}
