# Mapa: Spec de MVP — ferramenta de refinamento (Sprint Griller)

Label: wayfinder:map

## Destination

Um `spec.md` de MVP **de-riscado** para a ferramenta de refinamento: posicionamento validado (ou reposicionado), escopo mínimo cortado, arquitetura e stack decididos, estratégia de qualidade de IA e métricas de sucesso definidas — pronto para virar plano de implementação. Primeiro cliente: a squad piloto (dogfood, Azure DevOps).

## Notes

- **Idioma**: pt-BR no mapa, tickets e spec.
- **Tracker**: local markdown (este diretório). Convenções: `issues/NN-<slug>.md`, `Type:`/`Status:`/`Blocked by:` no topo, resolução em `## Answer`. Research findings em `research/<slug>.md`.
- **Tickets grilling**: sempre invocar `/grilling` + `/domain-modeling`. Regra do usuário sobrepõe a skill: **uma pergunta por mensagem**, com resposta recomendada, aguardando a resposta antes da próxima.
- **Postura do esforço**: fundador de dev tools / product architect / staff engineer — desafiar premissas, buscar o menor produto de maior impacto. O lazy-by-default (YAGNI ladder) do usuário se aplica ao *produto*, não só ao código.
- **Fatos do ambiente**: a squad usa **Azure DevOps** (MCP `azure-devops` configurado + skill `azure-pr-squad11`); as skills de referência `grill-with-docs`, `to-spec` e `to-tickets` existem completas no cache local do plugin `mattpocock-skills` 1.2.1.
- **Decisões fundadoras (pré-mapa)**: destino = spec, não protótipo nem go/no-go; primeiro cliente = squad própria (dogfood), não produto de mercado desde o dia 1.

## Decisions so far

<!-- uma linha por ticket fechado: gist + link -->

