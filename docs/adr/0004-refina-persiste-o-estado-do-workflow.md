# Refina persiste o estado do workflow

O pacote `ceremony` é dono do estado transitório do Refina. A sessão persiste uma fase do
refinamento e uma revisão monotônica; a agenda persiste cada furo como estado discriminado e
só o considera encerrado por fato verificado, escolha coletiva ou justificativa de fora de
escopo. Mutações baseadas numa revisão antiga são recusadas.

Escolhas são coletivas. Nem a decisão persistida, nem o transcript, os contratos SSE ou o
Registro publicado no Azure DevOps carregam autoria individual. A recomendação do agente e o
horário automático continuam preservados para rastreabilidade.

O SQLite continua sendo estado local recuperável, não uma segunda fonte da verdade. Depois da
publicação, Spec, Tickets, estimativa e Registros vivem no Azure DevOps, conforme o
[ADR 0003](./0003-azure-devops-como-fonte-da-verdade.md). O schema local é versionado e bancos
de versões incompatíveis são recusados em vez de migrados durante uma sessão.

## Considered Options

Derivar a fase de perguntas, processo vivo e artefatos existentes foi rejeitado porque o fim de
um turno voltaria a se confundir com o fim do refinamento e uma retomada não saberia qual gate
estava em revisão. Atribuir a escolha ao Operador também foi rejeitado: transforma uma resolução
da sala em decisão individual e cria uma autoria que o domínio não possui.
