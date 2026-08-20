# Anatomia das skills `grill-with-docs`, `to-spec` e `to-tickets` (mattpocock-skills v1.2.1)

> Fonte primária: código do plugin em
> `/path/to/mattpocock-skills/1.2.1/`
> Todos os caminhos abaixo são relativos a essa raiz, salvo indicação em contrário.
> Pipeline oficial (documentado em `docs/engineering/grill-with-docs.md`):
> `grill-with-docs → to-spec → to-tickets → implement → code-review`.

---

## 1. `grill-with-docs`

**Arquivo:** `skills/engineering/grill-with-docs/SKILL.md` (7 linhas). É um wrapper de uma linha:
"Run a `/grilling` session, using the `/domain-modeling` skill." Tem `disable-model-invocation: true`
(só roda quando o usuário digita `/grill-with-docs`). Toda a mecânica vem de duas skills delegadas —
se o agente não carregar as duas, a skill degenera (falha mais reportada, segundo
`docs/engineering/grill-with-docs.md`).

### 1a. Mecânica do loop de perguntas (skill `grilling`)

**Arquivo:** `skills/productivity/grilling/SKILL.md`.

- Modela a conversa como uma **árvore de design**: cada decisão ramifica nas decisões que dependem dela.
- Trabalha em **rodadas**. A **fronteira (frontier)** = todas as decisões cujos pré-requisitos já estão
  resolvidos. A cada rodada o agente pergunta a fronteira **inteira de uma vez** (não uma por vez, não
  tudo de uma vez), com perguntas numeradas e formato fixo:
  ```
  ❓ **Q1** - **<título>**: <corpo, pode ter múltipla escolha>
  ➡️ <resposta recomendada pelo agente>
  ```
- Pergunta cujo resposta depende de outra pergunta ainda aberta na rodada vai para uma rodada **posterior**.
- Regra "fatos vs. decisões": **fatos** (filesystem, código, ferramentas) são obrigação do agente — ele
  despacha sub-agentes para descobri-los e nunca pergunta ao usuário; **decisões** são do usuário.
  Uma exploração em andamento é tratada como pré-requisito não resolvido: só as perguntas downstream
  dela esperam; o resto da fronteira é perguntado já.
- Cada resposta do usuário remodela a árvore: decisões resolvidas empurram a fronteira para fora e
  desbloqueiam perguntas. O agente recomputa a fronteira e faz a próxima rodada.

### 1b. Critério de "maduro" (fim da sessão)

Do `grilling/SKILL.md`: "The session is done when the frontier is empty: every branch of the design
tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached
a shared understanding." Ou seja, dois gates: (1) fronteira vazia (nenhuma decisão pendente/assumida em
silêncio) e (2) **confirmação explícita do usuário** de entendimento compartilhado. Não há score, checklist
ou métrica objetiva — o critério é estrutural (árvore esgotada) + humano (aprovação).

### 1c. Efeitos colaterais em disco (skill `domain-modeling`)

**Arquivos:** `skills/engineering/domain-modeling/SKILL.md`, `CONTEXT-FORMAT.md`, `ADR-FORMAT.md`.

Durante a sessão o agente:
- **Desafia termos** contra o glossário existente (`CONTEXT.md`) e propõe termo canônico para linguagem vaga.
- **Inventa cenários concretos** para stress-testar relações do domínio.
- **Cruza com o código**: se o usuário afirma algo que o código contradiz, aponta a contradição.
- **Atualiza `CONTEXT.md` inline**, termo a termo, no momento em que o termo é resolvido (nunca em lote).
  Formato (`CONTEXT-FORMAT.md`): glossário puro — `**Termo**: definição de 1-2 frases + _Avoid_: sinônimos
  proibidos`. Proibido conter implementação, spec ou notas. Suporta repositório multi-contexto via
  `CONTEXT-MAP.md` na raiz apontando para `CONTEXT.md` por contexto.
