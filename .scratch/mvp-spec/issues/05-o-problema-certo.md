# O problema certo? Causa-raiz da dor de refinamento

Type: grilling
Status: resolved

## Question

Antes de aceitar "falta uma ferramenta": onde exatamente o refinamento quebra hoje? Diagnosticar a cerimônia atual da squad — quem participa, o que entra, o que sai, quanto tempo leva. Das seis consequências listadas (US incompletas, decisões na implementação, dependências tardias, estimativas imprecisas, retrabalho, sem histórico), qual dói mais e custa mais? O gargalo é processo, pessoas (ex.: Produto ausente/lento para responder), ou acesso à informação (ninguém sabe o que o código faz)? O que **falsificaria** a premissa de que uma ferramenta resolve?

Saída: enunciado do problema nº 1 com evidência concreta da squad + critério de falsificação. Conduzir com /grilling + /domain-modeling (uma pergunta por mensagem).

## Answer

Resolvido em sessão de grilling com o Lucas (5 perguntas, todas confirmadas). Enunciado final:

**Problema nº 1:** Investigar o impacto de uma US na codebase antes do refinamento não cabe na agenda de nenhum humano — então ninguém faz: a cerimônia (~1h, squad + PO) refina US cruas (título + poucas linhas) sem ninguém ter olhado o código, e a estimativa sai com dúvidas abertas. Consequência dominante: **dependência técnica descoberta no meio da implementação** — estimativa dobra, decisão final tomada às pressas sem o PO saber que houve uma decisão.

**O que resolve (tese em duas metades, ambas necessárias):**
1. **Investigação que chega pronta** — um agente faz antes da cerimônia o mapeamento de furos da US e impacto cross-repo que não cabe na agenda de nenhum humano.
2. **Refinamento como grilling coletivo** — a cerimônia usa essa investigação para grelhar a US com squad + PO, tomando as decisões ali, com as nuances mapeadas e tudo documentado e alinhado entre todos — o registro da decisão é artefato de primeira classe, não ata perdida.

**Causa-raiz:** custo humano da investigação cross-repo (horas de um sênior, "por precaução") — não falta de processo nem conhecimento concentrado; a falta de slot no processo é sintoma dela.

**Evidência:** padrão confirmado pelo Lucas na cerimônia atual + **piloto manual já executado** (investigação com IA antes da sprint mapeou furos na US e impacto na codebase, com ganho percebido claro) — a premissa sobreviveu ao teste barato.

**Falsificação (versão squad-wide, segue aberta até o rollout):** (a) explosões por dependência continuam no mesmo ritmo mesmo com investigação prévia; (b) squad/PO ignoram os relatórios na cerimônia; (c) ninguém além do Lucas roda o fluxo.

**Implicação para o mapa:** as duas metades são o critério de avaliação do [Posicionamento](06-posicionamento-plataforma-vs-cunha.md) — qualquer forma de produto que não entregue *investigação pronta antes* + *grilling coletivo documentado durante* não resolve o problema nº 1.
