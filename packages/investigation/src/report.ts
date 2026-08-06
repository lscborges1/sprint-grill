import { z } from "zod";

/**
 * Evidência de uma afirmação: um arquivo de um repo do config e, quando dá,
 * o símbolo dentro dele. É exatamente o que a checagem mecânica confere contra
 * o disco antes do relatório valer alguma coisa (ver `grounding`).
 */
export const citationSchema = z.object({
  repo: z.string().min(1, "informe o nome do repo, como está na config da squad"),
  path: z.string().min(1, "informe o caminho do arquivo relativo à raiz do repo"),
  symbol: z.string().min(1).optional(),
});

export type Citation = z.infer<typeof citationSchema>;

/**
 * O relatório como o agente o entrega: dado estruturado, não prosa. O Markdown
 * é renderizado por nós (ADR 0002 — o LLM redige, o código determinístico
 * formata e grava), e é a estrutura que torna a citação obrigatória verificável.
 */
export const investigationReportSchema = z.object({
  summary: z.string().min(1, "escreva o resumo da investigação"),
  gaps: z
    .array(
      z.object({
        question: z.string().min(1),
        why: z.string().min(1),
      }),
    )
    .default([]),
  impacts: z
    .array(
      z.object({
        claim: z.string().min(1),
        citations: z
          .array(citationSchema)
          .min(1, "toda afirmação de impacto precisa de ao menos uma citação"),
      }),
    )
    .default([]),
  /** Impacto suspeito em repo que não está na config — o agente não pode conferir. */
  externalRepos: z
    .array(
      z.object({
        repo: z.string().min(1),
        suspicion: z.string().min(1),
      }),
    )
    .default([]),
  /** O que o agente não conseguiu ancorar. Hipótese, nunca fato. */
  unverified: z.array(z.string().min(1)).default([]),
});

export type InvestigationReport = z.infer<typeof investigationReportSchema>;
export type Impact = InvestigationReport["impacts"][number];

/**
 * Relatório ilegível é resultado esperado (o modelo escorregou), não exceção:
 * vira uma Investigação falha que o Operador relê e redispara.
 */
export type ParsedReport =
  | { readonly ok: true; readonly report: InvestigationReport }
  | { readonly ok: false; readonly message: string };

const FENCE = /```(?:json)?\s*\r?\n([\s\S]*?)```/g;

/**
 * Lê o relatório da última mensagem do agente. O contrato pedido é um único
 * bloco ```json, mas modelo põe prosa em volta e às vezes mostra um rascunho
 * antes — por isso o último bloco vence, e o texto cru é o último recurso.
 */
export function parseReport(text: string): ParsedReport {
  const candidate = firstJsonCandidate(text);
  if (candidate === undefined) {
    return {
      ok: false,
      message:
        "O agente terminou sem devolver o relatório em JSON. " +
        "Redispare a Investigação — nada foi publicado.",
    };
  }

  const parsed = investigationReportSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: `O relatório do agente não segue o contrato:\n${z.prettifyError(parsed.error)}`,
    };
  }

  return { ok: true, report: parsed.data };
}

/** Blocos cercados do mais recente para o mais antigo; o texto inteiro por último. */
function firstJsonCandidate(text: string): unknown {
  const fences = [...text.matchAll(FENCE)].map((match) => match[1] ?? "").reverse();

  for (const source of [...fences, text]) {
    const parsed = tryJson(source);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function tryJson(source: string): unknown {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