- **Cria ADRs com parcimônia** em `docs/adr/NNNN-slug.md` só quando 3 gates valem simultaneamente:
  (1) difícil de reverter, (2) surpreendente sem contexto, (3) resultado de trade-off real.
  Formato (`ADR-FORMAT.md`): título + 1-3 frases; seções opcionais (Status, Considered Options,
  Consequences) só quando agregam. Arquivos criados **lazily** — nada é scaffoldado antes do primeiro
  termo/decisão.

**Entradas:** um plano/ideia fuzzy + um repo gravável. **Saídas:** `CONTEXT.md` atualizado, zero-ou-poucos
ADRs, e — ponto crítico documentado em `docs/engineering/grill-with-docs.md` — **todo o resto das decisões
fica só na conversa** ("that third row is the one that catches people out"). A mitigação oficial é rodar
`/to-spec` na mesma conversa, sem clear/compact.

---

## 2. `to-spec`

**Arquivo:** `skills/engineering/to-spec/SKILL.md` (76 linhas). `disable-model-invocation: true`.

**Entradas:** a conversa atual + entendimento do codebase + glossário (`CONTEXT.md`) e ADRs da área.
Regra explícita: "Do NOT interview the user — just synthesize what you already know". É pura síntese
de decisões já tomadas (tipicamente na sessão de grilling anterior, mesma janela de contexto).
Pré-requisito: tracker e vocabulário de labels configurados via `/setup-matt-pocock-skills`.

**Processo (3 passos):**
1. Explorar o repo; usar o vocabulário do glossário do projeto e respeitar ADRs da área tocada.
2. **Seams antes de prosa**: esboçar os *seams* (costuras) onde a feature será testada — preferir seams
   existentes a novos, no ponto mais alto possível; "the fewer seams across the codebase, the better —
   the ideal number is one". **Único checkpoint com o usuário**: confirmar que os seams batem com a
   expectativa dele.
3. Escrever a spec no template e **publicá-la no tracker do projeto** como uma issue única, aplicando o
   label `ready-for-agent` (sem triage adicional).

**Formato da spec** (`<spec-template>` embutido no SKILL.md — seções exatas):
1. `## Problem Statement` — o problema na perspectiva do usuário.
2. `## Solution` — a solução na perspectiva do usuário.
3. `## User Stories` — lista numerada **LONGA e extremamente extensiva**, formato fixo
   "As an <actor>, I want a <feature>, so that <benefit>".
4. `## Implementation Decisions` — módulos a construir/modificar, interfaces, decisões arquiteturais,
   mudanças de schema, contratos de API, interações. **Proibido**: caminhos de arquivo e snippets de
   código (envelhecem rápido). Exceção: snippet vindo de um protótipo que codifica uma decisão melhor
   que prosa (state machine, reducer, schema, type shape), aparado às partes decisórias.
5. `## Testing Decisions` — o que é um bom teste (só comportamento externo), módulos testados, prior art.
6. `## Out of Scope` — o que ficou fora.
7. `## Further Notes`.

Segundo `docs/engineering/to-spec.md`: a spec é um "decision record" que existe porque a janela de
contexto acaba; "anything the spec asserts that you never actually said is a defect"; ela é snapshot
descartável após o ship (o durável é `CONTEXT.md` + ADRs); o template serve mal para refactors
(viés forte em user stories); rough edge conhecido: o label `ready-for-agent` na spec-mãe confunde
agentes AFK que fazem polling.

---

## 3. `to-tickets`

**Arquivo:** `skills/engineering/to-tickets/SKILL.md` (105 linhas). `disable-model-invocation: true`.

**Entradas:** um plano, spec ou a conversa atual; opcionalmente uma referência como argumento
(caminho de spec, número/URL de issue — nesse caso lê corpo completo + comentários). Pré-requisito:
tracker configurado por `/setup-matt-pocock-skills`.

**Processo (5 passos):**
1. **Gather context** — trabalha do que já está no contexto; busca a referência se passada.
2. **Explorar o codebase** (opcional) — usar vocabulário do glossário, respeitar ADRs, e procurar
   oportunidades de **prefactoring** ("make the change easy, then make the easy change"), que vai primeiro.
