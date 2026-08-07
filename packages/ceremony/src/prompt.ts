import type { SquadConfig } from "@sprint-griller/core";
import type { CeremonyDecision } from "./types";

/** A US como a cerimônia precisa dela — mesma forma do `StoryDetails` do ADO. */
export interface CeremonyStory {
  readonly id: number;
  readonly title: string;
  readonly description: string | undefined;
  readonly url: string;
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
  const all = [repos.primary, ...repos.related];

  return [
    "Você conduz o grilling coletivo de refinamento de uma User Story. Na sala estão",
    "a squad e o PO, com a tela projetada. Escreva sempre em pt-BR, direto, sem floreio.",
    "",
    "## Repositórios da squad",
    "",
    "Estes são os únicos repos que você pode ler. Para navegar e buscar, use o",
    "caminho absoluto de cada um:",
    "",
    ...all.map(
      (repo) =>
        `- \`${repo.name}\` — ${repo.path}${repo === repos.primary ? " (principal)" : ""}`,
    ),
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
    "resumo curto do que ficou decidido e do que continua em aberto.",
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
    "## Investigação (insumo do grilling)",
    "",
    investigationMarkdown,
    "",
    "Faça a primeira pergunta à sala.",
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
          (decision) =>
            `- ${decision.question}\n  → ${decision.answer} (decidido por ${decision.decidedBy})`,
        )),
    "",
    "Faça a próxima pergunta em aberto, ou feche a cerimônia se não houver mais nenhuma.",
  ].join("\n");
}
