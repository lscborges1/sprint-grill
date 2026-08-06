# Runtime de agente para o fluxo de refinamento

Type: research
Status: resolved

## Question

Quais são as opções para rodar um fluxo agentico tipo grilling dentro de uma ferramenta própria self-hosted (local ou VPS), e o que cada uma implica? Comparar: (a) Claude Agent SDK (TypeScript), (b) invocar o Claude Code CLI em modo headless/`-p`, (c) tool-use loop direto na Claude API. Para cada uma: modelo de auth e custo (assinatura vs API key), acesso ao filesystem/repos, reuso de skills existentes, streaming para uma UI web, e maturidade.

Fontes primárias: docs oficiais da Anthropic (Agent SDK, Claude Code headless, Messages API). Saída: tabela de trade-offs com recomendação preliminar.

## Answer

Findings completos: [research/runtime-de-agente.md](../research/runtime-de-agente.md).

| Critério | (a) Agent SDK TS | (b) CLI headless `-p` | (c) Messages API |
|---|---|---|---|
| Assinatura Pro/Max | Uso pessoal: sim (consome limites da assinatura); produto para terceiros: proibido → API key | Igual (a); `--bare` exige API key | Não — só API key pay-per-token |
| Repos/filesystem | Nativo | Nativo | Você implementa |
| Skills (SKILL.md) | Nativo | Nativo | Não |
| UI web (stream/sessões/HITL) | Async iterator, `resume`/`fork`, `AskUserQuestion` + `canUseTool` | NDJSON manual, sem hook interativo | SSE limpo, mas tudo por sua conta |
| Maturidade | Boa; API ainda muda (ex.: V2 removida na 0.3.142) | Estável p/ scripts | Messages API GA; Tool Runner beta |

**Recomendação preliminar: (a) Claude Agent SDK TypeScript** — único que entrega acesso a repos + skills + sessões retomáveis + human-in-the-loop (`AskUserQuestion`) prontos, exatamente o formato do fluxo de grilling. Ressalvas: (1) política — assinatura Pro/Max só cobre uso próprio; expor a ferramenta a terceiros/VPS multiusuário exige API key pay-per-token; (2) pinar versão do SDK (API instável). (c) é a evolução multi-tenant; (b) serve só para protótipo. Decisão final no ticket de [Arquitetura e stack](10-arquitetura-e-stack.md).
