# Paisagem competitiva de refinamento assistido por IA

Type: research
Status: resolved

## Question

Que ferramentas existem (2024–2026) para refinamento de backlog / geração de spec assistidos por IA, e onde está o vão que este produto ocuparia? Cobrir pelo menos: Atlassian Rovo / recursos de IA do Jira, GitHub Copilot no Azure DevOps/Azure Boards, Linear AI, Notion AI, ChatPRD, e o movimento de spec-driven development (Amazon Kiro, GitHub spec-kit, similares). O que já tentou isso e falhou/pivotou, e por quê.

Fontes primárias: docs e anúncios oficiais dos produtos, não listicles. Saída: quadro comparativo curto + onde nenhuma delas resolve o problema de refinamento HITL ancorado no código da squad.

## Answer

Findings completos: [research/paisagem-competitiva.md](../research/paisagem-competitiva.md).

**Quadro (gist):**
- **Atlassian Rovo / Jira AI** — work breakdown + "Work Readiness Checker Agent"; SaaS, incluído nos planos Cloud.
- **GitHub Copilot + Azure Boards** — work item → coding agent → draft PR (preview 2025), mas **exige repo no GitHub — não suporta Azure Repos** e pula o refinamento.
- **Extensões do marketplace ADO** (AI Work Item Assistant, Copilot4DevOps) — geram stories/ACs **sem ler código**.
- **Linear** — Product Intelligence (triagem/dupes) + Linear Agent (beta mar/2026).
- **Notion AI / ChatPRD** — PRDs genéricos ou "grill" estilo coaching de CPO (US$8–24/mês), sem contexto de código, sem ADO.
- **Kiro (Amazon)** — spec → EARS stories → design → tasks, mas no IDE, dev-cêntrico.
- **GitHub Spec Kit** — OSS, CLI com `/speckit.clarify` (perguntas ancoradas no repo), mas sem PO e sem tracker.
- **Fracassos instrutivos**: Height (pivot "autonomous PM" out/2024 → shutdown set/2025 — custo de inferência vs assento de US$7–12) e Tessl (repivotou de specs para agent skills, jan/2026).

**O vão**: ninguém cobre `US crua → interrogatório HITL → decisões registradas → spec → tasks` no Azure DevOps *ancorado no código*. Ferramentas dev-cêntricas (Kiro/Spec Kit) leem código mas excluem Produto e o tracker; ferramentas de PM (Rovo/ChatPRD/Notion) refinam texto sem código; a ponte da Microsoft nem suporta Azure Repos; nenhuma persiste o Q&A como artefato de decisão; nenhuma opção PM é self-hosted. **A combinação código ⊗ PO-no-loop ⊗ Azure DevOps ⊗ self-hosted está vazia.** Lição do Height: cuidado com a economia de inferência num produto por assento — dogfood self-hosted não sofre disso.
