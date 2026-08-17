import type { ReactElement, ReactNode } from "react";

export function EmptyState({
  heading,
  children,
  action,
}: {
  readonly heading: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[var(--radius-md)] border border-dashed border-line px-5 py-6">
      <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
      {children !== undefined && <p className="max-w-[60ch] text-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}
