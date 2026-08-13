# Sprint Griller

Ferramenta de refinamento da squad: **Investigação** que chega pronta antes da cerimônia e **grilling coletivo** com decisões documentadas, tudo despejado no Azure DevOps.

Roda na máquina do **Operador**, em processo único. O Azure DevOps é a fonte da verdade ([ADR 0003](docs/adr/0003-azure-devops-como-fonte-da-verdade.md)); glossário do domínio em [CONTEXT.md](CONTEXT.md), spec do MVP em [`.scratch/mvp-spec/spec.md`](.scratch/mvp-spec/spec.md).

## Setup

Requer Node 22+ e pnpm 11+.

```bash
pnpm install

# 1. Config da squad: repos locais + organização/projeto do ADO.
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
| `pnpm rolagem` | Baseline de rolagem das últimas 6 sprints (ver abaixo) |
| `pnpm check` | Typecheck + lint + testes — o comando único do CI |
| `pnpm test` | Só os testes (vitest) |
| `pnpm build` / `pnpm start` | Build e execução em modo produção |

## Estrutura

```
apps/web                  app Next.js (App Router): picker, UI de sessão e rotas
packages/core             config da squad (zod) e logging estruturado
packages/ado-client       fronteira do Azure DevOps (REST tipado com zod) + script de rolagem
packages/agent-runtime    cliente do `codex app-server` (streaming, HITL, resume)
packages/investigation    turno da Investigação + checagem de grounding + Markdown
packages/ceremony         sessão do grilling + persistência (SQLite) + Palco e Dossiê
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
| `<!-- sprint-griller:dump:<dumpId>:complete -->` | Prova final gravada na description após todo o despejo terminar | refinada |

Quem publica a Investigação precisa embutir `INVESTIGATION_MARKER`. O despejo só
pode chamar `publishDumpCompletion` depois de Spec, Tasks, estimativa, Registros
existirem no ADO. `SPEC_MARKER` identifica o bloco gerenciado da Spec, mas
sozinho não torna a US refinada.

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

> O PAT precisa do escopo **Work Items (leitura e escrita)** para publicar a
> Spec, as Tasks, a estimativa e os Registros de decisão na própria US.

## Baseline de rolagem

A métrica que julga a ferramenta não pode sair da ferramenta. A **taxa de
rolagem** — % de US que entram numa sprint e não concluem nela — é lida do
Azure DevOps cru, por um script fora da UI, auditável no repo:

```bash
pnpm rolagem              # últimas 6 sprints encerradas
pnpm rolagem --sprints 10
pnpm rolagem --before 2026-02-01  # baseline anterior ao rollout
```

A tabela sai no stdout (colável na retro) e o log estruturado no stderr.

Como a conta é feita, para quem for conferir o número na retro:

| Pergunta | Resposta do script |
|---|---|
| quais sprints entram | as últimas ~6 **encerradas** do time; use `--before AAAA-MM-DD` para fixar a baseline anterior a um rollout |
| quem entrou na sprint | união de dois snapshots WIQL `ASOF`: quem estava sob o path da sprint na **abertura** e no **fechamento** |
| quando a sprint fecha | no **fim** do último dia — o `finishDate` do ADO é a meia-noite que o abre, e parar ali jogaria fora o dia em que a squad mais fecha US |
| quem concluiu | estado no fechamento na categoria `Completed` do processo (`Closed` no Agile, `Done` no Scrum) |
| quem rolou | escopo menos concluídas — inclusive quem ficou em `Resolved` ou saiu da sprint antes do fim |
| e as removidas | US em categoria `Removed` saem do denominador: cancelamento não é rolagem |

Os dois snapshots existem porque nenhum sozinho basta: só a abertura perderia as
US puxadas no meio da sprint, e só o fechamento perderia as que saíram antes do
fim — que são exatamente as que rolaram. O que eles ainda não veem, e é bom
saber antes de defender o número na retro:

- US **puxada e retirada dentro da mesma sprint** não aparece em nenhum dos dois
  snapshots (subestima a rolagem);
- o fechamento é meia-noite **UTC**, então US concluída depois das 21h do último
  dia (horário de Brasília) conta como rolada (superestima);
- estado que o processo do ADO não declara mais cai em "rolou" — quando
  acontece, sai um `warn` no stderr com o nome do estado.

> Os números são sempre **agregados por sprint**: o script nunca pede ao Azure
> DevOps de quem é a US. A baseline existe para a squad julgar o processo, não
> para o processo julgar a squad. Nada aqui escreve no tracker.

## Cerimônia: o Palco

Com a Investigação **aprovada**, **Grelhar com a sala** abre a cerimônia: o
agente recebe a Investigação como insumo e conduz o grilling coletivo. O modo
**Palco** (`/cerimonia/<id da sessão>`) é o que a sala acompanha projetado —
pergunta atual, recomendação do agente, evidências, e a captura da decisão.

A sala se orienta sozinha: a **árvore de decisões** fica num trilho lateral (o
que já foi decidido, com a resposta; o que está em aberto, com a pergunta da vez
destacada) e a **barra de progresso** no topo tem um segmento por decisão e a
contagem de pendências. As duas saem do mesmo estado que o Palco já recebe por
SSE — não há contador guardado em lugar nenhum.

