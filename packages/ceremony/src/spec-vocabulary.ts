import { REPORT_SECTIONS } from "@sprint-griller/investigation/vocabulary";

/**
 * O vocabulário da Spec da US, em um lugar só: o Markdown do despejo e o
 * documento vivo na tela dizem as mesmas palavras porque leem daqui — duas
 * cópias divergem no primeiro ajuste de texto, e aí a tela e o artefato
 * discordam. Mesma disciplina do `REPORT_SECTIONS` da Investigação, de onde as
 * seções herdadas vêm por import, não por cópia.
 *
 * Mora fora do barril, com o `session-state`: o Dossiê é uma tela ao vivo, e
 * uma tela do browser não pode arrastar o store (SQLite nativo) junto.
 */
export const SPEC_SECTIONS = {
  decisions: {
    heading: "Decisões",
    blurb: "O que a sala decidiu, com quem decidiu e quando.",
    empty: "Nenhuma decisão registrada nesta cerimônia.",
  },
  impact: {
    heading: "Contexto de impacto",
    blurb: "Herdado da Investigação, com as citações que passaram na checagem mecânica.",
    empty: "A Investigação não ancorou impacto no código.",
  },
  unverified: {
    heading: REPORT_SECTIONS.unverified.heading,
    blurb: REPORT_SECTIONS.unverified.blurb,
    empty: REPORT_SECTIONS.unverified.empty,
  },
  pending: {
    heading: "Pendências",
    blurb: "Perguntas que a sala não respondeu. Entram na sprint como dúvida aberta.",
    empty: "Nenhuma pergunta ficou sem resposta.",
  },
  outOfScope: {
    heading: "Fora de escopo",
    blurb: "O que esta US não vai fazer — escreva aqui antes de despejar.",
    empty: "Nada declarado fora de escopo.",
  },
} as const;

export const SPEC_BLURB =
  "Produzido no grilling coletivo. As decisões abaixo têm quem decidiu e quando.";
