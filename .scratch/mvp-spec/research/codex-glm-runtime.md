# Runtime agentico com assinaturas Codex + GLM 5.2 — research

Data da pesquisa: 2026-08-06. Contexto: ferramenta self-hosted de refinamento de User Stories (Node/TS, app web local) precisa de runtime agentico embutível: leitura de repos locais, HITL pergunta-a-pergunta via streaming para UI própria, sessões retomáveis, redação de artefatos, MCP do Azure DevOps. O dono migrará da assinatura Claude para **ChatGPT (Codex)** com **GLM Coding Plan (Zhipu/Z.ai)** como fallback.

---

## 1. Codex como runtime embutível

### 1.1 Duas superfícies de integração

**(A) `@openai/codex-sdk` (TypeScript)** — wrapper do CLI `codex` (spawna o binário e troca eventos JSONL via stdin/stdout). Versão atual: **0.146.1, publicada 2026-08-05** (npm registry, checado 2026-08-06).
- APIs: `codex.startThread(options)`, `codex.resumeThread(threadId)` (sessões persistidas em `~/.codex/sessions`), `thread.run(prompt)` (bufferizado) e `thread.runStreamed(prompt)` → async generator de eventos estruturados (`item.started/updated/completed`, `turn.completed` com usage). Structured output via `outputSchema` (JSON Schema; interop com Zod via `zod-to-json-schema` target `"openAi"`). Imagens locais via `{ type: "local_image", path }`.
  - Fonte: https://github.com/openai/codex/blob/main/sdk/typescript/README.md (branch main, acessado 2026-08-06)
- Acesso a repos locais: `workingDirectory` por thread; exige repo Git por default (`skipGitRepoCheck: true` para pular); `env` controlável (citam explicitamente hosts Electron/sandboxed); `config` vira flags `--config key=value` (qualquer config TOML do Codex, incl. `mcp_servers`).
- **Limitação central para HITL**: as `ThreadOptions` têm `sandboxMode` (`read-only | workspace-write | danger-full-access`) e `approvalPolicy` (`never | on-request | on-failure | untrusted`), **mas o SDK não expõe nenhum callback de aprovação nem de pergunta ao usuário** — não há equivalente a `canUseTool`/`AskUserQuestion` nessa camada. Verificado no código-fonte:
  - https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts e `src/thread.ts` (acessado 2026-08-06)

**(B) `codex app-server` (protocolo JSON-RPC)** — a superfície que alimenta a extensão oficial do VS Code; JSON-RPC bidirecional sobre stdio (websocket `--listen ws://` existe mas é "currently experimental and unsupported").
- Fonte primária: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md (acessado 2026-08-06); docs: https://developers.openai.com/codex/app-server
- Ciclo: `thread/start` / `thread/resume` / `thread/fork` / `thread/list` → `turn/start` → notificações de streaming (`item/started`, `item/agentMessage/delta`, `item/completed`, `turn/completed` com token usage) → `turn/interrupt` para cancelar. **Sessões retomáveis são nativas do protocolo.**
- **HITL nativo, três mecanismos** (todos server-initiated JSON-RPC requests que a UI responde):
  1. `item/commandExecution/requestApproval` e `item/fileChange/requestApproval` — aprovações de comando/diff com decisões `accept | acceptForSession | decline | cancel` (+ amendments de execpolicy/network).
  2. **`item/tool/requestUserInput`** — ferramenta embutida `tool/requestUserInput`: "prompt the user with 1–3 short questions for a tool call and return their answers" (marcada experimental; campo `isBlocking`). **É o equivalente direto do AskUserQuestion** para o fluxo pergunta-a-pergunta.
  3. `mcpServer/elicitation/request` — elicitations de MCP servers (form / openai-form / url).
- Auth pelo protocolo: `account/login/start` com `type: "chatgpt"` (OAuth navegador), `"chatgptDeviceCode"` ou `"apiKey"`; `account/read`, `account/rateLimits/read` (limites do plano ChatGPT em tempo real). Modo "ChatGPT managed" é o **recomendado** no README.
- MCP: `mcpServerStatus/list`, `mcpServer/tool/call`, `config/mcpServer/reload`, OAuth de MCP servers — servers configurados no `config.toml` (`[mcp_servers.*]`), então o MCP do Azure DevOps entra por config.
- Nota de compliance: apps devem se identificar via `clientInfo`; a lista de "known clients" é para logging **enterprise** ("If you are developing a new Codex integration that is intended for enterprise use, please contact us") — não bloqueia uso pessoal/local.
- **Não existe pacote npm oficial com bindings TS do protocolo** (`@openai/codex-app-server-protocol` / `@openai/codex-protocol` não existem no registry, checado 2026-08-06). É preciso escrever um cliente JSON-RPC/stdio fino (spawn de `codex app-server` que vem no pacote `@openai/codex`, v0.146.1).

