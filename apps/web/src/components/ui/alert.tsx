import type { ReactElement, ReactNode } from "react";
import { Button, type ButtonProps } from "./button";

export function Alert({
  heading,
  children,
  tone = "danger",
  action,
}: {
  readonly heading: string;
  readonly children?: ReactNode;
  readonly tone?: "danger" | "warning" | "info";
  readonly action?: { readonly label: string; readonly props?: ButtonProps };
}): ReactElement {
  const toneClasses = {
    danger: "border-red-700/40 bg-red-700/[0.06]",
    warning: "border-amber-700/40 bg-amber-700/[0.06]",
    info: "border-accent/40 bg-accent/[0.06]",
  } as const;

  return (
    <div role="alert" className={`flex flex-col gap-3 rounded-[var(--radius-md)] border px-4 py-3 ${toneClasses[tone]}`}>
      <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
      {children !== undefined && <div className="text-sm text-muted">{children}</div>}
      {action !== undefined && <Button {...action.props}>{action.label}</Button>}
    </div>
  );
}
