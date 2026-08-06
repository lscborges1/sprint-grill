# Plano de adoção na squad

Type: grilling
Status: resolved

## Question

Como a cerimônia reformulada entra na squad sem morrer na segunda sprint? Decidir: como conseguir o buy-in do PO (a metade 2 da tese depende dele responder decisões ao vivo), como é a primeira sprint piloto (quantas US, qual cerimônia substitui/complementa a atual), como as [métricas](09-metricas-de-retrabalho.md) e a baseline são apresentadas à squad sem parecer vigilância, e o que dispara o abandono honesto (critérios de falsificação do [problema nº 1](05-o-problema-certo.md) sendo monitorados por quem).

Saída: plano de rollout enxuto que entra como seção da spec final.

## Answer

Resolvido em grilling com o Lucas (5 perguntas + confirmação). Plano de rollout em 5 decisões:

1. **Buy-in do PO: demo antes do pitch.** Apresentar ao PO a Investigação do piloto manual já executado (US real da squad, expondo uma decisão que teria explodido no meio da sprint) e pedir o mínimo: "na próxima cerimônia, uma US passa por isso; você participa como sempre". O compromisso com o formato novo vem depois do valor visto — nunca antes. Descartados: pitch de processo antes da demo (risco "mais uma cerimônia") e fato consumado (corrói confiança; transparência é o produto).

2. **Sprint piloto: 2 US dentro da cerimônia atual.** Um bloco de 20–30 min da cerimônia existente (~1h) roda o formato novo (Investigação + grilling coletivo + despejo via UI de sessão); as demais US seguem o rito antigo. Sem reunião extra, e o contraste US grelhada vs US crua na mesma sprint alimenta a comparação e a métrica de cobertura de graça.

3. **Métricas: baseline na largada, enquadrada como problema do processo.** A taxa de rolagem histórica (~6 sprints via WIQL, do [ticket de métricas](09-metricas-de-retrabalho.md)) é apresentada na própria demo como inimigo comum: "X% das nossas US rolam; a tese é que refinamento com investigação prévia derruba isso; medimos por sprint e olhamos na retro". Antídotos à leitura de vigilância: números sempre agregados por sprint (nunca por pessoa), script WIQL auditável no repo, veredito coletivo na retro — a squad julga a ferramenta, não a ferramenta julga a squad.

4. **Abandono honesto: kill criteria pré-registrados + checkpoint na retro da 6ª sprint (~3 meses).** Gravado na spec antes do rollout: "se a rolagem não caiu com cobertura alta, OU se a cobertura murchou por desinteresse, o formato é abandonado". A decisão é da squad na retro do checkpoint, com os números na mesa — não do operador, que é parte interessada. Entre checkpoints, os sinais (b)/(c) da [falsificação](05-o-problema-certo.md) são olhados em toda retro via cobertura. Tradução do critério (c) para o MVP (operador único é por desenho): o sinal honesto é **desinteresse** — squad/PO não pedirem que US passem pelo fluxo — e não "só o Lucas opera".

5. **Rampa puxada pela demanda, decidida na retro.** Cada retro define quantas US passam pelo fluxo na sprint seguinte, com expectativa explícita de crescimento. A rampa vira instrumento de falsificação: 3 retros seguidas sem expansão = sinal (c) de desinteresse, tratado como tal (não como "vamos dar mais tempo"). Descartadas: rampa fixa (infla artificialmente a métrica de adoção que deveria monitorar desinteresse) e expansão total imediata (all-in que a decisão do piloto já descartou).

**Encadeamento:** demo (1) → piloto de 2 US (2) → rampa por demanda (5) → checkpoint aos 6 sprints (4), com as métricas (3) visíveis em toda retro. Entra como seção "Rollout" da spec final.
