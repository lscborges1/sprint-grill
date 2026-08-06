# Research — Runtime de agente para a ferramenta de "grilling" de User Stories

Data: 2026-08-05. Contexto: ferramenta self-hosted (local ou VPS) que lê repositórios da squad, faz perguntas uma a uma a humanos (dev + Produto), registra decisões e gera spec/tasks, possivelmente com UI web na frente (streaming).

Comparação de três runtimes: (a) Claude Agent SDK (TypeScript), (b) Claude Code CLI headless, (c) tool-use loop direto na Messages API.

---

## (a) Claude Agent SDK (TypeScript) — `@anthropic-ai/claude-agent-sdk`

O SDK é o harness do Claude Code empacotado como biblioteca: "The Agent SDK gives you the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript" ([overview](https://code.claude.com/docs/en/agent-sdk/overview)). Internamente ele roda o CLI como subprocesso no seu próprio processo.

**Auth e custo**
- A doc oficial: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."* ([overview](https://code.claude.com/docs/en/agent-sdk/overview)). Ou seja: um produto que oferece login claude.ai a terceiros é proibido; para produto/serviço, API key (pay-per-token).
- Uso pessoal com assinatura: o artigo de suporte ["Use the Claude Agent SDK with your Claude plan"](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) descreve um programa de crédito mensal de Agent SDK (Pro $20, Max 5x $100, Max 20x $200 etc., cobrindo "Claude Agent SDK usage in your own projects" e "the `claude -p` command"), previsto para 15/06/2026, **mas pausado**: *"Currently, Agent SDK usage still draws from standard subscription limits with no separate monthly credit available."* Na prática hoje (ago/2026): cada dev rodando localmente com o próprio login Pro/Max consome os limites da própria assinatura; num VPS multiusuário/serviço, o caminho suportado é API key.
- Preço API (referência, Claude API): Opus 5 $5/$25 por MTok; Sonnet 5 $3/$15 ($2/$10 introdutório até 2026-08-31) — skill claude-api / [pricing](https://platform.claude.com/docs/en/pricing).

**Filesystem / repos**
- Tools embutidas: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch ([overview → Capabilities](https://code.claude.com/docs/en/agent-sdk/overview)). Aponta `cwd` para o repo da squad e o agente explora sozinho — zero código de tool para ler repositório.

**Reuso de skills (SKILL.md)**
- Suporte nativo e igual ao Claude Code: skills descobertas de `~/.claude/skills/` e `<cwd>/.claude/skills/` (até a raiz do repo), controladas por `settingSources: ["user","project"]` e pela opção `skills: "all" | [nomes]`; plugins também podem prover skills ([Skills in the SDK](https://code.claude.com/docs/en/agent-sdk/skills)). Nota: o frontmatter `allowed-tools` de SKILL.md **não** se aplica via SDK — controlar via `allowedTools`.

**UI web multi-sessão**
- Sessões persistidas em disco (`~/.claude/projects/<encoded-cwd>/*.jsonl`) com `resume` por ID, `forkSession`, `persistSession: false`, e `SessionStore` adapter para armazenar transcripts em storage compartilhado (multi-host/serverless) ([Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)). Multi-usuário = "one per user in a multi-user app" com `resume` por ID — citado explicitamente na doc.
- Streaming: `query()` retorna async iterator de mensagens; partial messages para streaming token a token ([streaming-output](https://code.claude.com/docs/en/agent-sdk/streaming-output)).
- Human-in-the-loop: permissões programáveis (`canUseTool` callback, `permissionMode`) e `AskUserQuestion` tratado dentro do loop sem encerrar a chamada ([Sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)) — encaixa direto no fluxo de perguntas uma a uma do grilling.
- Custo operacional: cada sessão é um subprocesso Node/CLI; concorrência = N subprocessos (aceitável para uma squad, não para SaaS de alta escala).

**Maturidade**
- Posicionado como "Build production AI agents"; changelog ativo ([TS CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)). Houve churn de API: a "V2 session API" (`createSession()`) foi **removida** na 0.3.142 — a superfície ainda muda ([Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)).

---

## (b) Claude Code CLI headless — `claude -p --output-format stream-json`

Mesmo harness, invocado como subprocesso que você gerencia; a própria doc ([headless](https://code.claude.com/docs/en/headless)) posiciona o modo `-p` para scripts/CI e "para dirigir o mesmo agent loop de outra linguagem", apontando o SDK para controle programático completo.

**Auth e custo**
- Sem `--bare`, `claude -p` lê as credenciais OAuth/keychain normais — ou seja, funciona com o login da assinatura do dev (a doc diz que "bare mode doesn't use your subscription login", implicando que o modo normal usa). Com `--bare`, exige `ANTHROPIC_API_KEY` ou `apiKeyHelper`. A mesma política/crédito do item (a) cobre `claude -p` (artigo de suporte acima). `--output-format json` retorna `total_cost_usd` por invocação.

**Filesystem / repos**
- Idêntico ao (a): todas as tools do Claude Code, gate via `--allowedTools "Read,Edit,Bash"` e `--permission-mode` (`acceptEdits`, `dontAsk`).

**Reuso de skills**
- Sem `--bare`, carrega automaticamente skills/CLAUDE.md/plugins de `.claude/` e `~/.claude/` — reuso total do formato SKILL.md; skills user-invocáveis funcionam com `/skill-name` no prompt ([headless](https://code.claude.com/docs/en/headless)).

**UI web multi-sessão**
- Possível mas artesanal: streaming via `--output-format stream-json --verbose --include-partial-messages` (NDJSON que você parseia), multi-turno via `--resume <session_id>` (escopo por diretório!), um processo por turno. Não há equivalente ao callback `canUseTool` — aprovações interativas viram gambiarra (allowlists estáticas ou MCP). É essencialmente reimplementar por conta própria o que o SDK (a) já embrulha.

**Maturidade**
- Estável e bem documentado, mas o contrato é "flags de CLI + NDJSON", com muitos comportamentos dependentes de versão (várias notas "before v2.1.x" na doc). Bom para scripts/CI e linguagens sem SDK; frágil como backend de app web.

---

## (c) Tool-use loop direto na Messages API (ou Tool Runner do SDK Anthropic)

Chamadas diretas a `POST /v1/messages` (`@anthropic-ai/sdk`), com loop manual `while stop_reason == "tool_use"` ou o Tool Runner (`client.beta.messages.toolRunner`, beta) que executa o loop sobre tools **que você define** ([tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)). A doc do Agent SDK descreve o Client SDK como: "Direct access to the Anthropic API… You implement the tool loop yourself."

**Auth e custo**
- Somente API key da Claude Console (ou OAuth de Console via `ant auth login` / WIF — que fatura igualmente como API). **Assinatura Pro/Max não se aplica à Messages API** — é pay-per-token puro ([pricing](https://platform.claude.com/docs/en/pricing)).

**Filesystem / repos**
- Nada embutido. Você escreve cada tool (read_file, grep, list_dir…), com validação de path/sandbox por sua conta. As tools Anthropic-defined `bash`/`text_editor` existem mas são client-executed: você implementa o executor e a segurança.

**Reuso de skills (SKILL.md)**
- Sem suporte nativo ao formato local. "Agent Skills" na Messages API significa skills executando no container server-side de code execution (betas `code-execution-2025-08-25` + `skills-2025-10-02`), com skills custom publicadas via Skills API — não é reaproveitar os SKILL.md de `.claude/skills/` no filesystem. Reuso local exigiria reimplementar a descoberta/progressive disclosure na mão.

**UI web multi-sessão**
- Arquiteturalmente o mais limpo para servir web: API stateless, estado da conversa 100% seu (DB), streaming SSE nativo, sem subprocesso por sessão, controle total de permissões (você intercepta cada tool call). Em troca, você constrói tudo: loop, prompt caching, compaction (beta `compact-2026-01-12`), gestão de contexto, `pause_turn`, tools de repo.

**Maturidade**
- Messages API é GA e a superfície mais estável do ecossistema; Tool Runner é beta. Zero dependência do binário do Claude Code.

---

## Tabela de trade-offs

| Critério | (a) Agent SDK TS | (b) CLI headless `-p` | (c) Messages API / Tool Runner |
|---|---|---|---|
| Auth com assinatura Pro/Max | Uso pessoal: sim, consome limites da assinatura (crédito dedicado pausado); produto/terceiros: proibido, API key | Igual ao (a); `--bare` exige API key | Não — só API key pay-per-token |
| Acesso a filesystem/repos | Nativo (Read/Bash/Glob/Grep…) | Nativo | Você implementa tudo |
| Reuso de SKILL.md | Nativo (`settingSources` + `skills`) | Nativo (auto-load de `.claude/`) | Não (formato diferente, server-side) |
| Streaming p/ UI web | Async iterator + partial messages | NDJSON no stdout (parse manual) | SSE nativo (o mais limpo) |
| Multi-sessão / controle | `resume`/`fork` por ID, `SessionStore`, `canUseTool`, `AskUserQuestion` in-loop | `--resume` por ID, escopo por cwd, 1 processo por turno, sem callback de permissão | Total — estado é seu (DB) |
| Perguntas 1-a-1 (grilling) | Excelente (`AskUserQuestion` + `canUseTool`) | Fraco (sem hook interativo) | Você constrói (tool `ask_user` própria) |
| Esforço de implementação | Baixo | Médio (glue frágil) | Alto |
| Maturidade/estabilidade | Boa, mas API ainda muda (V2 removida na 0.3.142) | Estável p/ scripts; contrato CLI | Messages API GA; Tool Runner beta |
| Overhead de runtime | Subprocesso por sessão | Processo por turno | Nenhum (HTTP puro) |

## Recomendação preliminar (decisão final é do ticket de arquitetura)

**(a) Claude Agent SDK (TypeScript).** É a única opção que entrega de graça os quatro requisitos centrais do MVP: leitura dos repos (tools embutidas), reuso dos SKILL.md existentes, sessões retomáveis por ID para um fluxo interativo longo, e hooks de human-in-the-loop (`AskUserQuestion`/`canUseTool`) que mapeiam 1:1 no grilling com streaming para a UI web. Ressalvas: (1) em VPS servindo múltiplas pessoas, planejar API key — a política proíbe oferecer login claude.ai a terceiros, e o crédito de assinatura para Agent SDK está pausado; rodando localmente cada dev usa a própria assinatura; (2) pin de versão do SDK — a superfície ainda sofre breaking changes. A opção (c) fica como evolução se a ferramenta virar serviço multi-tenant de verdade; a (b) só vale como fallback rápido de prototipagem.

## Fontes

- https://code.claude.com/docs/en/agent-sdk/overview (comparação SDK/CLI/Client SDK/Managed Agents; nota de auth; branding/termos)
- https://code.claude.com/docs/en/headless (`-p`, `--output-format stream-json`, `--bare`, `--allowedTools`, `--resume`, custo por invocação)
- https://code.claude.com/docs/en/agent-sdk/sessions (resume/fork, SessionStore, multi-user, remoção da V2 API)
- https://code.claude.com/docs/en/agent-sdk/skills (SKILL.md, settingSources, opção `skills`)
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan (política de assinatura/crédito Agent SDK — pausada)
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview e https://platform.claude.com/docs/en/pricing (Messages API, Tool Runner, pricing)
