# Métricas: medir retrabalho objetivamente

Type: grilling
Status: resolved
Blocked by: 07

## Question

Como saber, com números, se a ferramenta reduz retrabalho? Candidatas: taxa de US devolvida/reaberta, mudanças de escopo após início da implementação, delta estimativa vs realizado, nº de dúvidas abertas na entrada da sprint, tempo de ciclo do refinamento. O que a squad consegue medir **hoje** no Azure DevOps sem burocracia extra? Definir baseline antes do rollout para haver comparação honesta.

Saída: 2–3 métricas com fonte de dado, forma de coleta e baseline.

## Answer

Resolvido em grilling com o Operador. Fato-chave da squad: **só a rolagem de sprint é registrada de forma confiável no ADO hoje** — estimativas não são revisadas e tasks imprevistas nem sempre viram work item. O desenho se apoia nisso:

1. **Taxa de rolagem** *(resultado — a métrica que importa)*: % de US que entram numa sprint e não concluem nela. Fonte: iterations do ADO via WIQL, zero disciplina nova. **Baseline retroativa** sobre as últimas ~6 sprints antes do rollout (sem efeito Hawthorne). Meta de sucesso fixada quando a baseline sair (ordem de grandeza: cair para menos da metade em ~3 meses).
2. **Cobertura de refinamento** *(adoção)*: % das US da sprint que passaram pela cerimônia completa (Investigação + grilling + despejo) antes de entrar. Fonte: os artefatos que a própria ferramenta grava no ADO. Dobra como monitor dos critérios de falsificação (b)/(c) do [problema nº 1](05-o-problema-certo.md).
3. **Dúvidas abertas no despejo** *(qualidade do refinamento)*: pendências mostradas pelo gate no momento do despejo, por US. Fonte: a ferramenta. Cruzamento diagnóstico: US despejada com muitas dúvidas que depois rola de sprint indica onde o grilling precisa apertar.

**Coleta e revisão:** script WIQL fora da ferramenta (coerente com o corte: sem dashboard), rodado por sprint, resultado olhado na retro.

**Interpretação combinada (anti-vaidade):** rolagem caindo + cobertura alta = funciona; rolagem caindo + cobertura baixa = outra causa; rolagem estável + cobertura alta = tese falhou (falsificação (a)). A métrica de resultado vem do ADO cru, não da ferramenta avaliada.
