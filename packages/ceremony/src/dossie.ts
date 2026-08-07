import { REPORT_SECTIONS } from "@sprint-griller/investigation";
import { renderSpecMarkdown } from "./spec";
import type { CeremonyStore } from "./store";
import type { DossieDocument, DossieState } from "./types";

/**
 * O Dossiê: a aba do Operador, montada do que está gravado — mesma disciplina do
 * Palco. Nada aqui vem de memória do processo, então a edição e o documento
 * voltam iguais depois de um F5 ou de um restart.
 *
 * A sala não vê esta superfície: o Palco é o que fica projetado, e o preview do
 * despejo é trabalho de revisão, não de sala.
 */
export function readDossie(store: CeremonyStore, sessionId: string): DossieState | undefined {
  const session = store.getSession(sessionId);
  if (!session) return undefined;

  const document: DossieDocument = {
    story: { id: session.storyId, title: session.storyTitle, url: session.storyUrl },
    decisions: store.listDecisions(sessionId),
    pending: store.unansweredQuestions(sessionId).map((asked) => asked.question),
    investigation: {
      impact: sectionOf(session.investigationMarkdown, REPORT_SECTIONS.impacts.heading),
      unverified: sectionOf(session.investigationMarkdown, REPORT_SECTIONS.unverified.heading),
    },
  };

  return {
    ...document,
    sessionId,
    spec: {
      generated: renderSpecMarkdown(document),
      draft: store.getSpecDraft(sessionId) ?? null,
    },
  };
}

/**
 * O trecho da Investigação sob um heading. Recortar por título é exato aqui, e
 * não heurística: o Markdown da Investigação foi renderizado por código
 * ([ADR 0002](../../../docs/adr/0002-escrita-no-ado-e-deterministica.md)), com
 * estes mesmos headings — que vêm do `REPORT_SECTIONS`, não de uma cópia.
 *
 * Markdown de outro formato (uma sessão antiga, um relatório colado à mão) sai
 * como seção vazia: a Spec mostra o vazio em vez de inventar contexto.
 */
function sectionOf(markdown: string, heading: string): string {
  const opening = `\n## ${heading}\n`;
  const start = markdown.indexOf(opening);
  if (start === -1) return "";

  const body = markdown.slice(start + opening.length);
  const end = body.indexOf("\n## ");
  return (end === -1 ? body : body.slice(0, end)).trim();
}
