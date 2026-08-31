import type { BacklogStory } from "@sprint-griller/ado-client";
import type { RunSummary } from "./types";

/**
 * O lote que o preparo automático pode enfileirar neste ciclo
 * ([ADR 0005](../../../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md)):
 * topo da prioridade do backlog, ainda sem Investigação (o ADO diz, pelos
 * artefatos), no estado de board configurado — `New` por padrão, porque US em
 * `Active`/`Resolved` já está sendo implementada e investigá-la é desperdício
 * de turno. Sprint atual não entra: backlog é de produto, o refinamento
 * acontece antes do planejamento.
 */
export function selectPreparoBatch(
  backlog: readonly BacklogStory[],
  runs: ReadonlyMap<number, RunSummary>,
  config: { readonly limit: number; readonly states: readonly string[] },
): readonly BacklogStory[] {
  const eligibleStates = new Set(config.states);

  return backlog
    .filter(
      (story) =>
        story.refinement === "sem-investigacao" &&
        eligibleStates.has(story.state),
    )
    .filter((story) => shouldEnqueue(story.rev, runs.get(story.id)))
    .slice(0, config.limit);
}

/**
 * A mesma US só volta à fila em duas condições: nunca teve run local, ou a
 * `rev` do backlog é mais nova que a que o último run viu (alguém editou a US
 * depois da análise). Run em andamento ou já na fila é pulado — duas varreduras
 * não iniciam Investigações duplicadas para a mesma versão da US. Um run
 * `falhou` da mesma `rev` também é pulado: sem retry automático em loop
 * ([ADR 0005](../../../../docs/adr/0005-preparo-automatico-antecipa-a-investigacao.md))
 * — a retomada segura é a edição da US ou o disparo do Operador.
 */
export function shouldEnqueue(
  backlogRev: number,
  run: RunSummary | undefined,
): boolean {
  if (run === undefined) return true;
  if (run.status === "aguardando" || run.status === "em-andamento") return false;

  const seenRev = run.storyRev ?? run.queuedRev;
  return seenRev === undefined ? true : backlogRev > seenRev;
}

/**
 * Se o run local mais recente desta US ficou para trás: a `rev` do backlog é
 * maior que a que a análise leu. O Picker sinaliza — decisão de reabrir é da
 * sala, não da ferramenta.
 */
export function isRunStale(
  backlogRev: number,
  run: RunSummary | undefined,
): boolean {
  if (run === undefined) return false;
  const seenRev = run.storyRev ?? run.queuedRev;
  return seenRev !== undefined && backlogRev > seenRev;
}
