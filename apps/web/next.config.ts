import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Os pacotes do monorepo são consumidos como TypeScript direto.
  transpilePackages: ["@sprint-griller/ado-client", "@sprint-griller/core"],
  // As instruções para agentes deste repo vivem na raiz, não em arquivos
  // gerados a cada `next dev`.
  agentRules: false,
};

export default nextConfig;
