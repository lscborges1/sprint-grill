/**
 * Gramática dos marcadores que o Refina grava no Azure DevOps para depois
 * reconhecer os próprios artefatos (ADR 0003 — o ADO é a fonte da verdade).
 *
 * O token `sprint-griller:dump:<dumpId>:<artifact>` nunca vai nu: o Azure
 * DevOps remove comentários HTML (`<!-- -->`) de comments e de descrições —
 * comportamento confirmado ao vivo contra a API em 2026-08-26. A forma que
 * sobrevive à sanitização nas duas superfícies é um code span (`` `token` ``)
 * nos comments em Markdown e um `<code>token</code>` nos campos HTML. A
 * leitura aceita também o comentário HTML legado, para instâncias onde a
 * gravação antiga sobreviveu.
 */

const DUMP_MARKER_PREFIX = "sprint-griller:dump:";

/** Token cru, sem envoltório — só para montar e comparar, nunca para gravar. */
export function dumpMarker(dumpId: string, artifact: string): string {
  return `${DUMP_MARKER_PREFIX}${dumpId}:${artifact}`;
}

/** A forma que sobrevive em comments Markdown: um code span discreto. */
export function codeChip(token: string): string {
  return `\`${token}\``;
}

/** A forma que sobrevive em campos HTML (descrições): um elemento `<code>`. */
export function codeTag(token: string): string {
  return `<code>${token}</code>`;
}

interface DumpMarker {
  readonly dumpId: string;
  readonly artifact: string;
}

export interface DumpAudit {
  readonly dumpId: string;
  readonly openQuestions: number;
}

/** Cria a prova final de que todos os artefatos de um despejo foram publicados. */
export function dumpCompletionMarker(dumpId: string): string {
  return dumpMarker(dumpId, "complete");
}

/**
 * Prova imutável do gate no instante em que o despejo ficou completo. Vive num
 * comment, não na descrição editável da US, para a retro poder datá-la pelo
 * próprio Azure DevOps sem estado paralelo.
 */
export function dumpAuditMarker(dumpId: string, openQuestions: number): string {
  if (!Number.isSafeInteger(openQuestions) || openQuestions < 0) {
    throw new TypeError("openQuestions precisa ser um inteiro não negativo.");
  }
  return dumpMarker(dumpId, `audit:pending:${openQuestions}`);
}

/** Extrai os resultados de gate gravados pela versão atual do despejo. */
export function dumpAudits(texts: readonly string[]): readonly DumpAudit[] {
  return readDumpMarkers(texts).flatMap(({ dumpId, artifact }) => {
    const match = /^audit:pending:(\d+)$/.exec(artifact);
    if (!match?.[1]) return [];
    const openQuestions = Number(match[1]);
    return Number.isSafeInteger(openQuestions) ? [{ dumpId, openQuestions }] : [];
  });
}

/** IDs dos despejos concluídos encontrados nos textos do work item. */
export function completedDumpIds(texts: readonly string[]): readonly string[] {
  return readDumpMarkers(texts)
    .filter((marker) => marker.artifact === "complete")
    .map((marker) => marker.dumpId);
}

/** IDs com artefatos publicados, mas sem a prova final de conclusão. */
export function incompleteDumpIds(texts: readonly string[]): readonly string[] {
  const artifacts = new Map<string, Set<string>>();
  for (const marker of readDumpMarkers(texts)) {
    const seen = artifacts.get(marker.dumpId) ?? new Set<string>();
    seen.add(marker.artifact);
    artifacts.set(marker.dumpId, seen);
  }
  return [...artifacts.entries()]
    .filter(([, kinds]) => !kinds.has("complete"))
    .map(([dumpId]) => dumpId);
}

/**
 * O envoltório em volta de um token, em qualquer forma aceita. Prosa citando o
 * token cru não conta: o valor de `includes` aqui é casar chip, `<code>` e
 * comentário HTML legado com uma comparação só — todo envoltório contém o
 * token inteiro como substring.
 */
export function carriesMarker(text: string, token: string): boolean {
  return text.includes(token);
}

/**
 * Cada alternativa casa a forma certa de abrir e fechar: chip (`` ` ``),
 * `<code>` e o comentário HTML legado. Abertura de um com fechamento de outro
 * não é marcador — só a dupla correta conta.
 */
const WRAPPED_DUMP_MARKER_RE =
  /<!--\s*(sprint-griller:dump:[^\s<>]+?)\s*-->|<code>\s*(sprint-griller:dump:[^\s<>]+?)\s*<\/code>|`\s*(sprint-griller:dump:[^`<>]+?)\s*`/g;

function readDumpMarkers(texts: readonly string[]): readonly DumpMarker[] {
  return texts.flatMap((text) =>
    [...text.matchAll(WRAPPED_DUMP_MARKER_RE)].flatMap((match) => {
      const token = match.slice(1).find((group) => group !== undefined);
      if (token === undefined) return [];
      const rest = token.slice(DUMP_MARKER_PREFIX.length);
      const separator = rest.indexOf(":");
      if (separator <= 0) return [];
      return [{ dumpId: rest.slice(0, separator), artifact: rest.slice(separator + 1) }];
    }),
  );
}
