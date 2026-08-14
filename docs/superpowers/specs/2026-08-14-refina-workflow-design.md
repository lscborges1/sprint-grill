# Refina — design do fluxo de refinamento

## Problema

O fluxo atual encerra a sessão quando o turno do agente termina, mesmo que ainda existam furos na US. Ele também força a sala a separar previamente fatos de decisões, exige uma autoria individual para decisões coletivas e mistura entrevista, Spec e Tasks em uma única conclusão implícita.

## Solução

O produto passa a se chamar **Refina** e conduz um fluxo persistido em quatro etapas: Refinar, revisar a Spec, revisar os Tickets e publicar. Uma agenda reúne todos os furos vindos da Investigação, da sala e do agente. Cada item precisa terminar resolvido ou justificadamente fora de escopo.

O fim de um turno não encerra o refinamento. O agente precisa propor explicitamente a conclusão, o sistema verifica a agenda e a sala confirma o avanço. Uma nova dúvida posterior reabre o refinamento e invalida aprovações derivadas.

## Estados e artefatos

- Fases: `refinando`, `aguardando-confirmacao`, `revisando-spec`, `revisando-tickets`, `pronto-para-publicar` e `publicado`.
- Itens da agenda: abertos, em pesquisa, aguardando a sala, resolvidos por fato ou escolha, ou fora de escopo com justificativa.
- Fatos carregam resposta e citações verificadas; escolhas carregam resposta, recomendação e horário. Nenhuma resolução carrega autoria individual.
- A Spec contém Problema, Solução, Comportamentos esperados, Decisões de implementação, Estratégia de testes, Fora de escopo e Rastreabilidade.
- Tickets são slices verticais com descrição, critérios de aceite, link da Spec e dependências acíclicas.

## Interação

Há exatamente uma pergunta ativa por vez. “Adicionar dúvida” aceita qualquer furo em uma sessão auxiliar: fatos verificáveis voltam com evidências; escolhas são incluídas na agenda sem interromper a pergunta atual.

O Palco mostra a agenda, a pergunta ativa e a confirmação coletiva. O Dossiê continua sendo a superfície do operador, agora com gates separados para Spec e Tickets. Publicação exige agenda zerada, versões aprovadas e estimativa válida.

## Compatibilidade

Namespaces, rotas, configuração, banco e marcadores `sprint-griller:*` permanecem como identificadores internos. O schema local sobe de versão e recusa bancos antigos; artefatos já publicados no Azure DevOps não são reescritos.
