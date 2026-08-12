const DUMP_MARKER_PREFIX = "<!-- sprint-griller:dump:";
const DUMP_MARKER_SUFFIX = " -->";
const DUMP_MARKER_RE = /<!-- sprint-griller:dump:([^:]+):([^ ]+) -->/g;

interface DumpMarker {
  readonly dumpId: string;
  readonly artifact: string;
}

/** Cria um marcador determinístico para um artefato publicado no despejo. */
export function dumpMarker(dumpId: string, artifact: string): string {
  return `${DUMP_MARKER_PREFIX}${dumpId}:${artifact}${DUMP_MARKER_SUFFIX}`;
}

/** Cria a prova final de que todos os artefatos de um despejo foram publicados. */
export function dumpCompletionMarker(dumpId: string): string {
  return dumpMarker(dumpId, "complete");
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

function readDumpMarkers(texts: readonly string[]): readonly DumpMarker[] {
  return texts.flatMap((text) =>
    [...text.matchAll(DUMP_MARKER_RE)].flatMap((match) => {
      const [dumpId, artifact] = [match[1], match[2]];
      return dumpId === undefined || artifact === undefined ? [] : [{ dumpId, artifact }];
    }),
  );
}
