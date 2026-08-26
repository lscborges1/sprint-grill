# Arquitetura do Refina

## Resumo

O Refina é um monorepo TypeScript com um app Next.js e pacotes internos. Ele roda localmente na máquina do Operador e usa Azure DevOps como fonte da verdade para backlog, US, Wiki e publicação de artefatos. A identidade visível do produto é **Refina**; namespaces, env vars, nomes de pacote e marcadores `sprint-griller:*` permanecem como compatibilidade interna.

## Estrutura real do repositório

```text
apps/web                  App Next.js: Picker, Investigação, Palco, Dossiê e rotas server actions
packages/core             Configuração da squad, credenciais ADO e logging estruturado
packages/ado-client       REST Azure DevOps: backlog, story, Wiki, publicação, métricas de rolagem
packages/agent-runtime    Cliente do codex app-server, protocolo, eventos, HITL e harness
packages/investigation    Prompts/contratos da Investigação, parsing, Markdown e grounding
packages/ceremony         Estado da cerimônia, SQLite, agenda, Spec, tickets e despejo
```

## Dependências externas

- Node.js 22+.
- pnpm 11+.
- Azure DevOps PAT com Work Items read/write e Wiki read para fluxo conectado.
- Codex CLI autenticado para executar o `codex app-server` usado pelo runtime de agente.
- Checkout local dos repositórios da squad informados no arquivo de config.

## Configuração

O setup documentado ainda usa nomes internos de compatibilidade:

```bash
cp sprint-griller.config.example.json sprint-griller.config.json
$EDITOR sprint-griller.config.json
cp apps/web/.env.example apps/web/.env
$EDITOR apps/web/.env
pnpm dev
```

`SPRINT_GRILLER_CONFIG` permite apontar para outro arquivo de config. O arquivo contém:

- `azureDevOps.organization`
- `azureDevOps.project`
- `repos.primary`
- `repos.related[]`

## Fluxo completo de uma US

```text
Azure DevOps backlog
  ↓
Picker lê US e status por marcadores no ADO
  ↓
Operador clica Investigar
  ↓
Refina busca detalhes da US e contexto Wiki
  ↓
agent-runtime inicia codex app-server no repo principal
  ↓
packages/investigation envia instruções + prompt da US
  ↓
Agente lê os repos em sandbox read-only
  ↓
Agente retorna JSON estruturado
  ↓
Refina parseia, enriquece gaps de Wiki e verifica citações
  ↓
Preview mostra Investigação aprovada/reprovada/falha
  ↓
Operador publica Investigação aprovada no ADO
  ↓
Operador abre Refinamento coletivo
  ↓
Palco conduz uma pergunta por vez; Dossiê guarda prova e gates
  ↓
Spec e tickets são aprovados
  ↓
Despejo grava Spec, tasks, estimativa e marcadores no ADO
```

## Entrada da User Story

A US entra pelo Azure DevOps. O Picker lê o backlog do produto, ordena pelo topo da prioridade e exibe status de refinamento derivado de marcadores já publicados na própria US:

- sem `<!-- sprint-griller:investigacao -->`: **sem Investigação**;
- com investigação publicada: **investigada**;
- com `<!-- sprint-griller:dump:<dumpId>:complete -->`: **refinada**.

Não há banco próprio de status do backlog; apagar o artefato no ADO remove o status avançado.

## Investigação

A Investigação é AFK: a UI dispara, redireciona para o preview e o turno roda no processo do Operador. O estado dos previews fica em memória (`globalThis`) para sobreviver a HMR no `next dev`, mas reiniciar o processo perde previews não publicados.

O agente recebe:

- título/descrição da US;
- contexto de Wiki quando links são encontrados;
- lista fechada de repositórios configurados;
- contrato de saída em JSON;
- regra de que perguntas a humanos viram gaps, porque ninguém está na tela.

## Grounding

`verifyGrounding` valida cada impacto do relatório contra os repositórios configurados:

- repo precisa existir na config;
- path precisa ficar dentro da raiz do repo;
- path precisa apontar para arquivo;
- símbolo, quando informado, precisa existir no arquivo;
- arquivo sem leitura reprova como `arquivo-ilegivel`.

Relatório reprovado continua visível, mas não pode ser publicado como fato no ADO.

## Refinamento coletivo

A cerimônia usa a Investigação como insumo. O agente não substitui a sala:

- fato que o código responde: o agente busca e resolve com citação;
- decisão de produto/trade-off: o agente pergunta à sala com recomendação e evidência;
- cada decisão vira Resolução persistida;
- agenda aberta bloqueia avanço para Spec.

O estado vive em SQLite via `packages/ceremony`.

## Dossiê e despejo

O Dossiê separa gates de revisão:

1. Refinamento concluído.
2. Spec aprovada.
3. Tickets aprovados.
4. Estimativa válida.
5. Publicação no ADO.

O despejo recarrega e revalida estado no SQLite antes de escrever. Publicações usam marcadores para idempotência e para status futuro no Picker.

## UI

- **Picker**: lista US, filtros e resumo do funil de refinamento.
- **Investigação**: estado do turno, relatório estruturado, violações de grounding e publicação.
- **Palco**: tela projetável para a sala, com pergunta atual, recomendação e trilho de decisões.
- **Dossiê**: área do Operador com agenda, resoluções, Spec, tickets e gates.
- **/dev-ui**: galeria local de desenvolvimento para demonstrar telas com dados fictícios.

## Limitações atuais

- Fluxo conectado depende de ADO, PAT, Codex CLI e checkouts locais.
- Preview de Investigação não publicado é volátil em memória.
- A demo local `/dev-ui` é fixture de UI, não execução real do agente.
- A qualidade do relatório depende do agente conseguir ler e citar corretamente os repos configurados.
- Repositórios fora da config só entram como suspeita, não como impacto verificado.
