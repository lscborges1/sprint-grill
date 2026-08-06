# Spec de MVP — Sprint Griller

Ferramenta de refinamento da squad: Investigação que chega pronta + grilling coletivo com decisões documentadas, tudo despejado no Azure DevOps.

Consolida as decisões do mapa wayfinder [`map.md`](map.md). Cada seção linka os tickets que a decidiram; o detalhe vive lá. Termos em **negrito na primeira ocorrência** estão no glossário ([`CONTEXT.md`](../../CONTEXT.md)).

---

## Problem Statement

Investigar o impacto de uma US na codebase antes do refinamento não cabe na agenda de nenhum humano — então ninguém faz. A cerimônia (~1h, squad + PO) refina **User Stories** cruas (título + poucas linhas) sem ninguém ter olhado o código, e a estimativa sai com dúvidas abertas. A consequência dominante é a **Explosão**: dependência técnica descoberta no meio da implementação — a estimativa dobra e a decisão final é tomada às pressas, sem o PO saber que houve uma decisão.

Causa-raiz: o custo humano da investigação cross-repo (horas de um sênior, "por precaução") — não falta de processo nem conhecimento concentrado. Evidência: padrão confirmado na cerimônia atual + piloto manual já executado com ganho percebido claro. ([O problema certo?](issues/05-o-problema-certo.md))

## Solution

Uma **cunha fina**, não uma plataforma ([Posicionamento](issues/06-posicionamento-plataforma-vs-cunha.md)) — o instrumento do **Operador** (único no MVP: o Lucas), com dois momentos:

1. **Antes da cerimônia (AFK):** o Operador dispara a **Investigação** — um agente lê a US no Azure DevOps + os repos locais da squad, mapeia furos e impacto cross-repo com citação obrigatória de evidência, e publica o resultado como comment na própria US.
2. **Na cerimônia (ao vivo):** a **UI de sessão** — uma única tela web, premium e legível numa sala — conduz o **grilling coletivo**: pergunta atual com recomendação do agente, decisão capturada com confirmação humana, árvore de decisões sempre visível. Ao final, o **Despejo** grava tudo no Azure DevOps: **Spec da US**, **tasks agent-ready** filhas, estimativa da squad e **Registros de decisão**.

A ferramenta não é um lugar que a squad visita: o Azure DevOps é a fonte da verdade ([ADR 0003](../../docs/adr/0003-azure-devops-como-fonte-da-verdade.md)); ela é o que faz o tracker deles ficar rico. Diferencial sobre "rodar skills no Claude Code na mão": ledger (decisões param de evaporar da janela de contexto), sala (grilling legível para squad + PO) e fluxo de um clique (Investigação → grilling → despejo).

O vão competitivo está vazio: código ⊗ PO-no-loop ⊗ Azure DevOps ⊗ self-hosted — dev-tools (Kiro/Spec Kit) excluem Produto e tracker, PM-tools (Rovo/ChatPRD) não leem código, a ponte da Microsoft nem suporta Azure Repos ([Paisagem competitiva](issues/02-paisagem-competitiva.md)).

## User Stories

Atores: **Operador** (dispara e conduz), **Dev da squad** e **PO** (participam das decisões, não operam), **Squad** (o coletivo na retro), **Agente de implementação** (futura orquestração, consumidor das tasks).

### Config e picker

1. Como Operador, quero configurar uma vez os repos locais da squad (principal + relacionados) e a conexão com o Azure DevOps, para que nenhuma cerimônia comece escolhendo repositório.
2. Como Operador, quero ver as US da iteration atual com status inferido do próprio ADO (*sem Investigação / investigada / refinada*), para escolher o que investigar sem manter um dashboard.

### Investigação

