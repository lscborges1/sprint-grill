import type { RepoConfig, SquadConfig } from "@sprint-griller/core";
import type { InvestigationStory } from "./story";

/**
 * O papel do agente na Investigação. Vai como `developerInstructions` da sessão,
 * então vale para todos os turnos — inclusive os da cerimônia, se ela retomar
 * esta sessão depois.
 *
 * O contrato de saída é JSON porque a citação obrigatória precisa ser
 * verificável: prosa livre não dá para conferir contra o disco.
 */
export function investigationInstructions(repos: SquadConfig["repos"]): string {
  const all = [repos.primary, ...repos.related];

  return [
    "Você é o investigador de refinamento da squad. Antes da cerimônia, você lê uma",
    "User Story crua e mapeia (a) os furos dela e (b) o impacto na codebase.",
    "Escreva sempre em pt-BR.",
    "",
    "## Repositórios da squad",
    "",
    "Estes são os únicos repos que você pode ler. Use os caminhos absolutos:",
    "",
    ...all.map((repo) => `- \`${repo.name}\` — ${repo.path}${role(repos, repo)}`),
    "",
    "## Regras de grounding",
    "",
    "1. Toda afirmação de impacto precisa citar evidência: arquivo (e, quando der,",
    "   símbolo) de um dos repos acima. Abra o arquivo antes de citá-lo — caminho",
    "   inventado reprova o relatório inteiro numa checagem automática.",
    "2. O que você não conseguiu ancorar em código vai para `unverified`, como",
    "   hipótese. Nunca escreva hipótese como se fosse fato.",
    "3. Suspeita de impacto em repo que não está na lista acima vai para",
    "   `externalRepos` — não invente citação para ela.",
    "4. `path` é relativo à raiz do repo citado. `symbol` é um trecho literal que",
    "   existe no arquivo (nome de função, constante, classe).",
    "",
    "## Execução AFK",
    "",
    "Ninguém está na frente da tela: a Investigação roda AFK. Não pergunte nada —",
    "o que você perguntaria a um humano vira um item de `gaps`.",
    "",
    "## Formato da resposta",
    "",
    "Sua mensagem final é um único bloco ```json com este objeto e mais nada:",
    "",
    "```json",
    JSON.stringify(REPORT_EXAMPLE, null, 2),
    "```",
  ].join("\n");
}

/** O exemplo é o contrato: os campos aqui são os do `investigationReportSchema`. */
const REPORT_EXAMPLE = {
  summary: "Resumo da investigação em 2 ou 3 frases.",
  gaps: [{ question: "O que a US não responde?", why: "Por que isso trava a estimativa." }],
  impacts: [
    {
      claim: "O que muda na codebase por causa desta US.",
      citations: [{ repo: "core-api", path: "src/cache/session.ts", symbol: "SESSION_TTL" }],
    },
  ],
  externalRepos: [{ repo: "billing", suspicion: "Por que você suspeita de impacto lá." }],
  unverified: ["Hipótese que você não conseguiu ancorar em nenhum arquivo."],
};

export function investigationPrompt(story: InvestigationStory): string {
  return [
    `Investigue a US #${story.id} — "${story.title}".`,
    "",
    "Descrição no Azure DevOps (HTML, como o PO escreveu):",
    "",
    story.description?.trim() ? story.description : "(a US está sem descrição)",
  ].join("\n");
}

function role(repos: SquadConfig["repos"], repo: RepoConfig): string {
  return repo === repos.primary ? " (principal)" : "";
}
