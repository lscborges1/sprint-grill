# Glossário — Refina

Linguagem ubíqua do domínio de refinamento. Os identificadores internos
`sprint-griller:*` permanecem por compatibilidade; a linguagem visível do produto é Refina.

## Termos

**User Story (US)** — item de backlog da squad no Azure DevOps. Chega ao refinamento "crua": título + poucas linhas escritas pelo PO, sem que ninguém tenha olhado o código.

**Investigação** — mapeamento dos furos de uma US e do seu impacto na codebase (inclusive entre repositórios), produzido por um agente *antes* da cerimônia de refinamento. Existe porque esse trabalho não cabe na agenda de nenhum humano da squad.

**Picker** — a tela inicial: as US da iteration atual com o Status de refinamento de cada uma. A única sobra legítima de "dashboard" no produto — existe para o Operador escolher o que investigar, não para acompanhar sprint (isso é papel do Azure DevOps).

**Status de refinamento** — onde uma US está no fluxo: *sem Investigação*, *investigada* ou *refinada*. Não é estado da ferramenta: é o nome do artefato mais avançado que ela já gravou no Azure DevOps (a Investigação como comment, a Spec da US no despejo). Some do picker se alguém apagar o artefato — e é assim que tem que ser.

**Refinamento coletivo** — a cerimônia em que squad + PO refinam a US usando a Investigação como insumo, resolvem cada furo e mantêm Spec e Tickets alinhados entre todos.

**Agenda do refinamento** — lista persistida de todos os furos vindos da Investigação, da sala e do agente. Um item fica aberto, em pesquisa ou aguardando a sala até receber uma Resolução; nenhum item aberto pode avançar o fluxo para revisão da Spec.

**Resolução** — encerramento explícito de um item da agenda: fato com resposta e citações verificadas, escolha coletiva com resposta e recomendação, ou fora de escopo com justificativa. Resoluções guardam horário automático e não atribuem a escolha a uma pessoa.

**Registro de decisão** — artefato de primeira classe que documenta uma escolha coletiva do refinamento (pergunta, resposta, recomendação e horário). O oposto de "ata perdida": é consultável e vinculado à US, sem autoria individual.

**Consulta** — dúvida *factual* levantada na sala durante o Refinamento coletivo e resolvida ao vivo: o agente lê o código na hora e responde citando o arquivo. É o oposto do Registro de decisão — não há atribuição individual, porque não houve decisão: a resposta veio do repositório. Existe para matar o "alguém verifica depois", que é como uma dúvida de dez segundos vira Explosão três semanas depois.

**Explosão** — descoberta de dependência ou restrição técnica no meio da implementação, depois da US já estimada e em sprint: a estimativa dobra e a decisão final é tomada às pressas, sem o PO saber que houve uma decisão. É a consequência dominante que o produto existe para evitar.

**Fase do refinamento** — estado persistido da sessão: *refinando*, *aguardando confirmação*, *revisando Spec*, *revisando Tickets*, *pronto para publicar* ou *publicado*. A revisão monotônica da sessão impede que uma ação baseada numa tela antiga sobrescreva trabalho novo.

**US madura** — estado que uma US atinge quando a Agenda do refinamento não tem mais itens abertos: nuances mapeadas, resoluções registradas, sem dúvidas silenciosamente assumidas.

**Operador** — a pessoa que dispara a Investigação e conduz o Refinamento coletivo. No MVP há um único operador; a squad e o PO participam das resoluções, mas não operam a ferramenta.

**UI de sessão** — a única superfície própria do produto: uma tela web que a sala inteira acompanha durante o Refinamento coletivo (pergunta atual, recomendação do agente, decisão capturada, árvore de decisões). Ao final da cerimônia, despeja os artefatos no Azure DevOps.

**Palco** — o modo da UI de sessão que a sala vê projetado: pergunta atual, recomendação do agente, evidências e a captura da decisão, em tipografia legível a distância. Tipografia editorial aqui é requisito, não estética. O outro modo é o **Dossiê**, a aba do Operador com o documento se formando e o preview do despejo.

**Despejo** — o momento final em que a sessão grava tudo no Azure DevOps: Spec da US, Tickets filhos, estimativa e Registros de decisão. Agenda zerada, versões aprovadas e estimativa válida são gates obrigatórios; não existe override do Operador.

**Spec da US** — artefato único de dupla audiência (humano + agente) que consolida o refinamento: decisões, contexto de impacto da Investigação, unknowns explícitos, fora-de-escopo. Vive na descrição da própria US; não existe "ata" separada.

**Task agent-ready** — work item filho da US: slice vertical autocontida, dimensionada para uma sessão de agente, com dependências como `Blocked by` nativo do Azure DevOps — insumo direto para futura orquestração de agentes pegar tasks sem bloqueio.

**Rampa** — expansão do fluxo novo de 2 US por cerimônia até "toda US relevante", decidida pela squad a cada retro (puxada pela demanda, nunca por cronograma fixo). Dobra como instrumento de falsificação: retros seguidas sem expansão sinalizam desinteresse.

**Checkpoint de abandono** — retro da 6ª sprint após o rollout, onde a squad (não o Operador) decide manter ou abandonar o formato, contra kill criteria pré-registrados na spec antes de existirem números.