3. **Draft de fatias verticais (tracer bullets)** — regras (`<vertical-slice-rules>`):
   - cada fatia corta um caminho estreito mas COMPLETO por todas as camadas (schema, API, UI, testes) —
     vertical, nunca horizontal;
   - fatia completa é **demoável/verificável sozinha**;
   - dimensionada para caber em **uma janela de contexto fresca**;
   - prefactoring primeiro.
   Cada ticket declara suas **blocking edges** (tickets que precisam terminar antes). Ticket sem blocker
   pode começar imediatamente.
   **Exceção — wide refactor**: mudança mecânica com blast radius no codebase inteiro (renomear coluna,
   retipar símbolo compartilhado) vira sequência **expand–contract**: expand (nova forma ao lado da
   antiga) → migrate em lotes por blast radius (um ticket por lote, bloqueado pelo expand) → contract
   (deletar a forma antiga, bloqueado por todos os lotes). Se nem os lotes ficam verdes sozinhos:
   branch de integração + ticket final integrate-and-verify.
4. **Quiz do usuário** — apresenta a quebra como lista numerada com, por ticket: **Title**,
   **Blocked by**, **What it delivers**. Pergunta: granularidade ok (grossa/fina demais)? edges
   corretas (cada dependência realmente bloqueia)? merge/split? **Itera até o usuário aprovar** —
   nada é publicado antes.
