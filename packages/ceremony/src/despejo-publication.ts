import { createHash } from "node:crypto";
import { CeremonyError } from "./ceremony-error";
import {
  findSignedDumpInputConflict,
  signedDumpInputs,
} from "./dump-state";
import type { SignedDumpInputs } from "./dump-state";
import type { readDossie } from "./dossie";
import type { CeremonyDumpInput } from "./despejo";
import { isCeremonyEstimate } from "./estimate";
import {
  assertValidSpecMarkdown,
  stripDecisionRecordLinks,
} from "./spec";
import type { CeremonyStore } from "./store";
import { parseTaskDraft } from "./task-draft";

type Dossie = NonNullable<ReturnType<typeof readDossie>>;

export interface PreparedPublication {
  readonly sessionId: string;
  readonly storyId: number;
  readonly decisions: Dossie["decisions"];
  readonly pendingCount: number;
  readonly inputs: SignedDumpInputs;
  readonly tasks: ReturnType<typeof parseTaskDraft>;
}

export type DumpPreparation =
  | { readonly kind: "completed" }
  | { readonly kind: "publish"; readonly publication: PreparedPublication };

export function reservePublication(
  store: CeremonyStore,
  dossie: Dossie,
  input: CeremonyDumpInput,
): DumpPreparation {
  const frozenInputs = signedDumpInputs(dossie.dump);
  if (frozenInputs !== undefined) assertFrozenInputsMatch(frozenInputs, input);
  if (dossie.dump.status === "completed") return { kind: "completed" };
  if (dossie.status !== "encerrada") {
    throw new CeremonyError("encerre a cerimônia antes de despejar.");
  }

  const signed = frozenInputs?.markdown ?? dossie.spec.draft?.markdown ?? dossie.spec.generated;
  if (input.markdown !== signed) {
    throw new CeremonyError(
      frozenInputs === undefined
        ? "salve a edição do Dossiê antes de despejar."
        : "o despejo já começou com outra Spec — use a Spec assinada no retry.",
    );
  }
  if (
    frozenInputs === undefined &&
    stripDecisionRecordLinks(input.base) !== stripDecisionRecordLinks(dossie.spec.generated)
  ) {
    throw new CeremonyError(
      "a cerimônia andou depois desta edição — regenere ou salve uma Spec atualizada antes de despejar.",
    );
  }
  if (dossie.pending.length > 0 && !input.confirmPending) {
    throw new CeremonyError("confirme que deseja despejar com as pendências abertas.");
  }
  if (frozenInputs === undefined && !isCeremonyEstimate(input.estimate)) {
    throw new CeremonyError("a estimativa deve usar a escala Fibonacci da squad.");
  }

  const tasksMarkdown = frozenInputs?.tasksMarkdown ?? input.tasksMarkdown;
  const tasks = parseTaskDraft(tasksMarkdown, dossie.story.url);
  const inputs = frozenInputs ?? {
    dumpId: fingerprint(dossie.sessionId, dossie.story.id, signed, tasks, input.estimate),
    markdown: signed,
    tasksMarkdown,
    estimate: input.estimate,
  };

  assertValidSpecMarkdown(inputs.markdown, dossie.decisions);
  store.beginDump(dossie.sessionId, inputs);
  return {
    kind: "publish",
    publication: {
      sessionId: dossie.sessionId,
      storyId: dossie.story.id,
      decisions: dossie.decisions,
      pendingCount: dossie.pending.length,
      inputs,
      tasks,
    },
  };
}

function assertFrozenInputsMatch(
  frozen: SignedDumpInputs,
  input: CeremonyDumpInput,
): void {
  switch (findSignedDumpInputConflict(frozen, input)) {
    case "markdown":
      throw new CeremonyError(
        "o despejo já começou com outra Spec — use a Spec assinada no retry.",
      );
    case "estimate":
      throw new CeremonyError(
        "o despejo já começou com outra estimativa — use a estimativa assinada no retry.",
      );
    case "tasksMarkdown":
      throw new CeremonyError(
        "o despejo já começou com outras Tasks assinadas — use as mesmas Tasks no retry.",
      );
    case undefined:
      return;
  }
}

function fingerprint(
  sessionId: string,
  storyId: number,
  markdown: string,
  tasks: readonly ReturnType<typeof parseTaskDraft>[number][],
  estimate: number,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ sessionId, storyId, markdown, tasks, estimate }))
    .digest("hex");
}
