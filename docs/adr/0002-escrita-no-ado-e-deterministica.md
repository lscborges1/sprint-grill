# Escrita no Azure DevOps é sempre código determinístico

O despejo (comments de decisão, tasks filhas, estimativas, wiki) é a etapa que toca o tracker da squad — errar aqui queima a confiança que o rollout precisa. Decidimos que o LLM apenas *redige* artefatos; quem grava é o módulo `ado-client` (REST tipado, zod nas respostas, única porta de escrita, logs estruturados por operação). O modelo nunca executa tool-call de escrita no ADO.

## Consequences

- Despejo testável (mock REST), com retry/rollback controlados e erros precisos.
- Leituras de contexto (Investigação, fatos ao vivo) podem continuar via MCP pelo agente — leitura errada se corrige de graça, escrita errada não.
- O script de métricas reusa o `ado-client`.