O que o Palco exibe é sempre **decisão**, nunca fato:

| Pergunta do agente | O que acontece |
|---|---|
| com `recommendation` | vai para o Palco, com a recomendação e as evidências |
| sem `recommendation` | recusada pelo runtime; volta para o agente buscar no código |

A recusa é mecânica, no schema da `ask_operator` — não depende do prompt. E do
outro lado, **só o formulário do Palco grava Registro de decisão**: `decidedBy` é
obrigatório, então nenhum caminho do laço de eventos do agente chega lá.

Sessão, decisões e transcript são gravados na hora em SQLite
(`.sprint-griller/cerimonias.db`, ou `SPRINT_GRILLER_DB`) — F5 no meio da
cerimônia volta no mesmo ponto, e o estado novo chega por SSE, sem polling. Se o
processo cair, o Palco mostra a cerimônia como **parada**: retomar casa com o
`thread/resume` do agente, levando as decisões já registradas. Decisão gravada
nunca se perde por causa de uma retomada que falhou.

O banco é estado local descartável ([ADR 0003](docs/adr/0003-azure-devops-como-fonte-da-verdade.md)):
depois do despejo, nada precisa ser consultado nele. Banco de uma versão de
schema anterior é recusado na abertura, com a mensagem mandando apagar o arquivo.

### Fato ao vivo

Dúvida **factual** que surge na sala não sai da cerimônia como "alguém verifica
depois": o Operador dispara a pergunta no Palco, o agente lê o código na hora e
responde com a citação que sustenta a resposta.

A Consulta roda numa **sessão de agente própria** — o turno do grilling está
parado na decisão que está projetada, e o codex só aceita um turno por sessão.
Na prática: a pergunta da sala continua na tela enquanto o fato é buscado, e a
Consulta funciona mesmo com a cerimônia parada esperando retomada.

A resposta passa pela mesma **checagem mecânica de citações** da Investigação
(`verifyGrounding`, sem LLM no caminho):

| Resposta do agente | O que a sala vê |
|---|---|
| citações conferem com o disco | o fato, com os arquivos citados |
| citação furada, ou nenhuma citação | a resposta marcada como **Não verificado**, com o motivo |
| turno quebrado | o erro, para o Operador perguntar de novo |

O que entra no transcript é `resposta-factual`, **nunca** `decisao`: a distinção
é de tipo, não de convenção — Consulta não tem `decidedBy` porque ninguém
decidiu nada, quem respondeu foi o repositório. E o despejo, quando existir, sabe
separar o que a sala decidiu do que ela só descobriu.
depois do despejo, nada precisa ser consultado nele.

> Mudança no schema do banco sobe o `SCHEMA_VERSION`, e um arquivo de versão
> anterior é recusado na abertura com a mensagem mandando apagá-lo.

## Dossiê: documento vivo e preview do despejo

**Abrir o Dossiê**, no Palco, leva à outra superfície da cerimônia
(`/cerimonia/<id da sessão>/dossie`) — em outra aba, de propósito: a sala segue
vendo o Palco enquanto o Operador revisa o documento na tela dele.

O Dossiê é a **Spec da US se formando ao vivo**, montada só do que a cerimônia
gravou:

| Seção | De onde vem |
|---|---|
| Decisões | Registros de decisão, com quem decidiu e quando |
| Pendências | perguntas que a sala não respondeu (inclusive as que um crash abandonou) |
| Contexto de impacto | seção da Investigação que passou na checagem de citações |
| Não verificado | o que o agente não conseguiu ancorar — hipótese, nunca fato |
| Fora de escopo | vazio até o Operador escrever |

Embaixo fica o **preview do despejo**: o mesmo documento em Markdown, renderizado
por código ([ADR 0002](docs/adr/0002-escrita-no-ado-e-deterministica.md)) e
**editável**. A IA redige, o humano assina — e o que o Operador salvar é o que o
despejo vai levar. A edição é gravada na sessão, no mesmo SQLite: sobrevive ao F5
e ao restart do app. Nada disto vai para o Azure DevOps antes do despejo.

O editor não é sobrescrito pelo que chega ao vivo — texto sendo digitado não pode
sumir porque a sala acabou de decidir. Em troca, quando o documento anda por
baixo da edição, a tela avisa e oferece **regenerar** (que descarta a edição):
despejar uma Spec sem a última decisão é o erro que esta aba existe para não
deixar passar calado.

Cada Task precisa conter, antes da assinatura, um link Markdown para a URL exata
da Spec da US atual. O Markdown assinado é a fonte do corpo publicado: o
despejo não acrescenta nem corrige links ou texto. A fronteira estreita depois
da assinatura admite somente metadados que ainda não existem ou que o ADO exige:

- marcadores determinísticos de armazenamento e reconciliação;
- conversão do Markdown assinado para o HTML dos campos de work item;
- cada link de Registro de decisão inserido na entrada correspondente da
  rastreabilidade que já foi revisada e assinada. O despejo não acrescenta o
  heading, a pergunta nem a resposta: só a URL, que passa a existir depois que
  o ADO publica o comment.

Relações nativas de pai e dependência e a estimativa são campos estruturados do
work item; não alteram o corpo assinado da Task.
