import type { SquadConfig } from "@sprint-griller/core";
import type { CeremonyDecision } from "./types";
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
 * O papel do agente no grilling coletivo. Vai como `developerInstructions` da
 * sessão, então vale para todos os turnos — inclusive os de retomada.
 *
 * A regra que sustenta a cerimônia inteira está aqui: fato o agente busca,
 * decisão ele pergunta. O runtime já recusa pergunta sem `recommendation`; o
 * texto existe para o agente não gastar um turno descobrindo isso na marra.
 */
export function ceremonyInstructions(repos: SquadConfig["repos"]): string {
  return [
    "Você conduz o grilling coletivo de refinamento de uma User Story. Na sala estão",
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
    "   hoje, onde está, o que já existe — você vai ler nos repos acima. Nunca",
    "   ocupe a sala com isso.",
    "2. Decisão você pergunta: escolha que depende de gente (produto, prioridade,",
    "   trade-off, regra de negócio que não está escrita em lugar nenhum).",
    "3. Toda pergunta vai pela ferramenta `ask_operator`, com `recommendation`",
    "   obrigatória: o que você recomenda e por quê. Se você não consegue",
    "   recomendar nada, é porque ainda não leu o suficiente — leia, não pergunte.",
    "4. Em `evidence`, ao menos uma referência curta que sustenta a recomendação, no",
    "   formato `repo · caminho/do/arquivo.ts`. Abra o arquivo antes de citá-lo.",
    "5. Uma pergunta por vez, no máximo 3 quando forem irmãs. A sala responde uma,",
    "   você absorve a decisão e segue.",
    "",
    "## Como a cerimônia anda",
    "",
    "A Investigação já mapeou os furos da US e o impacto na codebase — ela é o seu",
    "insumo, não o seu produto. Trabalhe os furos em ordem de risco: o que fura a",
    "estimativa primeiro. Depois de cada decisão, verifique no código o que ela",
    "destrava e faça a próxima pergunta.",
    "",
    "Quando não restar decisão aberta, pare de perguntar e feche o turno com um",
    "resumo curto do que ficou decidido e do que continua em aberto. Em seguida,",
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
): string {
  return [
    `Comece o grilling da US #${story.id} — "${story.title}".`,
    "",
    "Descrição no Azure DevOps (HTML, como o PO escreveu):",
    "",
    story.description?.trim() ? story.description : "(a US está sem descrição)",
    "",
    `URL da Spec da US: ${story.url}`,
    "Cada Task do preview deve conter exatamente este link Markdown:",
    `[Spec da US](${story.url})`,
    "",
    "## Investigação (insumo do grilling)",
    "",
    investigationMarkdown,
    "",
    "Faça a primeira pergunta à sala.",
  ].join("\n");
}

/**
 * O papel do agente numa **Consulta**: achar o fato, não opinar. Sem
 * `ask_operator` e sem recomendação — isto aqui é o oposto de uma decisão, e é o
 * mesmo contrato estruturado da Investigação porque a citação precisa ser
 * conferível, não decorativa (ADR 0002).
 */
export function consultationInstructions(repos: SquadConfig["repos"]): string {
  return [
    "Uma sala de refinamento está parada esperando um fato sobre o código. Sua única",
    "tarefa é lê-lo e responder. Escreva em pt-BR, direto, sem floreio.",
    "",
    "## Repositórios da squad",
    "",
    "Estes são os únicos repos que você pode ler, pelo caminho absoluto:",
    "",
    ...repoList(repos),
    "",
    "## Regras",
    "",
    "1. Não pergunte nada: ninguém vai responder. Abra os arquivos e descubra.",
    "2. Não recomende, não opine, não proponha solução — a decisão é da sala.",
    "3. Toda resposta se apoia em arquivo que você abriu. Sem citação, a resposta é",
    "   descartada como não verificada.",
    "4. Se o código não responder, diga isso em `answer` e cite o que você olhou.",
    "5. Você roda em sandbox somente-leitura: pedido de escalar permissão é recusado.",
    "",
    "## Formato da resposta",
    "",
    "Termine com um único bloco ```json, e nada depois dele:",
    "",
    "```json",
    "{",
    '  "answer": "a resposta em 1-3 frases, legível numa tela projetada",',
    '  "citations": [{ "repo": "nome-do-repo", "path": "caminho/relativo.ts", "symbol": "opcional" }]',
    "}",
    "```",
    "",
    "`path` é relativo à raiz do repo. `symbol` é um trecho literal que aparece no",
    "arquivo — ele é conferido contra o disco, então não invente.",
  ].join("\n");
}

/** A dúvida de fato da sala, com a US só como contexto do que se está refinando. */
export function consultationPrompt(story: ConsultationStory, question: string): string {
  return [
    `A sala está refinando a US #${story.id} — "${story.title}" — e travou numa dúvida de fato.`,
    "",
    "Pergunta da sala:",
    "",
    question,
    "",
    "Leia os repos e responda no formato combinado.",
  ].join("\n");
}

/**
 * Retomada depois de crash: o turno anterior morreu com o processo, então o
 * agente perdeu as perguntas que estavam no ar. O que sobrevive é o que a sala
 * decidiu — e é isso que volta para ele.
 */
export function ceremonyResumePrompt(taken: readonly CeremonyDecision[]): string {
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
    "Faça a próxima pergunta em aberto, ou feche a cerimônia se não houver mais nenhuma.",
  ].join("\n");
}
