import type { ReactNode } from "react";

export type StatusBadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASSES = {
  neutral: "border-line bg-foreground/[0.04] text-muted",
  info: "border-accent/40 bg-accent/10 text-accent",
  success: "border-emerald-700/40 bg-emerald-700/10 text-refined",
  warning: "border-amber-700/40 bg-amber-700/10 text-investigated",
  danger: "border-red-700/40 bg-red-700/10 text-red-700 dark:text-red-300",
} as const satisfies Record<StatusBadgeTone, string>;

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  readonly tone?: StatusBadgeTone;
  readonly children: ReactNode;
}) {
  return (
    <span
      role="status"
      className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