3. Como Operador, quero disparar a Investigação de uma US e sair da frente (AFK), para que o mapeamento de furos e impacto aconteça sem consumir a agenda de ninguém.
4. Como Dev da squad, quero que toda afirmação de impacto da Investigação cite evidência do repo (caminho/símbolo), para confiar no relatório sem reconferir tudo.
5. Como Dev da squad, quero que o que o agente não conseguiu ancorar apareça numa seção "Não verificado", para distinguir fato de hipótese.
6. Como Operador, quero que impacto suspeito em repos fora do config seja sinalizado explicitamente, para descobrir dependências antes da sprint, não durante.
7. Como PO, quero que a Investigação chegue como comment na própria US, para ler no lugar onde já trabalho.

### Sessão de grilling coletivo

8. Como PO, quero ver a pergunta atual e a recomendação do agente em tipografia legível a distância (modo *Palco*), para participar da decisão sem estar na frente de um terminal.
9. Como Dev da squad, quero que cada pergunta venha com recomendação e evidência, para decidir informado em vez de do zero.
10. Como Operador, quero capturar a decisão da sala com quem/quando, para que ela vire artefato de primeira classe e não ata perdida.
11. Como PO, quero que nenhuma decisão seja registrada sem confirmação humana, para que a IA nunca decida em nosso nome.
12. Como Dev da squad, quero que dúvida factual surgida na cerimônia seja resolvida pelo agente ao vivo lendo o código, para não sair da sala com "alguém verifica depois".
13. Como Squad, quero a árvore de decisões sempre visível no trilho, para saber onde estamos e o que falta.
14. Como Squad, quero uma barra de progresso compacta no topo (segmentos por decisão + contagem de pendências), para sentir o avanço da cerimônia.
15. Como Operador, quero uma aba *Dossiê* com a Spec da US se formando ao vivo, para revisar o documento sem tirar a sala do Palco.
16. Como Operador, quero que a cerimônia sobreviva a crash/refresh (estado persistido na hora), para nunca perder decisões tomadas com a sala inteira presente.

### Gate e despejo

17. Como Operador, quero que o gate de maturidade mostre o que segue aberto ("2 dúvidas sem resposta") antes de despejar, para que despejar com pendência seja escolha consciente, não acidente.
18. Como Operador, quero preview editável (Markdown) de spec e tasks antes de gravar, para que a IA redija e o humano assine.
19. Como PO, quero a Spec da US como artefato único na própria US (decisões, contexto de impacto, unknowns explícitos, fora-de-escopo), para não caçar ata em outro sistema.
20. Como Dev da squad, quero cada trecho da spec nascido de decisão linkando o Registro de decisão correspondente, para auditar por que algo foi decidido.
21. Como Agente de implementação, quero tasks filhas como slices verticais autocontidas, dimensionadas para uma sessão de agente, com critérios de aceite, link para a spec e `Blocked by` nativo, para pegar trabalho sem bloqueio e sem contexto oculto.
22. Como Operador, quero que a estimativa da squad seja gravada nos campos do ADO pelo despejo, para a cerimônia terminar com o tracker completo.
23. Como Dev da squad, quero que falhas estruturais das tasks (aceite ausente, link quebrado, "conforme discutido" sem link) apareçam no gate junto às dúvidas abertas, para não despejar lixo agent-ready.

### Métricas e confiança

24. Como Squad, quero a taxa de rolagem por sprint calculada de ADO cru por script auditável, para julgar a ferramenta com número que ela não controla.
25. Como Squad, quero números sempre agregados por sprint (nunca por pessoa) e veredito na retro, para que a squad julgue a ferramenta — não a ferramenta julgue a squad.
26. Como Operador, quero logs estruturados de cada turno do agente e de cada escrita no ADO, para diagnosticar qualquer despejo errado com precisão.

## Implementation Decisions

Decididas em [Arquitetura e stack](issues/10-arquitetura-e-stack.md); trade-offs difíceis de reverter registrados como ADRs.

