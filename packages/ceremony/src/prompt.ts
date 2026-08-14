import type { SquadConfig } from "@sprint-griller/core";
import type { CeremonyDecision } from "./types";
import type { RefinementItem, SeedRefinementItemInput } from "./types";
import { TASK_DRAFT_END, TASK_DRAFT_START } from "./task-draft";

/** A US como a cerimônia precisa dela — mesma forma do `StoryDetails` do ADO. */
export interface CeremonyStory {
  readonly id: number;
  readonly title: string;
  readonly description: string | undefined;
  readonly url: string;
}

/** A US como a Consulta precisa dela: só para o agente saber do que se trata. */
export interface ConsultationStory {
  readonly id: number;
  readonly title: string;
}

/** Os repos da squad como o agente os enxerga: nome e caminho absoluto. */
function repoList(repos: SquadConfig["repos"]): string[] {
  return [repos.primary, ...repos.related].map(
    (repo) => `- \`${repo.name}\` — ${repo.path}${repo === repos.primary ? " (principal)" : ""}`,
  );
}

/**
 * O papel do agente no Refinamento coletivo. Vai como `developerInstructions` da
 * sessão, então vale para todos os turnos — inclusive os de retomada.
 *
 * A regra que sustenta a cerimônia inteira está aqui: fato o agente busca,
 * decisão ele pergunta. O runtime já recusa pergunta sem `recommendation`; o
 * texto existe para o agente não gastar um turno descobrindo isso na marra.
 */
export function ceremonyInstructions(repos: SquadConfig["repos"]): string {
  return [
    "Você conduz o Refinamento coletivo de uma User Story. Na sala estão",
    "a squad e o PO, com a tela projetada. Escreva sempre em pt-BR, direto, sem floreio.",
    "",
    "## Repositórios da squad",
    "",
    "Estes são os únicos repos que você pode ler. Para navegar e buscar, use o",
    "caminho absoluto de cada um:",
    "",
    ...repoList(repos),
    "",
    "## O que você pergunta, e o que você não pergunta",
    "",
    "1. Fato você busca: qualquer coisa que o código responde — como algo funciona",
    "   hoje, onde está, o que já existe — você vai ler nos repos acima e resolver",
    "   o item com `resolve_refinement_item`, resposta e citações verificáveis. Nunca",
    "   ocupe a sala com isso. Use a mesma ferramenta com justificativa quando um item",
    "   estiver comprovadamente fora do escopo desta US.",
    "2. Se ao ler o código você descobrir um furo que não está na Agenda, chame",
    "   `add_refinement_item` primeiro. Use o ID devolvido para perguntar à sala com",
    "   `ask_operator` ou resolver o item com `resolve_refinement_item`.",
    "3. Decisão você pergunta: escolha que depende de gente (produto, prioridade,",
    "   trade-off, regra de negócio que não está escrita em lugar nenhum).",
    "4. Toda pergunta vai pela ferramenta `ask_operator`, com `recommendation`",
    "   obrigatória: o que você recomenda e por quê. Se você não consegue",
    "   recomendar nada, é porque ainda não leu o suficiente — leia, não pergunte.",
    "5. Em `evidence`, ao menos uma referência curta que sustenta a recomendação, no",
    "   formato `repo · caminho/do/arquivo.ts`. Abra o arquivo antes de citá-lo.",
    "6. Exatamente uma pergunta por chamada, sempre com o `agendaItemId` informado",
    "   na Agenda persistida. A sala responde, você absorve a decisão e segue.",
    "",
    "## Como a cerimônia anda",
    "",
    "A Investigação já mapeou os furos da US e o impacto na codebase — ela é o seu",
    "insumo, não o seu produto. Trabalhe os furos em ordem de risco: o que fura a",
    "estimativa primeiro. Depois de cada decisão, verifique no código o que ela",
    "destrava e faça a próxima pergunta.",
    "",
    "Quando não restar item aberto, use `propose_refinement_completion` com um",
    "resumo curto. Encerrar o turno nunca conclui a cerimônia. Depois da confirmação",
    "da sala, a etapa seguinte pedirá a Spec estruturada. Em seguida,",
    "redija o preview das Tasks agent-ready dentro destes marcadores, uma por uma",
    "slice vertical autocontida, dimensionada para uma sessão de agente: título em ##,",
    "descrição curta, ### Critérios de aceite com ao menos",
    "um item e, se necessário, ### Bloqueada por com o título de outra Task.",
    "Cada Task precisa conter um link Markdown cujo destino seja exatamente a URL",
    "da Spec da US fornecida no prompt de abertura.",
    TASK_DRAFT_START,
    "## Título da Task",
    "",
    "### Critérios de aceite",
    "",
    "- Critério observável.",
    TASK_DRAFT_END,
    "",
    "Você roda em sandbox somente-leitura: pedido de escalar permissão é recusado.",
  ].join("\n");
}

/** Abre a cerimônia com a Investigação na mesa. */
export function ceremonyOpeningPrompt(
  story: CeremonyStory,
  investigationMarkdown: string,
  agenda: readonly RefinementItem[] = [],
): string {
  return [
    `Comece o Refinamento da US #${story.id} — "${story.title}".`,
    "",
    "Descrição no Azure DevOps (HTML, como o PO escreveu):",
    "",
    story.description?.trim() ? story.description : "(a US está sem descrição)",
    "",
    `URL da Spec da US: ${story.url}`,
    "Cada Task do preview deve conter exatamente este link Markdown:",
    `[Spec da US](${story.url})`,
    "",
    "## Investigação (insumo do Refinamento)",
    "",
    investigationMarkdown,
    "",
    "## Agenda persistida",
    "",
    ...(agenda.length === 0
      ? ["(nenhum item aberto na Investigação)"]
      : agenda.map((item) => `- \`${item.id}\` — ${item.question}`)),
    "",
    "Faça a primeira pergunta à sala.",
  ].join("\n");
}

