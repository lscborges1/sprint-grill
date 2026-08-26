# Refina — posicionamento do produto

## Problema

Uma User Story pode passar pelo refinamento da squad e ainda chegar à sprint com incertezas escondidas. Algumas perguntas só aparecem quando alguém começa a investigar profundamente o código: regra implícita, integração afetada, dependência entre serviços, cenário de erro, limitação de dados ou decisão de produto não tomada.

O problema não é incompetência do refinamento humano. É estrutural: parte da investigação técnica acontece tarde demais, quando a sprint já começou e a US já parece comprometida.

## Hipótese

Se parte da investigação acontecer antes da sprint, a squad pode descobrir gaps, dependências e decisões pendentes mais cedo. O Refina existe para testar esta hipótese:

> O Refina consegue antecipar descobertas que hoje fazemos tarde demais?

## Público

- Squad de engenharia que refina e implementa User Stories.
- PO/QA/devs que precisam discutir escopo com evidência técnica.
- Um **Operador** que roda a ferramenta localmente, dispara a Investigação e conduz a sala no Palco.

## Proposta de valor

**Refina — descubra antes de construir.**

O Refina insere uma camada de investigação entre a User Story e o refinamento/implementação. Ele transforma uma US crua em contexto de refinamento: perguntas, impactos técnicos citados, hipóteses não verificadas, suspeitas de dependência externa e uma agenda para a sala resolver.

## O que o Refina é

- Uma ferramenta local de apoio ao refinamento.
- Um fluxo de investigação AFK de US contra os repositórios configurados da squad.
- Um mecanismo de grounding: impactos só contam como verificados quando citam arquivo/símbolo conferível no checkout local.
- Uma UI de cerimônia para transformar gaps em resoluções, Spec revisável e tickets agent-ready.
- Um experimento para mover descoberta para a esquerda.

## O que o Refina não é

- Não substitui PO, QA, devs ou o refinamento humano.
- Não decide regra de negócio sozinho.
- Não promete eliminar bloqueios.
- Não publica nada no Azure DevOps sem ação explícita do Operador.
- Não é um dashboard paralelo de sprint.
- Não deve inventar métrica, ROI ou maturidade de US sem evidência.

## CURRENT — o que existe hoje

- App Next.js local com Picker, preview de Investigação, Palco e Dossiê.
- Integração com Azure DevOps para ler backlog/US/Wiki e publicar artefatos.
- Runtime de agente via `codex app-server`, executado no `cwd` do repo principal configurado.
- Investigação AFK: a request volta rápido e o resultado fica em memória no processo.
- Relatório estruturado em JSON, renderizado em Markdown por código determinístico.
- Checagem mecânica de citações (`verifyGrounding`) antes de permitir publicação.
- Cerimônia persistida em SQLite: agenda, resoluções, Spec, tickets, gates e despejo final.
- Marcadores HTML `sprint-griller:*` continuam como identificadores internos de compatibilidade.
- Rota `/dev-ui` em desenvolvimento para demonstrar Picker, Investigação, Palco e Dossiê sem dados confidenciais.

## PROPOSED — evolução que faz sentido perto do protótipo

- Usar o Refina em poucas US reais antes do refinamento da squad.
- Comparar achados do Refina com dúvidas que surgiriam no refinamento normal.
- Melhorar a persistência dos previews de Investigação, hoje volátil em memória.
- Registrar feedback humano sobre relevância dos achados para medir qualidade, não volume.
- Criar um modo de demo/sample formal, separado do `/dev-ui`, se a ferramenta for apresentada fora do ambiente de desenvolvimento.

## FUTURE — visão, ainda não promessa

- Histórico de investigações e comparação entre versões de US.
- Priorização automática de gaps por risco de bloqueio.
- Integração com múltiplos repositórios/serviços com controle mais fino de escopo.
- Métricas de piloto conectando achados relevantes, ruído e bloqueios potencialmente antecipados.
- Orquestração posterior de tasks agent-ready, quando o refinamento já tiver removido bloqueios.

## Métricas simples para piloto

Não medir só quantidade de gaps. Medir qualidade:

1. US analisadas.
2. Perguntas levantadas.
3. Achados considerados relevantes pela squad.
4. Gaps encontrados antes da sprint.
5. Dependências antecipadas.
6. Falsos positivos/ruído.
7. Problemas que, segundo a squad, provavelmente apareceriam apenas na implementação.

## Mensagem para a ONR

O Refina propõe um experimento, não uma solução vendida como pronta. A pergunta do piloto é simples: em algumas US reais, ele antecipa descobertas úteis antes da sprint?
