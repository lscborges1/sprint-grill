import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactElement | ReactNode;
}) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter((value): value is string => value !== undefined).join(" ");
  const control = isValidElement<{ "aria-describedby"?: string }>(children)
    ? describedBy === ""
      ? children
      : cloneElement(children, { "aria-describedby": describedBy })
    : children;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {control}
      {hint !== undefined && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {error !== undefined && <p id={errorId} role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