**(C) `codex exec` headless** — terceira via mais simples: `codex exec --json` emite JSONL de todos os eventos; `codex exec resume --last | <SESSION_ID>` retoma sessão. Sem canal de resposta para aprovações/perguntas (política de aprovação vira `never` na prática) — serve para jobs batch, não para o fluxo HITL.
- Fontes: https://developers.openai.com/codex/sdk ; guia: https://www.developersdigest.tech/blog/codex-exec-ci-headless-guide (2026)

### 1.2 Auth com assinatura ChatGPT (política)

- Docs oficiais do SDK: "The Codex SDK can authenticate with either an existing Codex/ChatGPT login or an API key. OpenAI **recommends API key** authentication for programmatic Codex CLI workflows **such as CI/CD jobs**" — ou seja, login ChatGPT é caminho suportado (é o modo "recomendado" no app-server README para clients interativos); a recomendação de API key mira CI/automação compartilhada, não apps locais interativos de uso próprio. Fontes: https://developers.openai.com/codex/sdk (acessado 2026-08-06); app-server README (seção Authentication modes).
- Plano ChatGPT Plus/Pro inclui Codex (web, CLI, IDE, SDK local) com limites de uso; excedente via créditos com preço estilo token da API. Fontes: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan ; https://chatgpt.com/codex/pricing/ ; https://learn.chatgpt.com/docs/pricing
- AGENTS.md é o mecanismo nativo de instruções por repo (equivalente a CLAUDE.md/skills leves): https://developers.openai.com/codex (docs oficiais); cheatsheet: https://shipyard.build/blog/codex-cli-cheat-sheet/

## 2. GLM 5.2 (Zhipu / Z.ai)

