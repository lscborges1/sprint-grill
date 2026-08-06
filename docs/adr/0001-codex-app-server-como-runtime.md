# Codex app-server como runtime de agente

O fluxo de refinamento precisa de um runtime agentico embutido (repos locais, HITL, sessões retomáveis, MCP). Escolhemos o `codex app-server` (JSON-RPC/stdio, login ChatGPT gerenciado) atrás de um módulo interno `agent-runtime`, porque é o único runtime coberto pela assinatura que o operador terá (Codex) e tem HITL nativo (`requestUserInput`/approvals) que mapeia direto na UI de sessão.

## Considered Options

- **Claude Agent SDK TS**: melhor DX (`canUseTool`), mas deixaria de ser coberto por assinatura após a migração — vira custo pay-per-token permanente.
- **Messages/Responses API direta**: exigiria reimplementar filesystem, sessões e HITL.
- **GLM 5.2 dentro do Codex**: vetado — fora das ferramentas suportadas pelos termos do GLM Coding Plan, com atrito técnico conhecido. Se o fallback GLM um dia entrar, é via Agent SDK apontado ao endpoint Anthropic-compatível do Z.ai, atrás da mesma interface do `agent-runtime`. Sem abstração multi-runtime no MVP.

Fontes e datas: `.scratch/mvp-spec/research/codex-glm-runtime.md`.
