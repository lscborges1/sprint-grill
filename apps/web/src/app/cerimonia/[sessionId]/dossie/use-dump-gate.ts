"use client";

import type { CeremonyDumpState } from "@sprint-griller/ceremony";
import { useActionState } from "react";
import { dumpCeremonyAction } from "../../actions";
import { DUMP_INITIAL_STATE, type DumpActionState } from "../../spec-draft-action-state";

export type DumpGateView =
  | { readonly status: "ready" }
  | { readonly status: "retryable"; readonly estimate: number }
  | { readonly status: "publishing" }
  | { readonly status: "completed" };

export interface DumpGateController {
  readonly action: (formData: FormData) => void;
  readonly dumping: boolean;
  readonly result: DumpActionState;
  readonly view: DumpGateView;
}

export function useDumpGate(dump: CeremonyDumpState): DumpGateController {
  const [result, action, dumping] = useActionState(dumpCeremonyAction, DUMP_INITIAL_STATE);
  return { action, dumping, result, view: dumpGateView(dump, result) };
}

export function dumpGateView(
  dump: CeremonyDumpState,
  actionResult: DumpActionState,
): DumpGateView {
  if (actionResult.status === "success") return { status: "completed" };
  switch (dump.status) {
    case "not-started":
      return { status: "ready" };
    case "publishing":
      return { status: "publishing" };
    case "retryable":
      return { status: "retryable", estimate: dump.inputs.estimate };
    case "completed":
      return { status: "completed" };
  }
}
