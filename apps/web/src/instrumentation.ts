export async function register(): Promise<void> {
  // A validação usa fs e derruba o processo: só existe no runtime Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateStartupConfig } = await import("./lib/startup");
  validateStartupConfig();
}