- **Processo único**: app Next.js (App Router) na máquina do Operador; monorepo TypeScript e2e; UI de sessão recebe eventos via SSE e envia comandos por rotas tipadas.
- **Módulo `agent-runtime`**: cliente JSON-RPC fino para o `codex app-server` (login ChatGPT gerenciado, coberto pela assinatura do Operador). `requestUserInput`/approvals mapeiam no HITL da UI; `thread/resume` mapeia na retomada de cerimônia; leituras do ADO via MCP. Interface estreita com costura pronta para GLM via Agent SDK → Z.ai — fora do MVP; GLM dentro do Codex vetado pelos termos. ([ADR 0001](../../docs/adr/0001-codex-app-server-como-runtime.md))
- **Módulo `ado-client`**: REST tipado com zod, **única porta de escrita** no ADO — o LLM redige, código determinístico grava; o modelo nunca executa tool-call de escrita. Usado pelo despejo e pelo script de métricas. ([ADR 0002](../../docs/adr/0002-escrita-no-ado-e-deterministica.md))
- **Persistência**: SQLite + Drizzle guardando só estado de cerimônia (sessão, árvore de decisões, transcript), gravado na hora — a cerimônia sobrevive a crash/refresh. ADO segue fonte da verdade; recursos ricos futuros serão derivados dele, nunca concorrentes. ([ADR 0003](../../docs/adr/0003-azure-devops-como-fonte-da-verdade.md))
- **UI de sessão em dois modos** ([Protótipo](issues/12-prototipo-ui-de-sessao.md), variante A vencedora com furtos da B e C): *Palco* (projeção: pergunta + recomendação em tipografia editorial gigante, evidências, opções, árvore no trilho lateral) e *Dossiê* (aba do operador: documento vivo + preview editável do despejo). Progresso e pendências sempre no topo. Tipografia legível a distância é requisito, não estética; linguagem visual de referência: Witek (minimalismo, sem copiar layout).
- **Repos**: checkouts locais na máquina do Operador, definidos uma vez no config.

### Princípios de qualidade da IA (requisitos testáveis)

Quatro princípios com teste objetivo ([Qualidade da IA](issues/08-qualidade-da-ia-util-nao-bonita.md)); síntese: o código é a fonte dos fatos, a squad é a fonte das decisões, a IA é o transporte verificável entre os dois.

1. **Grounding com citação obrigatória** — afirmação sem evidência ancorável vai para "Não verificado". *Teste: checagem mecânica (não-LLM) pré-publicação; caminho citado não existe ⇒ Investigação não publica.*
2. **HITL estrito** — a UI só exibe *decisões* (com recomendação + evidência); fatos o agente busca ao vivo. *Teste: não existe caminho no código que grave Registro de decisão sem input humano.*
3. **Despejo revisável e rastreável** — preview editável; decisão → spec → task com links navegáveis no ADO. *Teste: toda decisão da sessão aparece na spec com link.*
4. **Tasks agent-ready verificadas estruturalmente** — aceite presente, link para spec, `Blocked by` íntegro; falhas aparecem no gate. *Evolução marcada: o "leitor frio" vira teste de aceitação do futuro esforço de orquestração — não roda na cerimônia.*

## Testing Decisions

- Bom teste aqui é de comportamento externo nas fronteiras, não de detalhe de implementação. As duas fronteiras são os seams: `agent-runtime` (eventos/turnos) e `ado-client` (escritas).
- **Unit**: checagens mecânicas dos princípios de qualidade (validação de citações, checagens estruturais do gate) e `ado-client` com REST mockado.
- **Integração**: fluxo de despejo ponta a ponta (sessão → artefatos → escritas mockadas) — é a etapa que queima confiança se errar.
- **Observabilidade**: logs estruturados nas duas fronteiras + transcript persistido; cada escrita no ADO logada com payload.
- Prior art: repo novo — estes testes estabelecem o padrão.

## Métricas e baseline

Fato da squad: só a rolagem de sprint é registrada de forma confiável no ADO hoje ([Métricas](issues/09-metricas-de-retrabalho.md)). Trio anti-vaidade:

