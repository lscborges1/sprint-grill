"use client";

import { validateTaskDraft } from "@sprint-griller/ceremony/task-draft";
import type { CeremonyDumpState, DossieState } from "@sprint-griller/ceremony";
import { useActionState, useState } from "react";
import { dumpCeremonyAction } from "../../actions";
import { DUMP_INITIAL_STATE, type DumpActionState } from "../../spec-draft-action-state";

interface UseDumpGateInput {
  readonly storyUrl: string;
  readonly taskPreview: string;
  readonly dump: DossieState["dump"];
  readonly ceremonyStatus: DossieState["status"];
}

export type DumpGateView =
  | { readonly status: "editable"; readonly tasksMarkdown: string }
  | { readonly status: "retryable"; readonly tasksMarkdown: string; readonly estimate: number }
  | { readonly status: "publishing" }
  | { readonly status: "completed" };

export interface DumpGateController {
  readonly action: (formData: FormData) => void;
  readonly ceremonyClosed: boolean;
  readonly close: () => void;
  readonly dumping: boolean;
  readonly open: boolean;
  readonly openGate: () => void;
  readonly result: DumpActionState;
  readonly setTasksMarkdown: (tasksMarkdown: string) => void;
  readonly taskErrors: readonly string[];
  readonly view: DumpGateView;
}

export function useDumpGate(
  { storyUrl, taskPreview, dump, ceremonyStatus }: UseDumpGateInput,
): DumpGateController {
  const initialTasksMarkdown = dump.status === "not-started" ? taskPreview : dump.inputs.tasksMarkdown;
  const [open, setOpen] = useState(false);
  const [result, action, dumping] = useActionState(dumpCeremonyAction, DUMP_INITIAL_STATE);
  const [tasksMarkdown, setTasksMarkdown] = useState(initialTasksMarkdown);
  const validation = validateTaskDraft(tasksMarkdown, storyUrl);

  return {
    action,
    ceremonyClosed: ceremonyStatus === "encerrada",
    close: () => setOpen(false),
    dumping,
    open,
    openGate: () => setOpen(true),
    result,
    setTasksMarkdown,
    taskErrors: validation.valid ? [] : validation.errors,
    view: dumpGateView(dump, result, tasksMarkdown),
  } as const;
}

export function dumpGateView(
  dump: CeremonyDumpState,
  actionResult: DumpActionState,
  tasksMarkdown: string,
): DumpGateView {
  if (actionResult.status === "success") return { status: "completed" };

  switch (dump.status) {
    case "not-started":
      return { status: "editable", tasksMarkdown };
    case "publishing":
      return { status: "publishing" };
    case "retryable":
      return {
        status: "retryable",
        tasksMarkdown: dump.inputs.tasksMarkdown,
        estimate: dump.inputs.estimate,
      };
    case "completed":
      return { status: "completed" };
  }
}
