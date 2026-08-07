import type { Citation } from "./report";

/**
 * O vocabulário do relatório, em um lugar só: o Markdown publicado e o preview
 * na tela dizem as mesmas palavras porque leem daqui. Duas cópias dessas frases
 * divergem no primeiro ajuste de texto, e aí o artefato e a tela discordam.
 */
export const REPORT_SECTIONS = {
  gaps: {
    heading: "Furos da US",
    empty: "Nenhum furo aberto.",
  },
  impacts: {
    heading: "Impacto mapeado",
    verified: "Toda afirmação abaixo passou pela checagem mecânica de citações.",
    rejected: "Estas afirmações não passaram na checagem de citações — leia como rascunho.",
    empty: "Nenhum impacto ancorado no código.",
  },
  externalRepos: {
    heading: "Impacto suspeito fora do config",
    blurb: "Repos que não estão na config da squad — ninguém leu o código deles.",
    empty: "Nenhum.",
  },
  unverified: {
    heading: "Não verificado",
    blurb: "Hipóteses que o agente não conseguiu ancorar no código. Não são fato.",
    empty: "Nada ficou sem âncora.",
  },
} as const;

export const REJECTED_HEADING = "Relatório reprovado na checagem de citações";

export const REJECTED_BLURB =
  "Citação que não fecha com o código é ruído com cara de fato. " +
  "Nada disto vai para o Azure DevOps — redispare a Investigação.";

/**
 * O rótulo do preview do Markdown, indexado pelo veredito: só o relatório
 * aprovado vira comment no ADO. Mora ao lado do REJECTED_BLURB porque é a mesma
 * afirmação — e uma tela que promete publicação logo abaixo do aviso de que
 * nada será publicado é a contradição que este par existe para evitar.
 */
export const MARKDOWN_PREVIEW = {
  aprovado: "Ver o Markdown que vai para o Azure DevOps",
  reprovado: "Ver o Markdown reprovado — este não vai para o Azure DevOps",
} as const;

/** Como uma citação aparece para quem lê, no Markdown e na tela. */
export function formatCitation(citation: Citation): string {
  const anchor = `${citation.repo}:${citation.path}`;
  return citation.symbol === undefined ? anchor : `${anchor} → ${citation.symbol}`;
}
