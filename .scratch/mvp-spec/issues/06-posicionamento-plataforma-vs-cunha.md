# Posicionamento: plataforma web vs cunha fina

Type: grilling
Status: resolved
Blocked by: 01, 02, 05

## Question

Dado o problema nº 1 ([O problema certo?](05-o-problema-certo.md)), a anatomia das skills ([Anatomia](01-anatomia-das-skills-grill-spec-tickets.md)) e a paisagem competitiva ([Paisagem](02-paisagem-competitiva.md)): qual é a **menor superfície** que muda o resultado do refinamento da squad?

Desafiar a premissa "aplicação web com dashboard e sprints". Alternativas a pesar: (a) sem UI própria — fluxo dentro do Azure DevOps + Claude, decisões gravadas como comments/wiki; (b) UI mínima só para a sessão de refinamento (o grilling ao vivo com Produto na sala), estado no tracker; (c) a plataforma imaginada com dashboard/sprints/checklist. Saída: forma do produto, onde ele vive, e o que o diferencia de "rodar as skills no Claude Code".

## Answer

Resolvido em grilling com o Operador (3 sub-decisões + síntese confirmada).

**Forma: cunha fina, não plataforma.** A ferramenta é o instrumento do *operador do refinamento* (o Operador — operador único no MVP; disparo automático via webhook é evolução; "qualquer dev opera" talvez nunca), com dois momentos:

1. **Antes da cerimônia (AFK):** o operador dispara a **Investigação** — agente lê a US no Azure DevOps + os repos da squad, mapeia furos e impacto cross-repo, publica o resultado como comment na própria US.
2. **Na cerimônia (ao vivo):** a **UI mínima de sessão** — uma única tela web, premium e legível numa sala — conduz o grilling coletivo sobre a Investigação: pergunta atual, recomendação do agente, decisão capturada, árvore de decisões sempre visível. Ao final, despeja tudo no Azure DevOps: Registros de decisão como comments, tasks como work items filhos, estimativa nos campos, ata na wiki.

**Onde vive:** máquina do operador; VPS só se/quando precisar. **Fonte da verdade: Azure DevOps** — a ferramenta guarda só estado de sessão (ex.: SQLite); ela não é um lugar que a squad visita, é o que faz o tracker delas ficar rico.

**O que NÃO é:** dashboard de sprint, gestão de backlog, segundo tracker; ninguém além do operador instala nada.

**Diferencial vs "rodar as skills no Claude Code na mão":** (1) **ledger** — decisões param de evaporar da janela de contexto e viram artefatos navegáveis no ADO; (2) **sala** — grilling coletivo legível para squad + PO, impossível num terminal; (3) **fluxo estruturado** — Investigação → grilling → despejo no tracker em um clique, sem coreografia manual de skills.

**Consequências no mapa:** UI própria sobreviveu, mas restrita à sessão → graduada a névoa do protótipo/linguagem visual em [Protótipo da UI de sessão](12-prototipo-ui-de-sessao.md); acesso a repos = checkouts locais na máquina do operador (detalhe na [Arquitetura](10-arquitetura-e-stack.md)); dashboard/sprints/checklist-plataforma somem do escopo do [Corte de escopo](07-corte-de-escopo-do-mvp.md).
