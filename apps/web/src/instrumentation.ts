export async function register(): Promise<void> {
  // A validação usa fs e derruba o processo: só existe no runtime Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateStartupConfig } = await import("./lib/startup");
  const preparo = validateStartupConfig();

  // Preparo automático ([ADR 0005](../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md)):
  // opt-in pela config; no modo demo não roda — demo não dispara agente.
  if (preparo && process.env.REFINA_DEMO !== "1") {
    const { loadSquadConfig } = await import("@sprint-griller/core");
    const { startPreparoScheduler } = await import("./lib/preparo");
    startPreparoScheduler(loadSquadConfig(), preparo);
  }
}
