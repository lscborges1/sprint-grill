# Anatomia das skills grill-with-docs / to-spec / to-tickets

Type: research
Status: resolved

## Question

O que exatamente essas três skills fazem — entradas, saídas, mecânica do loop de perguntas, critério de "maduro", formato de spec e de tickets? Ler o código-fonte no cache local do plugin (`~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.2.1/skills/engineering/{grill-with-docs,to-spec,to-tickets}`), incluindo agents/ e arquivos de apoio.

Objetivo: a discussão de produto construir sobre fatos, não sobre a lembrança do que as skills fazem — e identificar o que uma "plataforma" adicionaria de verdade sobre as skills cruas rodando no Claude Code.

## Answer

Findings completos: [research/anatomia-das-skills.md](../research/anatomia-das-skills.md).

**Mecânica (fatos):**
- As 3 skills são **prompts Markdown, não software** — toda a mecânica é instrução executada pelo agente do Claude Code. `grill-with-docs` é um wrapper de 1 linha compondo `grilling` (loop) + `domain-modeling` (escrita de docs); a falha silenciosa dessa composição é o bug nº 1 reportado.
- Loop do grilling: árvore de design em **rodadas de fronteira** (todas as decisões desbloqueadas por rodada, formato ❓Qn + ➡️ recomendação); **fatos são do agente** (sub-agentes leem o repo), só decisões vão ao humano.
- Critério de "maduro": fronteira vazia + confirmação explícita do usuário — estrutural + humano, **sem métrica objetiva**.
- `to-spec`: síntese sem entrevista; único checkpoint humano são os seams de teste; template Problem/Solution/User Stories/Implementation Decisions/Testing Decisions/Out of Scope; proíbe file paths e snippets.
- `to-tickets`: fatias verticais (tracer bullets) demoáveis, dimensionadas para 1 janela de contexto, com blocking edges e quiz de aprovação; publica em `.scratch/` ou tracker real.
- **A janela de contexto é o "banco de dados"** entre grilling → to-spec → to-tickets (docs proíbem clear/compact no meio); o grosso das decisões fica só na conversa (CONTEXT.md/ADRs capturam uma fração).

**O que uma plataforma agregaria de verdade (gaps documentados nos próprios docs):** ledger persistente decisão→spec→ticket (hoje decisões evaporam), blocking links nativos confiáveis, suporte a múltiplos participantes (hoje assume writer único; drift em ~20% dos PRs), dispatch automático da fronteira. **O que seria só embalagem:** UI para o loop de rodadas, retemplating de spec/tickets, wizard de setup, e "refinamento" sem acesso ao código.

**Assunções de ambiente a reproduzir:** repo legível/gravável, sub-agentes para fact-finding, contexto contínuo entre etapas, tracker acessível.
