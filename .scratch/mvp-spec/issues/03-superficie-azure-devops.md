# Superfície de integração do Azure DevOps

Type: research
Status: resolved

## Question

O que dá para ler e escrever no Azure DevOps da squad — work items, iterations, comments, wiki, queries — via o MCP server `azure-devops` já configurado nesta máquina e via REST API? Enumerar as tools `mcp__azure-devops__*` disponíveis e agrupá-las por capacidade; verificar nos docs oficiais (Microsoft) o modelo de auth (PAT/Entra) e limites relevantes.

Objetivo: saber o que um fluxo de refinamento conseguiria fazer *dentro* do tracker da squad (ler US, gravar perguntas/decisões como comments, criar tasks filhas, preencher estimativas) — insumo direto para o ticket de posicionamento e o de arquitetura.

## Answer

Findings completos: [research/superficie-azure-devops.md](../research/superficie-azure-devops.md).

**Conclusão central: o MCP oficial (`@azure-devops/mcp`, já instalado, ~90 tools) cobre o loop de refinamento inteiro dentro do tracker, sem REST direta** — a alternativa "sem UI própria" do ticket de posicionamento é tecnicamente viável:

- **Ler US/backlog**: `wit_get_work_item` (com relations), `wit_list_backlog_work_items`, `wit_query_by_wiql` (WIQL livre), `search_workitem`; contexto de código via `search_code`/`repo_get_file_content`.
- **Perguntas/decisões**: `wit_add_work_item_comment` em Markdown (+ list/update).
- **Quebrar US em tasks**: `wit_add_child_work_items` cria N filhas de uma vez (title, description MD, iterationPath); `wit_work_items_link` para outros links.
- **Estimativas e campos**: `wit_update_work_item(s_batch)` via JSON Patch em `Microsoft.VSTS.Scheduling.StoryPoints|Effort|Size` (varia por processo — descobrir via `wit_get_work_item_type`), além de AcceptanceCriteria/Description/Priority.
- **Sprints**: iterations, itens por iteration, capacity do time. **Wiki**: `wiki_create_or_update_page` (atas/decisões em MD, ETag p/ concorrência).
- **Auth**: MCP local usa Entra ID via browser (ou `az login`/PAT); para bot/serviço, service principal via REST — PAT desencorajado pela Microsoft.
- **Limites**: MCP não tem eventos nem attachments — reagir a mudanças exige service hooks/webhooks via REST (`workitem.created/updated/commented`) ou polling WIQL; Azure DevOps Services only (não on-prem); escritas saem em nome da identidade autenticada; comments REST ainda `-preview` na 7.1.
