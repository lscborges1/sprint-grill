import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Os pacotes do monorepo são consumidos como TypeScript direto.
  transpilePackages: [
    "@sprint-griller/ado-client",
    "@sprint-griller/agent-runtime",
    "@sprint-griller/ceremony",
    "@sprint-griller/core",
    "@sprint-griller/investigation",
  ],
  // Binding nativo do SQLite: bundlar quebra o `.node`.
  serverExternalPackages: ["better-sqlite3"],
  // As instruções para agentes deste repo vivem na raiz, não em arquivos
  // gerados a cada `next dev`.
  agentRules: false,
  async rewrites() {
    return process.env.NODE_ENV === "development"
      ? [{ source: "/__dev/ui", destination: "/dev-ui" }]
      : [];
  },
};

export default nextConfig;
