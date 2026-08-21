# Corte de escopo do MVP

Type: grilling
Status: resolved
Blocked by: 06

## Question

Com a forma do produto decidida ([Posicionamento](06-posicionamento-plataforma-vs-cunha.md)): o que entra no MVP e o que cai? Avaliar cada peça imaginada — dashboard, conceito de sprint, seleção de repositórios, checklist de pronto, relatório final (decisões/dúvidas/bloqueios/riscos/estimativa) — contra o problema nº 1: essa peça muda o resultado do refinamento ou é conforto?

Saída: lista fechada de capacidades do MVP + lista explícita do que foi cortado e por quê (vira insumo do roadmap).

## Answer

Resolvido em grilling com o Operador (5 perguntas confirmadas). **Revelação da sessão:** o consumidor final das tasks é uma futura **orquestração de agentes** que implementa pegando tasks sem bloqueio — o despejo produz artefatos agent-ready, mas a orquestração em si ficou fora do mapa (Out of scope).

**O MVP faz exatamente isto (lista fechada, 6 capacidades):**

1. **Config** — arquivo com os repos locais da squad (principal + relacionados) e conexão com o Azure DevOps. Definido uma vez; repos não são escolhidos por US.
2. **Picker mínimo** — lista as US da iteration atual com status inferido do próprio ADO: *sem Investigação / investigada / refinada*. É a única sobra legítima do dashboard.
3. **Investigação (AFK)** — agente lê a US + repos, mapeia furos e impacto cross-repo, sinaliza explicitamente impacto suspeito em repos fora do config, publica como comment na US.
4. **Sessão de grilling coletivo** — a UI de sessão: pergunta atual + recomendação, captura da decisão, árvore de decisões visível; HITL estrito (a IA nunca responde pela squad).
5. **Gate estrutural de maturidade** — no despejo, a sessão mostra o que segue aberto ("2 dúvidas sem resposta"); despejar com pendência é escolha consciente do operador. Sem checklist configurável.
6. **Despejo no ADO** — **spec da US** (artefato único, dupla audiência humano+agente, unknowns explícitos, gravado na própria US/wiki linkada) + **tasks filhas agent-ready** (slices verticais autocontidas, dimensionadas para uma sessão de agente, `Blocked by` nativo do ADO) + estimativa da squad nos campos + Registros de decisão como comments.

**Cortado, com motivo:** dashboard de sprint (papel do ADO); checklist configurável (teatro de processo — maturidade é estrutural; itens obrigatórios futuros viram perguntas padrão do grilling, não feature); spec formal separada da ata (um artefato só — dois divergem); histórico/busca própria (ADO é o ledger); multi-operador e disparo automático (evolução pós-MVP); estimativa sugerida por IA (estimativa é da squad, ferramenta grava; sugestão → roadmap).

**Movido para Out of scope do mapa:** orquestração de agentes sobre as tasks (dispatcher que pega tasks livres e sobe agentes) — resolve outro problema (throughput de implementação) ainda não diagnosticado; vira mapa wayfinder próprio. O formato agent-ready das tasks é a ponte deixada pronta.
