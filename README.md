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
apps/web                  app Next.js (App Router): picker, UI de sessão e rotas
packages/core             config da squad (zod) e logging estruturado
packages/ado-client       fronteira do Azure DevOps (REST tipado com zod)
packages/agent-runtime    cliente do `codex app-server` (streaming, HITL, resume)
packages/investigation    turno da Investigação + checagem de grounding + Markdown
docs/adr                  decisões de arquitetura difíceis de reverter
```

As duas fronteiras onde vivem os logs estruturados e os testes de comportamento são `ado-client` e `agent-runtime`.

### Rodar o agente

O `agent-runtime` fala com o `codex app-server` usando o login ChatGPT do Operador ([ADR 0001](docs/adr/0001-codex-app-server-como-runtime.md)). Requer o Codex CLI no PATH e `codex login`.

```bash
pnpm --filter @sprint-griller/agent-runtime harness "investigue o cache de sessão"
pnpm --filter @sprint-griller/agent-runtime harness --resume <sessionId> "e o que ficou pendente?"
```

O harness mostra o turno streamando, pergunta no terminal quando o agente pede input, e imprime o id da sessão para retomar depois.

## Status de refinamento no picker

A tela inicial lista as US da iteration atual e mostra em que ponto do fluxo cada uma está — **sem Investigação**, **investigada** ou **refinada**. Não existe banco de status: o `ado-client` procura marcadores HTML que a própria ferramenta embute nos artefatos que grava no Azure DevOps.

| Marcador | Artefato que o carrega | Status resultante |
|---|---|---|
| `<!-- sprint-griller:investigacao -->` | Investigação publicada como comment na US | investigada |
| `<!-- sprint-griller:spec -->` | Spec da US gravada pelo despejo (comment ou description) | refinada |

Quem grava um artefato novo precisa embutir o marcador correspondente (`INVESTIGATION_MARKER` / `SPEC_MARKER`, exportados por `@sprint-griller/ado-client`) — é o que fecha o ciclo entre despejo e picker.

## Investigação

**Investigar** no picker dispara um turno de agente e devolve a tela na hora: a
Investigação roda **AFK**, no processo do Operador, e o preview espera em
`/investigacao/<id da US>`. O agente lê a US no Azure DevOps e os repos do config
(o principal como `cwd`, os relacionados por caminho absoluto), e devolve um
relatório **estruturado** — o Markdown é renderizado por código, não pelo modelo
([ADR 0002](docs/adr/0002-escrita-no-ado-e-deterministica.md)).

Antes de valer alguma coisa, o relatório passa por uma **checagem mecânica de
citações** (`verifyGrounding`), sem LLM nenhum no caminho:

| Citação | Resultado |
|---|---|
| arquivo existe no repo citado | ok |
| `symbol` aparece no arquivo | ok |
| caminho não existe, aponta para fora do repo, ou não dá para ler | relatório **reprovado** |
| repo que não está na config da squad | relatório **reprovado** |

Reprovado é relatório que não publica: o preview mostra o que o agente disse com
o aviso de que não passou, e o próprio Markdown abre com o veredito e as citações
que falharam — o arquivo circula sozinho, não pode se apresentar como verificado.
O que o agente não conseguiu ancorar em código sai em **Não verificado**, e
suspeita de impacto em repo fora do config sai em **Impacto suspeito fora do
config** — nenhum dos dois entra no corpo como fato.

O turno roda em sandbox read-only, e não há humano na sala: todo pedido de
aprovação é recusado (é sempre um pedido para sair do sandbox — leitura dentro
dele não pergunta). Se o agente fizer uma pergunta, a resposta é que ninguém está
na tela, e a dúvida volta como furo da US.

> As Investigações vivem na memória do processo: reiniciar o app perde os
> previews que ainda não foram publicados no ADO.

### Publicar no Azure DevOps

O preview de uma Investigação **aprovada** tem um botão que grava o relatório
como comment Markdown na própria US — e é a única escrita no ADO que existe
hoje. Nada sai sozinho: a publicação é um clique do Operador, e quem grava é o
`ado-client`, nunca uma tool-call do modelo ([ADR 0002](docs/adr/0002-escrita-no-ado-e-deterministica.md)).

O comment carrega o `INVESTIGATION_MARKER`, então o picker passa a mostrar a US
como **investigada** na recarga seguinte — sem status guardado em lugar nenhum.

Toda escrita sai no log estruturado em `info`, com a URL da US e o tamanho do
corpo — sem copiar o relatório para o log. Quando ela falha, a mensagem diz se o
Operador precisa conferir a US antes de tentar de
novo: `HTTP 4xx` garante que nada foi gravado, mas `5xx`, conexão que cai no meio
ou resposta fora do contrato podem ter deixado o comment lá — republicar às cegas
é o que produz comment duplicado na US.

> O PAT precisa de escopo de **leitura e escrita** de work items. Só de leitura,
> o disparo funciona e a publicação volta com 403.
