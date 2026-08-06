# Glossário — Sprint Griller

Linguagem ubíqua do domínio de refinamento. Termos cristalizados nas sessões de grilling do esforço `.scratch/mvp-spec/`.

## Termos

**User Story (US)** — item de backlog da squad no Azure DevOps. Chega ao refinamento "crua": título + poucas linhas escritas pelo PO, sem que ninguém tenha olhado o código.

**Investigação** — mapeamento dos furos de uma US e do seu impacto na codebase (inclusive entre repositórios), produzido por um agente *antes* da cerimônia de refinamento. Existe porque esse trabalho não cabe na agenda de nenhum humano da squad.

**Picker** — a tela inicial: as US da iteration atual com o Status de refinamento de cada uma. A única sobra legítima de "dashboard" no produto — existe para o Operador escolher o que investigar, não para acompanhar sprint (isso é papel do Azure DevOps).

**Status de refinamento** — onde uma US está no fluxo: *sem Investigação*, *investigada* ou *refinada*. Não é estado da ferramenta: é o nome do artefato mais avançado que ela já gravou no Azure DevOps (a Investigação como comment, a Spec da US no despejo). Some do picker se alguém apagar o artefato — e é assim que tem que ser.

**Grilling coletivo** — a cerimônia de refinamento reformulada: squad + PO grelham a US usando a Investigação como insumo, tomam as decisões ali, e tudo fica documentado e alinhado entre todos.

**Registro de decisão** — artefato de primeira classe que documenta uma decisão tomada no grilling coletivo (pergunta, resposta, quem decidiu). O oposto de "ata perdida": é consultável e vinculado à US.

**Explosão** — descoberta de dependência ou restrição técnica no meio da implementação, depois da US já estimada e em sprint: a estimativa dobra e a decisão final é tomada às pressas, sem o PO saber que houve uma decisão. É a consequência dominante que o produto existe para evitar.

**US madura** — estado que uma US atinge quando o grilling coletivo não tem mais perguntas abertas: nuances mapeadas, decisões registradas, sem dúvidas silenciosamente assumidas.

**Operador** — a pessoa que dispara a Investigação e conduz o grilling coletivo na cerimônia. No MVP há um único operador (o Lucas); a squad e o PO participam das decisões, mas não operam a ferramenta.

**UI de sessão** — a única superfície própria do produto: uma tela web que a sala inteira acompanha durante o grilling coletivo (pergunta atual, recomendação do agente, decisão capturada, árvore de decisões). Ao final da cerimônia, despeja os artefatos no Azure DevOps.

**Despejo** — o momento final da cerimônia em que a sessão grava tudo no Azure DevOps: spec da US, tasks filhas, estimativa e Registros de decisão. Passa pelo gate de maturidade: pendências abertas são mostradas e despejar com elas é escolha consciente do Operador.

**Spec da US** — artefato único de dupla audiência (humano + agente) que consolida o refinamento: decisões, contexto de impacto da Investigação, unknowns explícitos, fora-de-escopo. Vive na própria US (description/wiki linkada); não existe "ata" separada.

**Task agent-ready** — work item filho da US: slice vertical autocontida, dimensionada para uma sessão de agente, com dependências como `Blocked by` nativo do Azure DevOps — insumo direto para futura orquestração de agentes pegar tasks sem bloqueio.

**Rampa** — expansão do fluxo novo de 2 US por cerimônia até "toda US relevante", decidida pela squad a cada retro (puxada pela demanda, nunca por cronograma fixo). Dobra como instrumento de falsificação: retros seguidas sem expansão sinalizam desinteresse.

**Checkpoint de abandono** — retro da 6ª sprint após o rollout, onde a squad (não o Operador) decide manter ou abandonar o formato, contra kill criteria pré-registrados na spec antes de existirem números.
