# O preparo automático antecipa a Investigação, nunca a decisão

Uma instância do Refina rodando contínua (VPS) pode selecionar periodicamente USs
elegíveis do backlog — topo da prioridade, ainda sem Investigação, estado `New` —
e disparar as Investigações antes da cerimônia. O agendador é opt-in pela config
da squad (`preparo`), a fila roda com concorrência 1 e cada item é isolado:
falha numa US não para as demais e não existe retry automático — a mesma versão
da US (`rev` do work item) só volta à fila se mudar no Azure DevOps ou por
disparo do Operador.

Os runs de Investigação — inclusive os manuais — passam a persistir num banco
SQLite próprio (`investigacoes.db`, irmão do banco de cerimônia), porque o `Map`
em memória perdia previews a cada restart. Continua valendo o
[ADR 0003](./0003-azure-devops-como-fonte-da-verdade.md): o banco local é estado
recuperável e descartável — o que diz se uma US está investigada continua sendo
o artefato publicado no Azure DevOps, nunca a linha local. Um run concluído
sobrevive ao restart; um run em andamento no momento do crash vira falha
explícita na recuperação.

A publicação segue exclusivamente manual
([ADR 0002](./0002-escrita-no-ado-e-deterministica.md)): o preparo automático
produz preview, nunca comment.

## Considered Options

Fila em memória com persistência só de relatórios prontos foi rejeitada: perdia
a fila e os estados intermediários no restart, que é exatamente quando uma
instância de VPS mais precisa deles. Retry automático com backoff foi rejeitado:
uma US que falha por config quebrada viraria um loop de turnos de agente a cada
intervalo; a retomada segura é o novo disparo (automático quando a `rev` muda,
manual sempre). Concorrência N foi rejeitada por enquanto: cada run é um
processo de agente sobre checkouts locais, e 1 mantém o custo previsível na
VPS — subir é trocar uma constante quando houver evidência de gargalo.
