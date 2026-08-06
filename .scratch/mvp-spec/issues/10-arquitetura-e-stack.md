# Arquitetura e stack

Type: grilling
Status: resolved
Blocked by: 03, 04, 07

## Question

Dada a forma do produto e o escopo do MVP: arquitetura e stack (linguagem, framework, storage), honrando as prioridades do usuário: e2e type-safety, observabilidade, testes automatizados, manutenibilidade, lazy-by-default.

Já decidido pelo [Posicionamento](06-posicionamento-plataforma-vs-cunha.md) — não rediscutir: roda na máquina do operador (único usuário); Azure DevOps é a fonte da verdade (ferramenta guarda só estado de sessão, ex.: SQLite); repos = checkouts locais do operador. Resta decidir: runtime de agente (validar a recomendação do [Runtime](04-runtime-de-agente.md) — Agent SDK TS), framework web da UI de sessão, formato do estado de sessão, e como a UI de sessão fala com o agente (streaming/HITL).

Saída: decisões de arquitetura registradas (ADRs onde a decisão for difícil de reverter e fruto de trade-off real).

## Answer

Resolvido em grilling com o Lucas (4 decisões confirmadas). **Fato novo da sessão:** o Lucas migra a assinatura pessoal para Codex com GLM 5.2 como fallback na próxima sprint — isso derrubou a recomendação preliminar (Claude Agent SDK) por custo; research adicional em [research/codex-glm-runtime.md](../research/codex-glm-runtime.md).

**Arquitetura consolidada:**

- **Processo único**: app **Next.js** (App Router) na máquina do operador; UI de sessão via **SSE**; comandos/respostas por rotas tipadas; monorepo TS e2e.
- **Módulo `agent-runtime`**: cliente JSON-RPC fino para o **`codex app-server`** (login ChatGPT gerenciado, coberto pela assinatura). `requestUserInput`/approvals ↔ HITL da UI; `thread/resume` ↔ retomada de cerimônia; MCP do ADO para leituras. Interface estreita com costura pronta para GLM via Agent SDK→Z.ai — **fora do MVP**; GLM dentro do Codex vetado (termos). [ADR 0001](../../../docs/adr/0001-codex-app-server-como-runtime.md).
- **Módulo `ado-client`**: REST tipado (zod), **única porta de escrita** no ADO; usado pelo despejo e pelo script de métricas. LLM redige, código grava. [ADR 0002](../../../docs/adr/0002-escrita-no-ado-e-deterministica.md).
- **Persistência**: **SQLite + Drizzle** — sessão/decisões/transcript gravados na hora (cerimônia sobrevive a crash/refresh); ADO segue fonte da verdade. [ADR 0003](../../../docs/adr/0003-azure-devops-como-fonte-da-verdade.md).
- **Observabilidade**: logs estruturados nas duas fronteiras (`agent-runtime`: eventos/turnos; `ado-client`: cada escrita com payload); transcript persistido. **Testes**: unit nas checagens mecânicas (citações, gate) e no `ado-client` (mock REST); integração no fluxo de despejo.