1. **Taxa de rolagem** (resultado): % de US que entram numa sprint e não concluem nela. Fonte: WIQL sobre iterations, zero disciplina nova. **Baseline retroativa ~6 sprints antes do rollout**; meta fixada quando a baseline sair (ordem de grandeza: cair para menos da metade em ~3 meses).
2. **Cobertura de refinamento** (adoção): % das US da sprint que passaram por Investigação + grilling + despejo. Fonte: artefatos que a ferramenta grava no ADO. Monitora os sinais de falsificação (b)/(c).
3. **Dúvidas abertas no despejo** (qualidade): pendências do gate por US. Cruzamento: US despejada com muitas dúvidas que rola de sprint indica onde apertar o grilling.

Coleta: script WIQL fora da ferramenta (reusa o `ado-client`), rodado por sprint, olhado na retro. Interpretação combinada: rolagem caindo + cobertura alta = funciona; rolagem caindo + cobertura baixa = outra causa; rolagem estável + cobertura alta = tese falhou. A métrica de resultado vem do ADO cru, não da ferramenta avaliada.

## Rollout

Cinco decisões encadeadas ([Plano de adoção](issues/13-plano-de-adocao.md)):

1. **Demo antes do pitch**: apresentar ao PO a Investigação do piloto manual (US real, expondo decisão que teria explodido) e pedir o mínimo: uma US passa pelo formato na próxima cerimônia.
2. **Piloto: 2 US dentro da cerimônia atual** (bloco de 20–30 min); as demais seguem o rito antigo — o contraste alimenta a comparação de graça.
3. **Baseline na largada, enquadrada como problema do processo**: a rolagem histórica é o inimigo comum; números agregados, script auditável, veredito coletivo na retro.
4. **Kill criteria pré-registrados** (antes de existirem números): se a rolagem não caiu com cobertura alta, OU se a cobertura murchou por desinteresse, o formato é abandonado. **Checkpoint de abandono** na retro da 6ª sprint (~3 meses); a decisão é da squad, não do Operador.
5. **Rampa puxada pela demanda**: cada retro define quantas US entram no fluxo na sprint seguinte. 3 retros seguidas sem expansão = sinal de desinteresse, tratado como tal.

## Unknowns explícitos

O que a spec assume sem ter verificado — cada um tem dono natural na implementação ou no rollout:

- **Falsificação squad-wide segue aberta até o rollout**: o piloto manual validou com n=1 (o Operador); os sinais (a)/(b)/(c) só se resolvem com a squad usando.
- **Campos de estimativa do processo do ADO da squad** (`StoryPoints` vs `Effort` vs `Size`): descobrir via `wit_get_work_item_type` na implementação do config.
- **Estabilidade do `codex app-server` como dependência**: JSON-RPC/stdio funciona hoje; a interface estreita do `agent-runtime` é o seguro, não uma garantia.
- **Qualidade do grilling coletivo ao vivo**: o loop de perguntas funciona em terminal single-player; a dinâmica de sala (ritmo, paciência do PO, projeção) só o piloto revela.
- **Latência da Investigação**: aceitável AFK, mas o teto tolerável (minutos? uma hora?) ainda é chute até rodar em US reais.
- **Valor da meta de rolagem**: fixado só quando a baseline retroativa sair.

## Roadmap incremental

Triagem do backlog original (~20 itens) em fases. Regra geral: fase é destravada por **critério observável**, nunca por cronograma. Derivados ricos sempre nascem do ADO ([ADR 0003](../../docs/adr/0003-azure-devops-como-fonte-da-verdade.md)).

### Já coberto pelo MVP

| Item do backlog | Onde |
|---|---|
| MCP | Leituras do ADO pelo agente são via MCP |
| Análise de impacto entre repositórios | É o coração da Investigação |
| Busca de código relacionado | Investigação com citação obrigatória |
| Sugestão de arquivos a alterar | Evidências da Investigação + tasks agent-ready |
| Histórico de refinamentos | O ADO é o ledger (spec, Registros de decisão, tasks) |
| Métricas de qualidade dos refinamentos | Trio de métricas via script WIQL |
| Exportação para Markdown | Todos os artefatos já são Markdown no ADO (PDF: YAGNI) |

