import { createHash } from "node:crypto";
import { CeremonyError } from "./ceremony-error";
import { signedDumpInputs } from "./dump-state";
import type { SignedDumpInputs } from "./dump-state";
import type { readDossie } from "./dossie";
import type { CeremonyDumpInput } from "./despejo";
import { isCeremonyEstimate } from "./estimate";
import { assertValidStructuredSpecMarkdown } from "./spec";
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
  if (frozenInputs !== undefined && frozenInputs.estimate !== input.estimate) {
    throw new CeremonyError(
      "o despejo já começou com outra estimativa — use a estimativa assinada no retry.",
    );
  }
  if (dossie.dump.status === "completed") return { kind: "completed" };
  if (dossie.refinement.phase !== "pronto-para-publicar") {
    throw new CeremonyError("aprove a Spec e os Tickets antes de publicar.");
  }
  const openAgenda = store.listRefinementItems(dossie.sessionId)
    .filter((item) => item.status !== "resolvido" && item.status !== "fora-de-escopo");
  if (openAgenda.length > 0) {
    throw new CeremonyError("a Agenda precisa estar vazia antes de publicar.");
  }
  if (frozenInputs === undefined && !isCeremonyEstimate(input.estimate)) {
    throw new CeremonyError("a estimativa deve usar a escala Fibonacci da squad.");
  }

  const approved = store.getApprovedArtifacts(dossie.sessionId);
  if (!approved) throw new CeremonyError("as aprovações atuais da Spec e dos Tickets não coincidem.");
  assertValidStructuredSpecMarkdown(approved.spec.markdown);
  const signed = frozenInputs?.markdown ?? approved.spec.markdown;
  const tasksMarkdown = frozenInputs?.tasksMarkdown ?? approved.tickets.markdown;
  const tasks = parseTaskDraft(tasksMarkdown, dossie.story.url);
  const inputs = frozenInputs ?? {
    dumpId: fingerprint(dossie.sessionId, dossie.story.id, signed, tasks, input.estimate),
    markdown: signed,
    tasksMarkdown,
    estimate: input.estimate,
  };

  assertValidStructuredSpecMarkdown(inputs.markdown);
  store.beginDump(dossie.sessionId, inputs);
  return {
    kind: "publish",
    publication: {
      sessionId: dossie.sessionId,
      storyId: dossie.story.id,
      decisions: dossie.decisions,
      pendingCount: 0,
      inputs,
      tasks,
    },
  };
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