- **GLM-5.2**: lançado ~13/jun/2026; open-weight MIT, ~744B parâmetros (~40B ativos), contexto 1M. Fontes: https://codersera.com/blog/glm-5-2-release-1m-context-coding-2026/ (jun/2026); https://datanorth.ai/news/zhipu-ai-releases-glm-5-2 ; https://developers.cloudflare.com/workers-ai/models/glm-5.2/
- **GLM Coding Plan** (docs oficiais, acessado 2026-08-06): tiers Lite ($18/mês, ~2.000 créditos/5h) / Pro / Max; modelos do plano: **GLM-5.2, GLM-5-Turbo, GLM-4.7** (+GLM-4.6V visão). Fonte: https://docs.z.ai/devpack/overview
- **Dois endpoints do plano** (fonte: https://docs.z.ai/devpack/quick-start):
  - **Anthropic Messages (compatível)**: `https://api.z.ai/api/anthropic` — é isto que faz Claude Code/Claude-likes funcionarem via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`.
  - **OpenAI Chat Completions**: `https://api.z.ai/api/coding/paas/v4` — **não há Responses API**, que é o wire protocol preferido do Codex.
- **Restrição de termos**: o plano é "**strictly limited to use within officially supported tools and products**"; FAQ: uso direto via API/SDK fora das ferramentas suportadas não é permitido. Lista oficial (acessado 2026-08-06): Claude Code, Claude for IDE, ZCode, OpenCode, Pi, Cursor, Cline, TRAE, Qoder, Droid, Kilo Code, Roo Code, Crush, Goose, Eigent, OpenClaw, Hermes Agent, SillyTavern. **Codex CLI NÃO está na lista; Claude Agent SDK também não aparece nomeado (Claude Code sim).** Fontes: https://docs.z.ai/devpack/quick-start ; https://docs.z.ai/devpack/faq ; https://docs.z.ai/devpack/tool/others
- **GLM atrás do Codex CLI**: tecnicamente possível via `[model_providers]` custom com `base_url = "https://api.z.ai/api/coding/paas/v4"` e `wire_api = "chat"` (guia: https://aiengineerguide.com/til/openai-codex-with-z-ai/), mas há relatos de atrito de integração (tool-calls/reasoning) — issue: https://github.com/openai/codex/issues/9612 — e alguns guias recomendam proxy LiteLLM para traduzir Chat Completions↔Responses (https://api.treerouter.ai/en/blog/glm-5-2-codex-lite-llm-integration-guide). Além do atrito técnico, **fica fora da lista oficial do plano** (risco de termos).
- **GLM atrás do Claude Code**: caminho oficial e principal do plano (https://docs.z.ai/devpack/tool/claude). Marketing da Z.ai posiciona GLM-5.1/5.2 como drop-in do Claude Code a fração do custo (claims de ~94% do Opus 4.6 em benchmarks de coding — fonte secundária, tratar com ceticismo: https://www.datallmlab.com/blog/glm-coding-plan.html).

## 3. Claude Agent SDK sem assinatura Claude

- `@anthropic-ai/claude-agent-sdk` v0.3.223 (publicado 2026-08-05; ativo). O SDK usa o Claude Code CLI como runtime e **honra `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`** — apontar para `https://api.z.ai/api/anthropic` com a key do GLM Coding Plan funciona sem mudança de código. Fontes: https://docs.litellm.ai/docs/tutorials/claude_agent_sdk ; https://avasdream.com/blog/claude-code-alternative-providers ; https://docs.requesty.ai/integrations/anthropic-agent-sdks
- Status de suporte: a Anthropic documenta oficialmente Bedrock/Vertex como providers alternativos (https://code.claude.com/docs/en/agent-sdk/overview); endpoints third-party "Anthropic-compatíveis" (Z.ai, LiteLLM, OpenRouter) funcionam porque o wire protocol é o mesmo, mas **não são garantidos pela Anthropic** — estabilidade depende da fidelidade do endpoint (a Z.ai é hoje o único provider com endpoint Anthropic-compatível nativo além da própria Anthropic).
- O que se perde ao trocar o modelo por GLM: modelos Anthropic (qualidade de tool-use dos Opus/Sonnet no harness para o qual o SDK foi treinado), features server-side da Anthropic (web search gerenciado, caching específico), e a garantia de termos — o GLM plan lista "Claude Code" como ferramenta suportada, não o Agent SDK embutido em app próprio (zona cinzenta; na prática o SDK roda o mesmo binário do Claude Code).
- O que se mantém: toda a DX de integração — `query()` streaming, **`canUseTool`**, hooks, **`AskUserQuestion`**, sessões (`resume`), subagents, MCP servers — que é exatamente o shape de HITL que a ferramenta precisa.

## 4. Comparativo e recomendação

| Critério | (a) Codex app-server/SDK (assinatura ChatGPT) | (b) Claude Agent SDK + API key Anthropic | (c) Claude Agent SDK → GLM (api.z.ai/api/anthropic) | (d) Abstração multi-runtime |
|---|---|---|---|---|
| Custo com as assinaturas do dono | **Coberto** (plano ChatGPT; excedente via créditos) | **Não coberto** — pay-per-token extra | **Coberto** (GLM Coding Plan, Lite $18/mês) | Custo dos dois + esforço |
| HITL (pergunta-a-pergunta) | Nativo no **app-server**: `item/tool/requestUserInput` (experimental) + approvals; ausente no SDK TS exec-based | Nativo e maduro: `canUseTool`, `AskUserQuestion`, hooks | Igual a (b) — mesmo SDK | Precisa unificar dois modelos de HITL diferentes |
| Streaming p/ UI própria | JSONL/JSON-RPC com deltas (`item/agentMessage/delta`) | Async iterables TS de primeira classe | Igual a (b) | Duplicado |
| Esforço de integração | Médio: escrever cliente JSON-RPC/stdio (sem lib npm oficial do protocolo) | Baixo: SDK TS completo | Baixo (SDK) + risco de fidelidade do endpoint GLM | Alto — YAGNI |
| Repos locais | Sim (workingDirectory, sandbox, exige git por default) | Sim | Sim | — |
| MCP (Azure DevOps) | Sim (`config.toml [mcp_servers]`, gerência via protocolo) | Sim (opção `mcpServers` no SDK) | Sim | — |
| Skills/instruções | AGENTS.md | CLAUDE.md/skills/subagents | Igual a (b) | — |
| Maturidade/termos | Protocolo que move a extensão VS Code oficial; login ChatGPT é modo recomendado; `requestUserInput` experimental | Totalmente oficial | Endpoint oficial da Z.ai p/ Claude Code; SDK embutido = zona cinzenta dos termos do plano; qualidade tool-use GLM < Anthropic | — |

**Recomendação preliminar**: adotar **(a) Codex via `codex app-server`** como runtime do MVP — é o único caminho onde a assinatura que o dono terá cobre o uso, com HITL, resume e MCP nativos no protocolo; o custo é escrever um cliente JSON-RPC/stdio fino (o `@openai/codex-sdk` puro não serve para o fluxo HITL). Para o fallback GLM, **não** colocar GLM atrás do Codex (fora dos termos do plano + atrito Responses/Chat); se o fallback for mesmo necessário no MVP, o caminho de menor risco é (c) — Claude Agent SDK apontado para `api.z.ai/api/anthropic` — atrás de uma interface interna mínima (eventos de turno + pergunta pendente), não uma abstração multi-runtime completa (d = YAGNI no MVP).