5. **Publicar no tracker configurado** (blockers primeiro, para as edges referenciarem IDs reais):
   - **Local files**: um arquivo por ticket em `.scratch/<feature-slug>/issues/<NN>-<slug>.md`,
     numerado de `01` em ordem de dependência — nunca um arquivo combinado.
   - **Tracker real (GitHub, Linear, …)**: uma issue por ticket, usando relação nativa de
     blocking/sub-issue onde existir; label `ready-for-agent` (tickets são "agent-grabbable by
     construction"). Não fechar/modificar a issue-mãe.
   Execução: trabalhar a **frontier** — qualquer ticket com todos os blockers concluídos.

**Formato do ticket** — dois templates no SKILL.md:
- `<local-ticket-template>`: `# <NN> — <título>` / `**What to build:**` (comportamento end-to-end na
  perspectiva do usuário, não lista por camada) / `**Blocked by:**` (números/títulos ou "None — can
  start immediately") / `**Status:** ready-for-agent` / checklist `- [ ]` de acceptance criteria.
- `<issue-template>` (tracker real): `## Parent` (referência à issue-mãe, se houver) / `## What to build`
  / `## Acceptance criteria` (checklist) / `## Blocked by`.
- Mesma regra da spec: sem file paths/snippets, exceto snippet decisório vindo de protótipo.

Rough edges documentados (`docs/engineering/to-tickets.md`): sobre-decomposição é a fricção mais
reportada (o quiz existe para mergear); o modelo às vezes ainda produz fatias horizontais (teste:
"o que consigo demonstrar quando isso terminar?"); sub-issues/blocking links nativos no GitHub
frequentemente não são criados (issues #554/#513 do repo mattpocock/skills); acceptance criteria podem
não "gradear" nada (já verdadeiros no commit-base); **não há auto-dispatch** — rodar os tickets
(uma sessão por ticket, contexto limpo entre eles) é trabalho manual do usuário, e `implement` não
fecha o ticket de forma confiável.

---

## 4. Infraestrutura compartilhada: `setup-matt-pocock-skills`

**Arquivos:** `skills/engineering/setup-matt-pocock-skills/SKILL.md`, `issue-tracker-github.md`,
`issue-tracker-gitlab.md`, `issue-tracker-local.md`, `triage-labels.md`, `domain.md`.

Roda uma vez por repo e grava a configuração que `to-spec`/`to-tickets` assumem:
- `docs/agents/issue-tracker.md` — onde as issues vivem: **GitHub** (CLI `gh`), **GitLab** (`glab`),
  **local markdown** (`.scratch/<feature>/`, spec em `spec.md`, issues em `issues/NN-slug.md`, status
  como linha `Status:` no arquivo, comentários em `## Comments`) ou **"Other"** (Jira/Linear descrito
  em prosa livre pelo usuário).
- `docs/agents/triage-labels.md` — mapeamento dos 5 papéis canônicos (`needs-triage`, `needs-info`,
  `ready-for-agent`, `ready-for-human`, `wontfix`) para as strings reais do tracker.
- `docs/agents/domain.md` + bloco `## Agent skills` em `CLAUDE.md`/`AGENTS.md` — layout dos docs de
  domínio (single vs multi-context).

Os `agents/openai.yaml` de cada skill são metadados de interface (display name, curta descrição,
`allow_implicit_invocation: false`) — nada de mecânica.

---

## 5. Análise (a): o que as skills assumem do ambiente

As três skills são **prompts, não software** — 100% da mecânica (árvore de design, fronteira, seams,
fatias verticais) é instrução em Markdown executada pelo agente do Claude Code, e dependem pesadamente
do ambiente ao redor: (1) um **filesystem gravável de um repo real** — `CONTEXT.md`, `docs/adr/`,
`.scratch/` são efeitos colaterais em disco, criados lazily, e o grilling "lê código para não perguntar
fatos ao usuário", o que pressupõe acesso de leitura ao codebase inteiro; (2) **sub-agentes sob demanda**
para exploração paralela durante o grilling (o `Task`/`Agent` tool do Claude Code); (3) uma **janela de
contexto contínua** como meio de transporte entre etapas — o "banco de dados" entre grilling → to-spec →
to-tickets é literalmente a conversa não-compactada (os docs alertam explicitamente contra clear/compact
entre etapas); (4) um **tracker configurado por convenção** (`docs/agents/issue-tracker.md`) operado via
CLI (`gh`/`glab`) ou arquivos locais, com labels de triage e blocking edges nativos; (5) **composição de
skills por carregamento de prompt** — `grill-with-docs` só funciona se o runtime carregar `grilling` +
`domain-modeling` juntas, e a falha silenciosa dessa composição é o bug mais reportado. Uma ferramenta
web própria teria que reproduzir: acesso ao repo (ou aceitar operar sem código, perdendo o pilar
"fatos são do agente"), persistência do estado da conversa entre etapas, escrita de artefatos
(glossário/ADRs) de volta no repo, e integração de publicação com trackers reais incluindo relações de
bloqueio nativas.

## 6. Análise (b): o que uma "plataforma de refinamento" agregaria de verdade

O valor real estaria exatamente nos pontos onde as skills hoje falham por serem prompts soltos, todos
documentados nos próprios docs do plugin: (1) **estado estruturado em vez de conversa** — hoje a árvore
de design, a fronteira e "todas as outras decisões" (a linha 3 da tabela do paper trail) vivem só no
contexto e evaporam num clear; uma plataforma poderia persistir a árvore como dado, dar um ledger
decisão→spec→ticket→teste (a queixa mais substantiva: respostas precisas são "amaciadas" na síntese) e
tornar o critério de maturidade inspecionável (quais ramos abertos, o que foi assumido); (2) **execução
confiável dos efeitos colaterais** — a plataforma garantiria que sub-issues/blocking links nativos sejam
criados (bug #554/#513), que o estado do ticket seja atualizado, e que o CONTEXT.md/ADR não deixem de
ser escritos quando a composição de skills falha; (3) **multi-usuário e anti-drift** — as skills assumem
"one writer" e o drift documentado (~20% dos PRs num time de 2 devs) não tem solução no plugin;
(4) **dispatch** — `to-tickets` para no artefato ("no auto-dispatch mode"), e orquestrar a frontier é
manual. Já seria **só embalagem**: UI bonita para o loop de perguntas (o formato ❓/➡️ em rodadas já
funciona bem em chat), reescrever os templates de spec/ticket (são bons e estáveis), wizards de setup
(o setup é um arquivo markdown por repo), ou "IA de refinamento" genérica sem repo — sem acesso ao
código a plataforma perde o mecanismo central que diferencia o grilling de um chatbot de perguntas:
o agente descobre fatos sozinho e só traz decisões ao humano.
