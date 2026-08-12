"use client";

import { validateTaskDraft } from "@sprint-griller/ceremony/task-draft";
import type { CeremonyDumpState, DossieState, SignedDumpInputs } from "@sprint-griller/ceremony";
import { useActionState, useState } from "react";
import { dumpCeremonyAction } from "../../actions";
import { DUMP_INITIAL_STATE } from "../../spec-draft-action-state";

interface UseDumpGateInput {
  readonly storyUrl: string;
  readonly taskPreview: string;
  readonly dump: DossieState["dump"];
  readonly ceremonyStatus: DossieState["status"];
}

export function useDumpGate({ storyUrl, taskPreview, dump, ceremonyStatus }: UseDumpGateInput) {
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
} {
  switch (dump.status) {
    case "not-started":
      return { completed: false, inputs: undefined };
    case "publishing":
    case "retryable":
      return { completed: false, inputs: dump.inputs };
    case "completed":
      return { completed: true, inputs: dump.inputs };
  }
}
