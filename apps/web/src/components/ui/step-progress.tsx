import type { ReactElement } from "react";

export type ProgressState<StepId extends string> =
  | { readonly kind: "active"; readonly step: StepId }
  | { readonly kind: "complete" };

export interface ProgressStep<StepId extends string> {
  readonly id: StepId;
  readonly label: string;
}

export function StepProgress<StepId extends string>({
  steps,
  progress,
}: {
  readonly steps: readonly [ProgressStep<StepId>, ...ProgressStep<StepId>[]];
  readonly progress: ProgressState<StepId>;
}): ReactElement {
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) throw new Error("StepProgress requires unique step identifiers.");
  if (progress.kind === "active" && !ids.has(progress.step)) {
    throw new Error(`StepProgress active step "${progress.step}" is not present.`);
  }

  const activeIndex = progress.kind === "active"
    ? steps.findIndex((step) => step.id === progress.step)
    : steps.length;

  return (
    <ol aria-label="Progresso" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {steps.map((step, index) => {
        const state = progress.kind === "complete" || index < activeIndex
          ? "complete"
          : index === activeIndex
            ? "active"
            : "pending";

        return (
          <li
            key={step.id}
            aria-current={state === "active" ? "step" : undefined}
            className={`flex items-center gap-2 text-xs font-medium ${state === "active" ? "text-foreground" : state === "complete" ? "text-accent" : "text-muted"}`}
            data-state={state}
          >
            <span aria-hidden="true" className={`size-2 rounded-full ${state === "pending" ? "bg-line" : "bg-accent"}`} />
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
