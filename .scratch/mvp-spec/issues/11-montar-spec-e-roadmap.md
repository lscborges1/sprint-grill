# Montar spec.md e roadmap

Type: task
Status: resolved
Assignee: lucas
Blocked by: 07, 08, 09, 10, 12, 13

## Question

Consolidar todas as decisões do mapa em `.scratch/mvp-spec/spec.md` no formato to-spec (com unknowns explícitos), incluindo: posicionamento, escopo do MVP, princípios de qualidade de IA, métricas com baseline, arquitetura/stack, e roadmap incremental triando o backlog de ~20 itens do prompt original em fases (com critério de quando cada item entra). Este ticket fecha o mapa — depois dele, o caminho é implementação.

## Answer

Spec entregue: [`../spec.md`](../spec.md) — síntese pura das decisões dos 12 tickets fechados, sem decisão nova.

- **Formato to-spec estendido**: Problem Statement / Solution / User Stories (26, por ator: Operador, Dev, PO, Squad, Agente de implementação) / Implementation Decisions (com os 4 princípios de qualidade da IA como requisitos testáveis) / Testing Decisions (seams = `agent-runtime` e `ado-client`) / + seções que o mapa exigia: Métricas e baseline, Rollout, **Unknowns explícitos** (6, cada um com dono natural), Roadmap, Out of Scope.
- **Roadmap incremental** triando os 20 itens do backlog original, com critério observável de entrada por fase (nunca cronograma): **Já coberto pelo MVP** (7 itens — MCP, impacto cross-repo, busca de código, sugestão de arquivos, histórico via ADO, métricas, export MD); **Fase 1 — Aprofundar a cerimônia** (perguntas padrão, ADR, Mermaid, plano de testes; entra com rampa em expansão); **Fase 2 — Escalar e derivar** (webhook, multi-operador, sugestão de estimativa, busca semântica/base de conhecimento, matriz de riscos, fallback GLM; entra com o checkpoint da 6ª sprint decidindo manter); **Fase 3 — Orquestração** (mapa próprio; entra com gargalo de throughput diagnosticado); **Fase Mercado** (GitHub, Jira, multi-LLM, multi-tenant, débito técnico; só se o destino for redesenhado).
- A névoa "triagem do backlog em fases" do mapa graduou para dentro da spec e foi limpa do **Not yet specified**.

**O mapa está completo**: nenhum ticket aberto, névoa vazia — o caminho agora é implementação (sugestão: `/to-tickets` sobre a spec, ou novo esforço de plano de implementação).
