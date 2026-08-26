# Speaker notes — Pitch Refina

Tempo alvo: 10–15 minutos. Fale como experimento de engenharia, não como venda de IA.

## 01 — A US está realmente pronta? (~1 min)

“Quero começar com uma pergunta simples: essa US está realmente pronta para entrar na sprint? Muitas vezes ela parece pronta. Ela passou pelo refinamento, tem aceite, ninguém levantou grande objeção. Mas isso não significa que todas as incertezas apareceram.”

“Algumas dúvidas só surgem quando alguém abre o código, procura onde a regra vive, vê integrações e descobre comportamento existente.”

## 02 — O problema aparece tarde (~1,5 min)

“Hoje o fluxo típico é: US, refinamento, sprint. Aí o dev começa a implementação e começa uma investigação mais profunda. Nesse momento aparecem gaps, dependências, regras implícitas e perguntas que não estavam na conversa.”

“Não estou culpando o refinamento nem a squad. O problema é estrutural: existem perguntas que dependem de investigação técnica, e essa investigação normalmente começa tarde.”

## 03 — O custo não é só atraso (~1 min)

“Quando a descoberta aparece tarde, o custo não é só um card bloqueado. A squad interrompe contexto, volta a discutir escopo, descobre dependência, reestima, às vezes quebra previsibilidade.”

“Não vou inventar números da ONR. O ponto aqui é qualitativo: descoberta tardia gera coordenação tardia.”

## 04 — E se investigássemos antes? (~1 min)

“A pergunta do Refina é: e se parte dessa investigação acontecesse antes da sprint?”

“Não toda investigação. Não implementação antecipada. Só a parte que ajuda o refinamento: o que o código já revela, onde pode ter impacto, que decisão ainda está faltando.”

## 05 — Refina (~1 min)

“Refina é uma camada entre a User Story e o refinamento/implementação. A frase é: Refina — descubra antes de construir.”

“Ele pega uma US, olha os repos configurados da squad, levanta gaps, impactos técnicos citados, hipóteses não verificadas e suspeitas de dependência fora do escopo. Depois isso vira insumo para a sala decidir.”

## 06 — Como funciona hoje (~2 min)

“O protótipo hoje é uma aplicação local. O Azure DevOps continua sendo a fonte da verdade. O Picker lê as US e mostra status de refinamento por marcadores publicados no próprio ADO.”

“Quando o Operador clica em Investigar, o Refina busca a US, contexto de Wiki e roda um agente via Codex no checkout local. O agente devolve JSON estruturado. Depois o código verifica mecanicamente as citações: repo existe, path existe, símbolo aparece no arquivo. Se não fechar, o relatório fica visível, mas não pode ser publicado como fato.”

“Com uma Investigação aprovada, a sala abre o Palco. A Agenda nasce dos gaps. Fato que o código responde, o agente busca; decisão humana, ele pergunta com recomendação. O Dossiê guarda resoluções, Spec e tickets até o despejo final no ADO.”

## 07 — Demo (~4–5 min)

“Vou usar uma US fictícia para não expor dados confidenciais. Ela parece simples: aplicar cupom de desconto no checkout.”

“No Picker, reparem no funil: sem investigação, investigadas, refinadas. O ponto não é criar dashboard paralelo; é escolher uma US para investigar antes de comprometer a sprint.”

“Na tela de Investigação, o que importa são os gaps: cumulatividade com promoção automática, cupom expirando durante o checkout, auditoria do desconto. Essas são perguntas que poderiam aparecer só quando o dev abrisse cálculo de preço e fluxo assíncrono da UI.”

“Também aparece impacto técnico com citação. E aparece o que não foi verificado, separado. Isso é importante: hipótese não vira fato.”

“No Palco, a sala decide uma pergunta por vez. A recomendação ajuda a não começar do zero, mas a decisão continua humana.”

“No Dossiê, a decisão vira prova revisável, Spec e tickets. Esse é o contexto enriquecido que queremos antes da sprint.”

## 08 — Antes × com Refina (~1 min)

“Sem Refina, muita investigação acontece depois da entrada na sprint. Com Refina, tentamos puxar descoberta para antes: investigação, refinamento, decisão, sprint.”

“Não estou dizendo que isso elimina bloqueios. Estou dizendo que queremos mover parte da descoberta para a esquerda.”

## 09 — Proposta de experimento (~1,5 min)

“O próximo passo não é vender como solução pronta. É piloto.”

“Escolhemos algumas US reais de uma próxima sprint, passamos pelo Refina antes do refinamento e avaliamos: quais perguntas ele levantou, quais gaps eram relevantes, quais dependências foram antecipadas, o que foi ruído, e quais problemas provavelmente só apareceriam durante implementação.”

“O principal indicador não é volume de achados. É qualidade dos achados.”

## 10 — Pergunta final (~30s)

“A pergunta final do piloto é: o Refina consegue antecipar descobertas que hoje fazemos tarde demais?”

“Se sim, ele vira uma etapa leve de preparação. Se não, aprendemos rápido, sem mudar o processo inteiro.”