### Fase 1 — Aprofundar a cerimônia

*Entra quando: piloto rodando e retros pedindo mais do fluxo (rampa em expansão).*

- **Perguntas padrão do grilling** (a versão honesta de "templates de refinamento" — o checklist configurável segue cortado): padrões recorrentes de pergunta viram biblioteca.
- **Geração de ADR**: Registro de decisão já é o primo; quando decisões arquiteturais recorrerem na cerimônia, ganham formato ADR no despejo.
- **Diagramas Mermaid**: na Investigação/spec, quando a squad pedir visualização de impacto.
- **Plano de testes por task**: aprofunda os critérios de aceite agent-ready.

### Fase 2 — Escalar e derivar

*Entra quando: Checkpoint de abandono (6ª sprint) decidir manter o formato.*

- **Disparo automático da Investigação** (webhook/service hook REST — o MCP não tem eventos): US entra no backlog refinável ⇒ Investigação sai sozinha.
- **Multi-operador**: outro dev conduz cerimônia; exige repensar auth (escritas saem em nome da identidade autenticada).
- **Sugestão de estimativa** (Story Points): sempre sugestão com evidência, nunca gravação automática — a estimativa é da squad.
- **Busca semântica + base de conhecimento**: derivadas do corpus de refinamentos no ADO, quando o volume tornar busca manual custosa.
- **Matriz de riscos**: só se o gate mostrar que unknowns explícitos não bastam.
- **Fallback GLM via Agent SDK → Z.ai**: destravado por gatilho próprio — custo/qualidade do Codex degradar; a costura já existe no `agent-runtime`.

### Fase 3 — Orquestração de agentes (mapa próprio)

*Entra quando: refinamento rodando E throughput de implementação diagnosticado como gargalo.* Fora deste mapa (ver Out of scope); a ponte está pronta: tasks agent-ready com `Blocked by` nativo. O "leitor frio" vira o teste de aceitação desse esforço.

### Fase Mercado — só se o destino for redesenhado

Novo esforço wayfinder, não uma fase deste roadmap: integração GitHub, integração Jira, multi-LLM como feature de venda, multi-tenant/onboarding, análise de débito técnico (problema distinto do refinamento). Lição do Height: cuidado com economia de inferência em produto por assento — dogfood self-hosted não sofre disso.

## Out of Scope

- **Dashboard de sprint, gestão de backlog, segundo tracker** — papel do ADO; o picker mínimo é a única sobra legítima.
- **Checklist configurável de "pronto"** — teatro de processo; maturidade é estrutural (gate) e itens obrigatórios futuros viram perguntas padrão do grilling.
- **Spec formal separada da ata** — um artefato só; dois divergem.
- **Histórico/busca próprios** — o ADO é o ledger.
- **Multi-operador e disparo automático** — evolução pós-MVP (Fase 2).
- **Estimativa sugerida por IA** — a estimativa é da squad; sugestão vai para a Fase 2.
- **Orquestração de agentes sobre as tasks** — outro problema (throughput), ainda não diagnosticado; mapa wayfinder próprio quando chegar a hora.
- **Productização para mercado** — dogfood na squad primeiro; só volta redesenhando o destino.

## Further Notes

- Idioma dos artefatos gerados (Investigação, spec, tasks): pt-BR, o idioma da squad.
- O protótipo HTML da UI é insumo visual descartável ([`prototype/ui-de-sessao.PROTOTYPE.html`](prototype/ui-de-sessao.PROTOTYPE.html)), não código a promover.
- Research completa em [`research/`](research/): anatomia das skills, paisagem competitiva, superfície do ADO, runtime de agente, codex/GLM.
- Assunções de ambiente herdadas das skills originais e reproduzidas aqui: repos legíveis localmente, agente com fact-finding, contexto contínuo dentro da cerimônia (via SQLite, não via janela de contexto), tracker acessível.
