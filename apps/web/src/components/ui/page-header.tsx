import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly back?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line pb-6">
      {back}
      {eyebrow !== undefined && <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</p>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="font-serif text-[clamp(2rem,4vw,3rem)] leading-tight tracking-tight">{title}</h1>
          {description !== undefined && <div className="max-w-[72ch] text-base text-muted">{description}</div>}
        </div>
        {actions}
      </div>
    </header>
  );
}
