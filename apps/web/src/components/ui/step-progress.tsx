export function StepProgress({
  steps,
  current,
}: {
  readonly steps: readonly string[];
  readonly current: number;
}) {
  return (
    <ol aria-label="Progresso" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? "step" : undefined}
          className={`flex items-center gap-2 text-xs font-medium ${index === current ? "text-foreground" : index < current ? "text-accent" : "text-muted"}`}
        >
          <span aria-hidden="true" className={`size-2 rounded-full ${index <= current ? "bg-accent" : "bg-line"}`} />
          {step}
        </li>
      ))}
    </ol>
  );
}