- [Anatomia das skills grill-with-docs / to-spec / to-tickets](issues/01-anatomia-das-skills-grill-spec-tickets.md) — são prompts, não software; a janela de contexto é o "banco de dados" entre etapas e as decisões evaporam. Valor real de uma plataforma: ledger decisão→spec→ticket, multiplayer, blocking confiável, dispatch da fronteira; UI do loop é só embalagem.
- [Paisagem competitiva de refinamento assistido por IA](issues/02-paisagem-competitiva.md) — o vão "código ⊗ PO-no-loop ⊗ Azure DevOps ⊗ self-hosted" está vazio: dev-tools (Kiro/Spec Kit) excluem Produto e tracker, PM-tools (Rovo/ChatPRD) não leem código; lição do Height: economia de inferência mata produto por assento.
- [Superfície de integração do Azure DevOps](issues/03-superficie-azure-devops.md) — o MCP oficial já cobre o loop de refinamento inteiro dentro do tracker (ler US, comments de decisão, tasks filhas, estimativas, wiki); faltam só eventos/webhooks (REST) e attachments. Viabiliza a alternativa "sem UI própria" do posicionamento.
- [Runtime de agente para o fluxo de refinamento](issues/04-runtime-de-agente.md) — recomendação preliminar: Claude Agent SDK TS (repos + skills + sessões + `AskUserQuestion` prontos); assinatura Pro/Max só cobre uso próprio — terceiros/VPS multiusuário exigem API key; pinar versão. Decisão final na Arquitetura.
- [O problema certo? Causa-raiz da dor de refinamento](issues/05-o-problema-certo.md) — causa-raiz: investigar impacto cross-repo não cabe na agenda de nenhum humano. Tese em duas metades: investigação que chega pronta (piloto manual já validou) + refinamento como grilling coletivo com decisões documentadas. Falsificação squad-wide segue aberta até o rollout.
- [Posicionamento: plataforma web vs cunha fina](issues/06-posicionamento-plataforma-vs-cunha.md) — cunha fina: operador único dispara a Investigação (comment na US) e conduz a cerimônia numa UI mínima de sessão (uma tela, premium); tudo despeja no Azure DevOps, que é a fonte da verdade. Sem dashboard/sprints/segundo tracker. Diferencial: ledger + sala + fluxo de um clique.
- [Corte de escopo do MVP](issues/07-corte-de-escopo-do-mvp.md) — 6 capacidades fechadas: config, picker mínimo, Investigação, sessão de grilling, gate estrutural de maturidade, despejo (spec da US de dupla audiência + tasks agent-ready com `Blocked by` nativo). Revelação: tasks serão consumidas por futura orquestração de agentes — formato agent-ready é a ponte; a orquestração em si foi para Out of scope.
- [Qualidade da IA: útil > bonita](issues/08-qualidade-da-ia-util-nao-bonita.md) — 4 princípios com teste objetivo: citação obrigatória + checagem mecânica (senão "Não verificado"), HITL estrito (decisões com recomendação; fatos o agente busca ao vivo), despejo com preview editável + rastreabilidade decisão→spec→task, checagens estruturais de task no gate. Síntese: código = fonte dos fatos, squad = fonte das decisões, IA = transporte verificável.
- [Métricas: medir retrabalho objetivamente](issues/09-metricas-de-retrabalho.md) — fato da squad: só rolagem de sprint é confiável no ADO. Trio anti-vaidade: taxa de rolagem (resultado, baseline retroativa ~6 sprints via WIQL), cobertura de refinamento (adoção, monitora falsificação) e dúvidas abertas no despejo (qualidade). Script por sprint, revisão na retro; veredito vem do ADO cru, não da ferramenta.
- [Protótipo da UI de sessão](issues/12-prototipo-ui-de-sessao.md) — 3 variantes descartáveis ([HTML](prototype/ui-de-sessao.PROTOTYPE.html)); vence **A (Palco)**: pergunta+recomendação em tipografia editorial gigante, árvore no trilho — roubando da B o dossiê como aba do operador (preview editável do despejo) e da C a barra de progresso/pendências no topo. UI com dois modos: Palco (sala) e Dossiê (operador).
- [Plano de adoção na squad](issues/13-plano-de-adocao.md) — demo do piloto manual ao PO antes de qualquer pitch; piloto de 2 US dentro da cerimônia atual; baseline apresentada na largada como problema do processo (agregada, auditável, veredito na retro); kill criteria pré-registrados com checkpoint na retro da 6ª sprint; rampa puxada pela demanda (3 retros sem expansão = desinteresse).
- [Arquitetura e stack](issues/10-arquitetura-e-stack.md) — fato novo: assinatura do Operador migra para Codex + GLM 5.2 → runtime = **codex app-server** via módulo `agent-runtime` (JSON-RPC fino, HITL nativo; GLM fora do MVP, costura pronta). Next.js processo único + SSE; `ado-client` REST tipado como única porta de escrita (LLM redige, código grava); SQLite/Drizzle para estado de cerimônia. ADRs 0001–0003 em `docs/adr/`.
- [Montar spec.md e roadmap](issues/11-montar-spec-e-roadmap.md) — spec entregue em [`spec.md`](spec.md): formato to-spec estendido (26 user stories, princípios de qualidade testáveis, 6 unknowns explícitos com dono) + roadmap triando os 20 itens do backlog em fases com critério observável de entrada (7 já cobertos pelo MVP; Fase 1 cerimônia; Fase 2 escala; Fase 3 orquestração; Mercado só com destino redesenhado). **Fecha o mapa — o destino foi alcançado; o caminho agora é implementação.**

## Not yet specified

*(vazio — toda a névoa graduou; o mapa está completo)*

## Out of scope

- **Productização para mercado no MVP** — multi-tenant, onboarding genérico, integrações Jira/GitHub como requisito, multi-LLM como feature de venda. Decisão fundadora: dogfood na squad primeiro; só volta se o destino for redesenhado (aí como novo esforço).
- **Orquestração de agentes sobre as tasks** — o dispatcher que pega tasks sem bloqueio e sobe agentes para implementá-las (decidido no [Corte de escopo](issues/07-corte-de-escopo-do-mvp.md)): resolve outro problema (throughput de implementação) ainda não diagnosticado como gargalo; vira mapa wayfinder próprio quando o refinamento estiver rodando. O MVP deixa a ponte pronta: tasks agent-ready com `Blocked by` nativo.
