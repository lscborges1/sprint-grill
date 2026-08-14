# Seletor de tema claro

## Objetivo

Oferecer em todas as telas as preferências **Claro**, **Escuro** e **Sistema**. A escolha deve sobreviver a recargas no mesmo navegador; para quem nunca escolheu, o app continua acompanhando o tema do sistema operacional.

## Design

- Um controle global, compacto e acessível fica no canto superior direito do layout raiz. Ele usa um `<select>` nativo rotulado como **Tema**, com as opções textuais **Claro**, **Escuro** e **Sistema**; assim, seleção, foco e teclado seguem o contrato do navegador sem interação customizada.
- O contrato persistido é a chave `sprint-griller:theme` com um dos valores `light`, `dark` ou `system`. O módulo de tema define e valida esse contrato e aplica sempre o mesmo valor ao atributo `data-theme` do elemento `<html>`. Ausência, valor desconhecido ou erro de leitura resultam em `data-theme="system"`.
- A preferência é armazenada localmente, sem estado no servidor. O mesmo módulo gera, a partir das constantes do contrato, o script mínimo que valida e aplica a escolha antes da primeira pintura. O layout renderiza inicialmente `data-theme="system"` e suprime apenas o aviso esperado de hidratação desse atributo quando o script encontra outra escolha.
- As cores continuam centralizadas em variáveis semânticas no CSS global. Seletores explícitos atendem **Claro** e **Escuro**; uma media query atende **Sistema**. Os badges deixam de depender da variante `dark:` do Tailwind para também respeitarem a escolha manual.
- Cada modo também define `color-scheme`: claro para **Claro**, escuro para **Escuro** e o valor correspondente à media query para **Sistema**, mantendo controles nativos coerentes com a paleta.
- O controle é o único Client Component novo. O restante do layout e das páginas permanece renderizado no servidor.

## Falhas e limites

- Se a leitura do armazenamento estiver indisponível, o app usa **Sistema**. Se a escrita falhar, o controle ainda aplica a escolha ao DOM e a mantém no estado do componente durante a página atual; apenas a persistência é perdida.
- A preferência não é sincronizada entre navegadores, dispositivos ou usuários, pois o Sprint Griller é executado localmente e não possui conta ou banco de preferências.
- Sincronização entre abas abertas também fica fora do escopo.
- Não serão adicionadas dependências, transições animadas, ícones ou novos temas.

## Verificação

- Testar a validação da preferência para os três valores aceitos, ausência, valor inválido e leitura que lança erro.
- Testar que cada preferência produz o atributo de tema correto, que **Sistema** preserva a media query como fonte da paleta e que uma falha de escrita não impede a aplicação ao DOM.
- Renderizar o controle em teste para confirmar o `<select>` rotulado, as três opções e a seleção inicial; o comportamento de teclado é delegado ao elemento nativo.
- Verificar manualmente seleção por mouse e teclado, persistência após recarga, primeira pintura sem flash, `color-scheme` e atualização das principais telas nos três modos.
- Executar typecheck, lint e a suíte de testes existente.