/** Extrai os furos renderizados pela Investigação para semear a Agenda uma única vez. */
export function investigationAgenda(markdown: string): readonly SeedRefinementItemInput[] {
  const heading = /^## Furos da US\s*$/m.exec(markdown);
  if (!heading) return [];

  const body = markdown.slice(heading.index + heading[0].length);
  const end = /^## /m.exec(body)?.index;
  const section = (end === undefined ? body : body.slice(0, end)).trim();
  if (/^_?Nenhum furo aberto\.?_?$/i.test(section)) return [];

  return section
    .split("\n")
    .map((line) => /^-\s+(?:\*\*)?(.+?)(?:\*\*)?(?:\s+—\s+.*)?$/.exec(line.trim())?.[1]?.trim())
    .filter((question): question is string => question !== undefined && question !== "")
    .map((question, index) => ({ id: `investigacao-${index + 1}`, question }));
}

/**
 * O papel do agente numa **Consulta**: achar o fato, não opinar. Sem
 * `ask_operator` e sem recomendação — isto aqui é o oposto de uma decisão, e é o
 * mesmo contrato estruturado da Investigação porque a citação precisa ser
 * conferível, não decorativa (ADR 0002).
 */
export function consultationInstructions(repos: SquadConfig["repos"]): string {
  return [
    "Uma sala de refinamento trouxe uma dúvida. Sua tarefa é ler o código e classificar",
    "se ele responde ou se resta uma escolha da sala. Escreva em pt-BR, direto, sem floreio.",
    "",
    "## Repositórios da squad",
    "",
    "Estes são os únicos repos que você pode ler, pelo caminho absoluto:",
    "",
    ...repoList(repos),
    "",
    "## Regras",
    "",
    "1. Não use ferramenta de pergunta: esta sessão auxiliar não tem ninguém para responder.",
    "2. Se for fato, não recomende nem opine: responda só o que o código sustenta.",
    "3. Se o código não bastar porque resta uma escolha de produto ou trade-off, classifique",
    "   como escolha da sala e formule uma pergunta com recomendação e evidências.",
    "4. Toda resposta factual se apoia em arquivo que você abriu. Sem citação, a resposta é",
    "   descartada como não verificada.",
    "5. Você roda em sandbox somente-leitura: pedido de escalar permissão é recusado.",
    "",
    "## Formato da resposta",
    "",
    "Termine com um único bloco ```json, e nada depois dele:",
    "",
    "```json",
    "{",
    '  "kind": "fact",',
    '  "answer": "a resposta em 1-3 frases, legível numa tela projetada",',
    '  "citations": [{ "repo": "nome-do-repo", "path": "caminho/relativo.ts", "symbol": "opcional" }]',
    "}",
    "```",
    "",
    "Ou, quando o código não decide:",
    "",
    "```json",
    "{",
    '  "kind": "room-choice",',
    '  "question": "a escolha que a sala precisa fazer",',
    '  "recommendation": "a opção recomendada e por quê",',
    '  "evidence": ["repo · caminho/arquivo.ts"],',
    '  "options": [{ "label": "opção", "description": "efeito da escolha" }],',
    '  "allowFreeText": true',
    "}",
    "```",
    "",
    "`path` é relativo à raiz do repo. `symbol` é um trecho literal que aparece no",
    "arquivo — ele é conferido contra o disco, então não invente.",
  ].join("\n");
}

/** A dúvida da sala, com a US só como contexto do que se está refinando. */
export function consultationPrompt(story: ConsultationStory, question: string): string {
  return [
    `A sala está refinando a US #${story.id} — "${story.title}" — e trouxe uma dúvida.`,
    "",
    "Pergunta da sala:",
    "",
    question,
    "",
    "Leia os repos, classifique a dúvida e responda no formato combinado.",
  ].join("\n");
}

/**
 * Retomada depois de crash: o turno anterior morreu com o processo, então o
 * agente perdeu as perguntas que estavam no ar. O que sobrevive é o que a sala
 * decidiu — e é isso que volta para ele.
 */
export function ceremonyResumePrompt(
  taken: readonly CeremonyDecision[],
  agenda: readonly RefinementItem[] = [],
): string {
  return [
    "A cerimônia foi retomada depois de uma interrupção. Estas são as decisões já",
    "registradas com a sala — não pergunte de novo nada que elas resolvem:",
    "",
    ...(taken.length === 0
      ? ["(nenhuma decisão registrada ainda)"]
      : taken.map(
          (decision) => `- ${decision.question}\n  → ${decision.answer}`,
        )),
    "",
    "Agenda persistida (preserve estes ids):",
    "",
    ...(agenda.length === 0
      ? ["(nenhum item persistido)"]
      : agenda.map((item) => `- \`${item.id}\` [${item.status}] — ${item.question}`)),
    "",
    "Faça a próxima pergunta em aberto; se a Agenda estiver encerrada, use `propose_refinement_completion`.",
  ].join("\n");
}

export function ceremonyContinuationPrompt(): string {
  return [
    "O turno anterior terminou sem uma proposta explícita de conclusão.",
    "Retome a Agenda persistida: resolva o próximo item, faça exatamente uma pergunta",
    "pela `ask_operator`, ou use `propose_refinement_completion` quando todos estiverem encerrados.",
    "Terminar o turno, por si só, não encerra o refinamento.",
  ].join("\n");
}
