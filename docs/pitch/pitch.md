# Pitch Refina — 10 a 15 minutos

## 01 — A US está realmente pronta?

- **Mensagem principal:** uma US pode parecer pronta e ainda esconder incertezas críticas.
- **Conteúdo:** provocação inicial: “Essa US está realmente pronta para entrar na sprint?”
- **Sugestão visual:** tela dark, uma US curta em formato de card/terminal, cursor piscando e a pergunta em destaque.
- **Duração:** 1 min.

## 02 — O problema aparece tarde

- **Mensagem principal:** parte da investigação começa quando a sprint já começou.
- **Conteúdo:** fluxo atual: US → Refinamento → Sprint → Dev investiga → Gap → Nova discussão → Bloqueio.
- **Sugestão visual:** pipeline minimalista com o gap aparecendo em vermelho depois de “Sprint”.
- **Duração:** 1,5 min.

## 03 — O custo não é só atraso

- **Mensagem principal:** descoberta tardia reduz previsibilidade.
- **Conteúdo:** bloqueios, dependências descobertas tarde, interrupções, retrabalho, novo alinhamento.
- **Sugestão visual:** logs/trace de pipeline com warnings; sem métricas inventadas.
- **Duração:** 1 min.

## 04 — E se investigássemos antes?

- **Mensagem principal:** mover descoberta para a esquerda.
- **Conteúdo:** virada narrativa: investigação técnica antes da sprint como complemento ao refinamento humano.
- **Sugestão visual:** diff do fluxo com o bloco “Investigação” movendo para antes do refinamento.
- **Duração:** 1 min.

## 05 — Refina

- **Mensagem principal:** Refina antecipa perguntas, gaps e dependências antes de construir.
- **Conteúdo:** Refina — descubra antes de construir. Não substitui a squad; entrega contexto enriquecido para a sala.
- **Sugestão visual:** wordmark simples + três outputs: perguntas, impactos citados, decisões.
- **Duração:** 1 min.

## 06 — Como funciona hoje

- **Mensagem principal:** o protótipo já tem um fluxo real, com limites claros.
- **Conteúdo:** Picker → Investigação AFK → grounding → publicação → Palco/Dossiê → Spec/Tickets.
- **Sugestão visual:** diagrama técnico dark com nós em monoespaço e setas tipo pipeline.
- **Duração:** 2 min.

## 07 — Demo

- **Mensagem principal:** uma US aparentemente simples revela perguntas antes da implementação.
- **Conteúdo:** abrir Picker, escolher US fictícia de cupom, mostrar Investigação com gaps, abrir Palco e Dossiê.
- **Sugestão visual:** demo ao vivo; poucos slides durante esse bloco.
- **Duração:** 4–5 min.

## 08 — Antes × com Refina

- **Mensagem principal:** não elimina bloqueios; tenta antecipar descoberta.
- **Conteúdo:** Antes: Refinamento → Sprint → Investigação → Gap. Com Refina: Investigação → Refinamento → Decisão → Sprint.
- **Sugestão visual:** dois fluxos lado a lado; “descoberta” muda de posição.
- **Duração:** 1 min.

## 09 — Proposta de experimento

- **Mensagem principal:** validar com poucas US reais, medir qualidade dos achados.
- **Conteúdo:** escolher algumas US de próxima sprint, rodar Refina antes do refinamento, comparar relevância, ruído, gaps e dependências antecipadas.
- **Sugestão visual:** checklist de piloto + pergunta final.
- **Duração:** 1,5 min.

## 10 — Pergunta final

- **Mensagem principal:** queremos saber se vale incorporar ao fluxo.
- **Conteúdo:** “O Refina consegue antecipar descobertas que hoje fazemos tarde demais?”
- **Sugestão visual:** terminal prompt: `refina pilot --stories 5 --measure relevance`.
- **Duração:** 30s.
