import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { RepoConfig } from "@sprint-griller/core";
import type { Citation, InvestigationReport } from "./report";

export type ViolationReason =
  | "repo-fora-do-config"
  | "caminho-fora-do-repo"
  | "caminho-inexistente"
  | "simbolo-nao-encontrado";

export interface CitationViolation {
  /** A afirmação que a citação deveria sustentar. */
  readonly claim: string;
  readonly citation: Citation;
  readonly reason: ViolationReason;
  /** Frase pronta para o Operador — diz o que não fechou, com o caminho. */
  readonly detail: string;
}

export type GroundingResult =
  | { readonly status: "aprovado" }
  | {
      readonly status: "reprovado";
      readonly violations: readonly CitationViolation[];
    };

/**
 * A checagem mecânica (não-LLM) que decide se o relatório vale: cada afirmação
 * de impacto é ancorada num arquivo que existe de verdade num repo do config.
 * Uma citação furada reprova o relatório inteiro — um relatório que cita
 * caminho inventado não é "quase certo", é ruído com cara de fato.
 *
 * Não julga conteúdo: só confere que a evidência existe onde o agente disse.
 */
export function verifyGrounding(
  report: InvestigationReport,
  repos: readonly RepoConfig[],
): GroundingResult {
  const roots = new Map(repos.map((repo) => [repo.name, repo.path]));

  const violations = report.impacts.flatMap((impact) =>
    impact.citations.flatMap((citation) => {
      const failure = checkCitation(citation, roots);
      return failure === undefined ? [] : [{ claim: impact.claim, citation, ...failure }];
    }),
  );

  return violations.length === 0
    ? { status: "aprovado" }
    : { status: "reprovado", violations };
}

type CitationFailure = Pick<CitationViolation, "reason" | "detail">;

function checkCitation(
  citation: Citation,
  roots: ReadonlyMap<string, string>,
): CitationFailure | undefined {
  const root = roots.get(citation.repo);
  if (root === undefined) {
    return {
      reason: "repo-fora-do-config",
      detail:
        `o repo "${citation.repo}" não está na config da squad, então a evidência ` +
        `não pôde ser conferida. Impacto fora do config vai para a seção de suspeitas.`,
    };
  }

  const file = path.resolve(root, citation.path);
  if (!isInside(root, file)) {
    return {
      reason: "caminho-fora-do-repo",
      detail: `"${citation.path}" aponta para fora do repo ${citation.repo}.`,
    };
  }

  if (!isFile(file)) {
    return {
      reason: "caminho-inexistente",
      detail: `${citation.repo}: o arquivo "${citation.path}" não existe.`,
    };
  }

  if (citation.symbol !== undefined && !contains(file, citation.symbol)) {
    return {
      reason: "simbolo-nao-encontrado",
      detail:
        `${citation.repo}: "${citation.symbol}" não aparece em "${citation.path}".`,
    };
  }

  return undefined;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/** Caminho inexistente, diretório ou sem permissão: nenhum ancora nada. */
function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Símbolo é conferido como texto literal, não parseado: serve para qualquer
 * linguagem dos repos da squad e é o suficiente para pegar nome inventado.
 */
function contains(file: string, symbol: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(symbol);
  } catch {
    return false;
  }
}
