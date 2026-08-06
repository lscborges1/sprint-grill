# Azure DevOps como fonte da verdade

Todos os artefatos do refinamento (spec da US, Registros de decisão, tasks, estimativas, ata) vivem no Azure DevOps — onde a squad e o PO já estão. A ferramenta não tem banco rico próprio: o SQLite local guarda apenas estado de cerimônia (sessão, árvore de decisões, transcript) para sobreviver a crash/refresh; após o despejo, nada precisa ser consultado nela.

## Considered Options

Banco próprio como fonte da verdade (habilitaria busca semântica e histórico rico desde já) foi rejeitado: criaria um segundo sistema de registro que a squad precisaria visitar e confiar — é como decisões voltam a evaporar. Recursos ricos futuros serão *derivados* do ADO, nunca concorrentes dele.
