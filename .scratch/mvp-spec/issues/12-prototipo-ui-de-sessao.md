# Protótipo da UI de sessão

Type: prototype
Status: resolved
Blocked by: 07

## Question

Como é a tela da cerimônia? Prototipar (via /prototype, descartável) a UI mínima de sessão do grilling coletivo: pergunta atual + recomendação do agente em tipografia legível numa sala, captura da decisão, árvore de decisões sempre visível, e o momento de "despejo" para o Azure DevOps. Aplicar a linguagem visual de referência (Witek: tipografia, espaçamento, minimalismo, animações discretas — sem copiar layout).

Reagir ao protótipo com o Operador decide: layout da sessão, o que é visível para a sala vs só para o operador, e como o fim da cerimônia se apresenta. O protótipo é insumo da spec, não código de produção.

## Answer

Protótipo entregue como HTML autocontido e descartável (o repo ainda não tem app — sub-shape B da skill): [`../prototype/ui-de-sessao.PROTOTYPE.html`](../prototype/ui-de-sessao.PROTOTYPE.html), com 3 variantes estruturalmente distintas sobre os mesmos dados mock, trocáveis por pílula flutuante / setas do teclado / `?variant=A|B|C`:

- **A — Palco** (clara, projeção-first): pergunta atual + recomendação em tipografia editorial gigante no centro; árvore de decisões num trilho lateral de 300px; gate resumido no rodapé do trilho.
- **B — Dossiê** (clara, documento-first): à esquerda a spec da US se formando ao vivo (Investigação, "Não verificado", decisões com quem/quando, pendências); à direita painel sticky "Em discussão" com botão de despejo e contagem de pendências.
- **C — Trilha** (escura, fluxo-first): feed cronológico de eventos da cerimônia; pergunta atual ancorada embaixo estilo composer; barra de progresso compacta no topo com botão de despejo.

**Veredito do Operador**: acatou a leitura recomendada — **A (Palco) como base** da UI de sessão, roubando:

- da **B**: o **dossiê como segunda tela/aba** — vira a superfície do preview editável do despejo (a spec da US se formando é exatamente o que se revisa antes de despejar);
- da **C**: a **barra de progresso compacta no topo** (segmentos por decisão + acesso ao despejo com contagem de pendências).

**Implicações para a spec (ticket 11)**: a UI de sessão tem dois modos — *Palco* (o que a sala vê projetado: pergunta, recomendação, evidências, opções, árvore no trilho) e *Dossiê* (aba do operador: documento vivo + preview editável do despejo). Progresso e pendências sempre visíveis no topo. Tipografia editorial legível a distância é requisito, não estética. O protótipo é insumo visual, não código a promover.
