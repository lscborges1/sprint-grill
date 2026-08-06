# Superfície de integração do Azure DevOps para refinamento de US assistido por IA

> Research: 2026-08-05. Fontes primárias: schemas do MCP server `azure-devops` instalado nesta máquina (inspecionados via ToolSearch, sem chamadas ao servidor real), repo oficial [microsoft/azure-devops-mcp](https://github.com/microsoft/azure-devops-mcp) e docs em learn.microsoft.com.

## 1. Duas superfícies disponíveis

| Superfície | O que é | Quando usar |
|---|---|---|
| **MCP oficial `@azure-devops/mcp`** (Microsoft) | ~90 tools em domínios `core`, `work`, `work-items`, `search`, `test-plans`, `repositories`, `wiki`, `pipelines`, `advanced-security`. Já instalado localmente (stdio, Node 20+). Autodescrito como "thin abstraction layer over the REST APIs" — deliberadamente conciso, não cobre 100% da REST. | Fluxo interativo dirigido por agente (Claude Code etc.) |
| **REST API** (`dev.azure.com`, api-version 7.1/7.2) | Cobertura completa, incluindo o que o MCP não expõe (service hooks, attachments upload, process customization). | Automação server-side, reação a eventos, lacunas do MCP |

Fontes: [README do MCP](https://github.com/microsoft/azure-devops-mcp), [MCP Server overview (learn)](https://learn.microsoft.com/en-us/azure/devops/mcp-server/mcp-server-overview?view=azure-devops).

## 2. Capacidades por etapa do fluxo de refinamento (tools MCP confirmadas via schema)

### 2.1 Ler backlog / US
- `wit_get_work_item` — item por ID; `expand: relations` retorna filhos/links; `fields` seleciona campos; `asOf` lê estado histórico.
- `wit_get_work_items_batch_by_ids`, `wit_list_backlog_work_items` (por projeto/time/categoria de backlog), `wit_list_backlogs`.
- `wit_query_by_wiql` — WIQL arbitrário (até 32k chars, `top` default 50). É a forma mais flexível de selecionar "US candidatas a refinamento" (ex.: `State = 'New' AND [System.IterationPath] = ...`).
- `search_workitem` — busca full-text com filtros (project, areaPath, workItemType, state, assignedTo).
- `wit_list_work_item_revisions` — histórico de revisões (auditoria do refinamento).
- `wit_get_work_item_type` — metadados do tipo (campos disponíveis no processo do projeto).

### 2.2 Escrever perguntas/decisões como comments
- `wit_add_work_item_comment` — aceita **Markdown** (default) ou HTML.
- `wit_list_work_item_comments`, `wit_update_work_item_comment`.
- REST correspondente: grupo **Comments** (Add/Get/Get pageable/Update/Delete, api-version 7.1) — [docs](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments?view=azure-devops-rest-7.1). Obs.: em 7.1 parte das operações de comments ainda é rota `-preview`; funciona normalmente em Services.

### 2.3 Criar tasks filhas
- `wit_add_child_work_items` — **cria N filhos de uma vez** sob um `parentId`, com title, description (Markdown), areaPath e iterationPath por item. É a tool ideal para "quebrar US em tasks".
- `wit_create_work_item` — criação genérica (qualquer tipo, campos arbitrários `System.*`/`Microsoft.VSTS.*`).
- `wit_work_items_link` — links em lote com tipos `parent`, `child`, `related`, `predecessor/successor`, `tests/tested by`, etc., com comment opcional no link.
- `wit_work_item_unlink` para desfazer.

### 2.4 Preencher estimativas e campos
- `wit_update_work_item` / `wit_update_work_items_batch` — JSON Patch sobre `/fields/...` (add/replace/remove); batch aceita formato Markdown para campos de texto grande.
- Campos de estimativa por processo ([índice de campos](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/work-item-field?view=azure-devops)):
  - **Story Points** (Agile): `Microsoft.VSTS.Scheduling.StoryPoints`
  - **Effort** (Scrum/Basic): `Microsoft.VSTS.Scheduling.Effort`
  - **Size** (CMMI): `Microsoft.VSTS.Scheduling.Size`
  - Tasks: `Microsoft.VSTS.Scheduling.OriginalEstimate` / `RemainingWork` / `CompletedWork`
  - Também graváveis: `Microsoft.VSTS.Common.AcceptanceCriteria` (Scrum), `System.Description`, `Priority`, `StackRank`, tags.
- Confirmar o campo certo por projeto via `wit_get_work_item_type` (o processo do projeto define quais existem).

### 2.5 Iterations / sprints e capacidade
- `work_list_team_iterations` (timeframe `current` suportado), `work_list_iterations`, `wit_get_work_items_for_iteration`.
- Planejamento: `work_create_iterations`, `work_assign_iterations` (atribuir sprint ao time).
- Capacidade: `work_get_team_capacity`, `work_get_iteration_capacities`, `work_update_team_capacity`, `work_get_team_settings` — dá para o fluxo checar capacidade antes de puxar US para a sprint.

### 2.6 Wiki
- `wiki_create_or_update_page` — cria/atualiza página com conteúdo **Markdown**; usa ETag para edição concorrente (busca automaticamente se omitido); branch default `wikiMaster`. Serve para publicar atas/decisões de refinamento.
- Leitura: `wiki_get_page`, `wiki_get_page_content` (aceita URL completa da página), `wiki_list_pages`, `wiki_list_wikis`, `search_wiki`.

### 2.7 Contexto de código (enriquecer o refinamento)
- `search_code`, `repo_get_file_content`, `repo_list_directory`, `repo_list_repos_by_project` — o agente pode ler o código real ao refinar.
- `wit_link_work_item_to_pull_request`, `wit_add_artifact_link` — ligar US a PRs/branches/commits.

## 3. Autenticação

### MCP oficial
- **Local (stdio, `npx @azure-devops/mcp`)**: login interativo Entra ID via browser na primeira tool executada; alternativas: Azure CLI (`az login`) ou PAT. É a variante indicada para Claude Code/Claude Desktop/Cursor ([overview](https://learn.microsoft.com/en-us/azure/devops/mcp-server/mcp-server-overview?view=azure-devops)).
- **Remoto (hosted pela Microsoft, recomendado quando o cliente suporta)**: só Entra ID; suportado em VS Code, Visual Studio, Copilot Studio, Foundry — clientes como Claude Code usam o local justamente porque não autenticam no remoto.
- MCP Server é **Azure DevOps Services only** (não Server on-prem) e requer agent-mode.

### REST API ([guia oficial de auth](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops))
- **Recomendado**: Microsoft Entra ID — managed identity (workload no Azure), service principal (fora do Azure), service connection (pipelines), OAuth/MSAL (apps interativos). Tokens curtos, sem segredo manual.
- **PAT**: funciona (header Basic), mas Microsoft classifica como maior risco ("use sparingly"), com campanha ativa de redução de PATs; adequado só para script pessoal/legado/on-prem.
- OAuth Entra só existe em **Services**; on-prem Server = PAT ou Windows Auth.
- Tokens devem ser tratados como opacos (Azure DevOps passou a criptografar payloads em 2025).

## 4. O que só a REST API dá (além do MCP)

- **Service hooks / webhooks** — o MCP não tem tools de eventos. Eventos de work item disponíveis ([docs](https://learn.microsoft.com/en-us/azure/devops/service-hooks/events?view=azure-devops)): `workitem.created`, `workitem.updated`, `workitem.commented`, `workitem.deleted`, `workitem.restored`, com filtros por `areaPath`, `workItemType` e (para created/updated) `changedFields`. Consumer "Web Hooks" faz POST JSON para endpoint próprio; subscriptions gerenciáveis via REST (`_apis/hooks/subscriptions`). É o mecanismo para o fluxo **reagir** (ex.: US movida para "Ready for Refinement", ou humano respondeu comment → acordar o agente).
- Upload de attachments, work item delete/recycle bin, customização de processo (campos/estados), dashboards, notificações — sem tool MCP correspondente.
- Reactions em comments e @menções: REST comments aceita HTML com menções (`<a href="#" data-vss-mention="version:2.0,{userId}">`); o MCP comment tool só expõe texto Markdown/HTML simples.

## 5. Limitações e pontos de atenção

1. **MCP é fino e incompleto por design** — sem service hooks, sem attachments, sem admin de processo. Para o "trigger" do fluxo é preciso REST (webhook) ou polling via WIQL.
2. **Identidade das escritas**: tudo que o MCP grava (comments, tasks, estimativas) sai em nome da identidade autenticada (usuário Entra ou dono do PAT). Para o fluxo assinar como "bot", usar service principal com acesso à org.
3. **Campos de estimativa variam por processo** (StoryPoints vs Effort vs Size) — resolver dinamicamente via `wit_get_work_item_type` em vez de hardcode.
4. **WIQL via MCP** tem `top` default 50 e limite de 32k chars na query.
5. **`wit_update_work_item`** aplica JSON Patch campo a campo; validações de processo (campos obrigatórios por estado) podem rejeitar o patch — tratar erro.
6. **Wiki**: concorrência via ETag; wikis "code wiki" (publicadas de repo) têm branch próprio — o default `wikiMaster` só vale para project wiki.
7. **MCP Server = Azure DevOps Services**; se a squad estiver em Azure DevOps Server on-prem, resta REST + PAT/Windows Auth.
8. Vários endpoints REST relevantes (comments) ainda são versão `-preview` em 7.1 — estáveis na prática em Services, mas sujeitos a mudança de contrato.

## 6. Fontes

- Schemas das tools MCP `azure-devops` locais (ToolSearch, 2026-08-05)
- https://github.com/microsoft/azure-devops-mcp (README: auth, domínios, thin-layer, local vs remote)
- https://learn.microsoft.com/en-us/azure/devops/mcp-server/mcp-server-overview?view=azure-devops (Services-only, auth por variante, clientes suportados)
- https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops (Entra ID recomendado, PAT desencorajado, tabela por cenário)
- https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments?view=azure-devops-rest-7.1 (operações de comments)
- https://learn.microsoft.com/en-us/azure/devops/service-hooks/events?view=azure-devops (eventos workitem.* e filtros)
- https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/work-item-field?view=azure-devops (Story Points/Effort/Size por processo)
