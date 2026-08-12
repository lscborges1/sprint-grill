"use client";

import { validateTaskDraft } from "@sprint-griller/ceremony/task-draft";
import type { CeremonyDumpState, DossieState, SignedDumpInputs } from "@sprint-griller/ceremony";
import { useActionState, useState } from "react";
import { dumpCeremonyAction } from "../../actions";
import { DUMP_INITIAL_STATE, type DumpActionState } from "../../spec-draft-action-state";

interface UseDumpGateInput {
  readonly storyUrl: string;
  readonly taskPreview: string;
  readonly dump: DossieState["dump"];
  readonly ceremonyStatus: DossieState["status"];
}

export interface DumpGateController {
  readonly action: (formData: FormData) => void;
  readonly ceremonyClosed: boolean;
  readonly close: () => void;
  readonly dumpCompleted: boolean;
  readonly dumpLocked: boolean;
  readonly dumpPublishing: boolean;
  readonly dumping: boolean;
  readonly estimateDefault: number | undefined;
  readonly open: boolean;
  readonly openGate: () => void;
  readonly result: DumpActionState;
  readonly setTasksMarkdown: (tasksMarkdown: string) => void;
  readonly taskErrors: readonly string[];
  readonly tasksMarkdown: string;
}

export function useDumpGate(
  { storyUrl, taskPreview, dump, ceremonyStatus }: UseDumpGateInput,
): DumpGateController {
  const dumpState = dumpGateState(dump);
  const initialTasksMarkdown = dumpState.inputs?.tasksMarkdown ?? taskPreview;
  const [open, setOpen] = useState(false);
  const [result, action, dumping] = useActionState(dumpCeremonyAction, DUMP_INITIAL_STATE);
  const [tasksMarkdown, setTasksMarkdown] = useState(initialTasksMarkdown);
  const validation = validateTaskDraft(tasksMarkdown, storyUrl);

  return {
    action,
    ceremonyClosed: ceremonyStatus === "encerrada",
    close: () => setOpen(false),
    dumpCompleted: dumpState.completed || result.status === "success",
    dumpLocked: dumpState.inputs !== undefined,
    dumpPublishing: dumpState.publishing,
    dumping,
    estimateDefault: dumpState.inputs?.estimate,
    open,
    openGate: () => setOpen(true),
    result,
    setTasksMarkdown,
    taskErrors: validation.valid ? [] : validation.errors,
    tasksMarkdown,
  } as const;
}

function dumpGateState(dump: CeremonyDumpState): {
  readonly completed: boolean;
  readonly inputs: SignedDumpInputs | undefined;
  readonly publishing: boolean;
} {
  switch (dump.status) {
    case "not-started":
      return { completed: false, inputs: undefined, publishing: false };
    case "publishing":
      return { completed: false, inputs: dump.inputs, publishing: true };
    case "retryable":
      return { completed: false, inputs: dump.inputs, publishing: false };
    case "completed":
      return { completed: true, inputs: dump.inputs, publishing: false };
  }
}
