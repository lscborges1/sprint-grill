# Sprint Griller

Ferramenta de refinamento da squad: **Investigação** que chega pronta antes da cerimônia e **grilling coletivo** com decisões documentadas, tudo despejado no Azure DevOps.

Roda na máquina do **Operador**, em processo único. O Azure DevOps é a fonte da verdade ([ADR 0003](docs/adr/0003-azure-devops-como-fonte-da-verdade.md)); glossário do domínio em [CONTEXT.md](CONTEXT.md), spec do MVP em [`.scratch/mvp-spec/spec.md`](.scratch/mvp-spec/spec.md).

## Setup

Requer Node 22+ e pnpm 11+.

```bash
pnpm install

# 1. Config da squad: repos locais + org/projeto do ADO.
cp sprint-griller.config.example.json sprint-griller.config.json
$EDITOR sprint-griller.config.json

# 2. Credencial do ADO (segredo — nunca vai para o arquivo de config).
cp apps/web/.env.example apps/web/.env
$EDITOR apps/web/.env

pnpm dev
```

Os repos são definidos **uma vez**, aqui — nenhuma cerimônia começa escolhendo repositório. Config inválida derruba o app na inicialização com a mensagem apontando o campo.

O caminho do arquivo de config pode ser trocado com `SPRINT_GRILLER_CONFIG`.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe o app em <http://localhost:3000> |
| `pnpm check` | Typecheck + lint + testes — o comando único do CI |
| `pnpm test` | Só os testes (vitest) |
| `pnpm build` / `pnpm start` | Build e execução em modo produção |

## Estrutura

```
apps/web                  app Next.js (App Router): UI de sessão e rotas
packages/core             config da squad (zod) e logging estruturado
packages/agent-runtime    cliente do `codex app-server` (streaming, HITL, resume)
docs/adr                  decisões de arquitetura difíceis de reverter
```

Módulo previsto pela spec e ainda não escrito: `ado-client` (única porta de escrita no ADO).

### Rodar o agente

O `agent-runtime` fala com o `codex app-server` usando o login ChatGPT do Operador ([ADR 0001](docs/adr/0001-codex-app-server-como-runtime.md)). Requer o Codex CLI no PATH e `codex login`.

```bash
pnpm --filter @sprint-griller/agent-runtime harness "investigue o cache de sessão"
pnpm --filter @sprint-griller/agent-runtime harness --resume <sessionId> "e o que ficou pendente?"
```

O harness mostra o turno streamando, pergunta no terminal quando o agente pede input, e imprime o id da sessão para retomar depois.
