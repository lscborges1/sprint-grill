# README público, imagens e licença — Design

**Data:** 2026-08-20
**Status:** aprovado para planejamento

## Objetivo

Preparar a página inicial do repositório para visitantes técnicos, novas pessoas
da squad e stakeholders. O README deve explicar em poucos segundos o problema
resolvido pelo Refina, comprovar a experiência com imagens reais e preservar a
documentação operacional existente. O repositório também deve declarar uma
licença open source permissiva e não expor vínculos com cliente, empresa atual ou
identificadores pessoais.

## Abordagens consideradas

### A. Narrativa híbrida — escolhida

Combina uma explicação curta do problema, um diagrama vetorial do fluxo e três
screenshots reais. Equilibra compreensão conceitual, prova do produto e custo de
manutenção.

### B. Galeria do produto

Prioriza screenshots e legendas. Produz mais impacto visual, mas explica menos o
raciocínio do produto e envelhece mais rápido quando a interface muda.

### C. Infográfico conceitual

Usa somente diagramas, sem telas reais. É mais estável, porém não comprova a
experiência implementada.

## Estrutura do README

O topo do README seguirá uma leitura em camadas:

1. Título, descrição de uma linha e badges essenciais, incluindo MIT e Node 22+.
2. Seção curta sobre o problema: User Stories chegam cruas ao refinamento e
   dependências aparecem tarde.
3. Seção "Como funciona" com um SVG de quatro etapas:
   **Investigar → Refinar → Revisar → Publicar**.
4. Seção "O produto em três momentos" com screenshots do Picker, do Palco e do
   Dossiê, cada um com legenda e texto alternativo descritivo.
5. Setup, comandos, arquitetura e detalhes operacionais existentes,
   reorganizados quando necessário, sem descartar conteúdo útil.

O texto só afirmará comportamentos implementados. Não haverá roadmap,
promessas futuras ou ilustrações decorativas geradas por IA.

## Assets visuais

Os arquivos ficarão em `docs/assets/readme/`:

- `workflow.svg`: diagrama curto, legível nos temas claro e escuro do GitHub;
- `picker.png`: seleção de User Stories e seus status de refinamento;
- `palco.png`: condução coletiva de uma pergunta ou decisão por vez;
- `dossie.png`: revisão da Spec, dos Tickets e dos gates de publicação.

Os screenshots serão capturados da interface real usando somente fixtures
fictícias da rota de desenvolvimento `/dev-ui?view=picker|palco|dossie`, com
viewport e tema fixos para que a captura seja reproduzível. Nenhum asset mostrará
organização, projeto, repositório, User Story, nome de pessoa, domínio ou URL
reais. As imagens serão recortadas em proporções legíveis no GitHub e revisadas
visualmente antes de serem versionadas.

## Higienização para publicação

A auditoria cobre todos os arquivos rastreados na árvore Git atual:

- buscar nomes próprios, e-mails, domínios, URLs, organizações do Azure DevOps e
  caminhos locais identificáveis;
- generalizar caminhos pessoais encontrados em documentos rastreados;
- não acessar nem imprimir credenciais ou configurações locais ignoradas;
- preservar placeholders explicitamente fictícios, como `acme`, e usos
  conceituais de palavras como "cliente", pois eles não identificam uma empresa;
- executar uma segunda varredura após as alterações e inspecionar manualmente os
  assets finais.

O histórico Git não será reescrito. Uma eventual limpeza de commits antigos é
uma operação separada e destrutiva, fora deste escopo.

## Licença

Adicionar `LICENSE` com o texto padrão da licença MIT e a atribuição:

```text
Copyright (c) 2026 Refina contributors
```

O README apontará para a licença. O campo `private` do `package.json` permanece:
ele impede publicação acidental no registro npm e não contradiz a licença do
repositório.

## Verificação

- confirmar que todos os caminhos de imagens do README existem;
- validar o SVG e abrir cada PNG para revisão visual;
- verificar que o Markdown mantém hierarquia e links válidos;
- repetir a auditoria de identificadores em arquivos rastreados;
- inspecionar metadados dos PNGs para impedir que caminhos, software local ou
  outros dados não visíveis sejam publicados;
- executar `pnpm check` para garantir que a higienização não alterou contratos
  ou fixtures de forma incompatível;
- conferir `git status` para incluir todos os arquivos novos esperados e nenhum
  artefato de trabalho;
- revisar `git diff origin/master...` antes da entrega.

## Fora de escopo

- reescrever o histórico Git;
- publicar pacote no npm;
- criar site, documentação externa ou material de marketing separado;
- mudar comportamento ou arquitetura do produto;
- adicionar dependências para gerar ou validar a documentação.
