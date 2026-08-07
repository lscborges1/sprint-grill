import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { RepoConfig } from "@sprint-griller/core";
import type { Citation, Impact } from "./report";

export type ViolationReason =
  | "repo-fora-do-config"
  | "caminho-fora-do-repo"
  | "caminho-inexistente"
  | "arquivo-ilegivel"
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
 * A checagem mecânica (não-LLM) que decide se uma afirmação vale: cada uma é
 * ancorada num arquivo que existe de verdade num repo do config. Uma citação
 * furada reprova o conjunto inteiro — texto que cita caminho inventado não é
 * "quase certo", é ruído com cara de fato.
 *
 * Não julga conteúdo: só confere que a evidência existe onde o agente disse.
 *
 * Vale para o relatório da Investigação e para a resposta de uma Consulta ao
 * vivo na cerimônia: as duas são afirmação + citações, e a regra é a mesma.
 */
export function verifyGrounding(
  claims: readonly Impact[],
  repos: readonly RepoConfig[],
): GroundingResult {
  const roots = new Map(repos.map((repo) => [repo.name, repo.path]));

  const violations = claims.flatMap((impact) =>
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

  if (citation.symbol === undefined) return undefined;

  const contents = read(file);
  if (contents === undefined) {
    return {
      reason: "arquivo-ilegivel",
      detail:
        `${citation.repo}: não foi possível ler "${citation.path}" para conferir ` +
        `"${citation.symbol}". Confira as permissões do checkout local.`,
    };
  }

  if (!contents.includes(citation.symbol)) {
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
 * `undefined` é "não deu para ler", não "não achei": tratar os dois como o
 * mesmo diria ao Operador que o agente inventou um símbolo quando o problema
 * era permissão do arquivo.
 */
function read(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
