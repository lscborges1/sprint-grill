import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@sprint-griller/core` é consumido como TypeScript direto do monorepo.
  transpilePackages: ["@sprint-griller/core"],
  // As instruções para agentes deste repo vivem na raiz, não em arquivos
  // gerados a cada `next dev`.
  agentRules: false,
};

export default nextConfig;
