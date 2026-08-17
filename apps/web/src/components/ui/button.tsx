import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES = {
  primary: "border-accent bg-accent text-accent-foreground hover:bg-accent/90",
  secondary: "border-line bg-surface text-foreground hover:bg-foreground/[0.04]",
  quiet: "border-transparent bg-transparent text-muted hover:bg-foreground/[0.05] hover:text-foreground",
  danger: "border-red-600/60 bg-red-600 text-white hover:bg-red-700",
} as const satisfies Record<ButtonVariant, string>;

const SIZE_CLASSES = {
  sm: "min-h-8 px-3 text-sm",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
} as const satisfies Record<ButtonSize, string>;

export function buttonStyles({
  variant = "secondary",
  size = "md",
  className = "",
}: {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
} = {}): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] border font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps): ReactElement {
  return (
    <button
      {...props}
      className={buttonStyles({
        variant,
        size,
        ...(className === undefined ? {} : { className }),
      })}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
  readonly size?: ButtonSize;
  readonly children?: ReactNode;
}

export function IconButton({
  label,
  size = "md",
  className,
  children,
  ...props
}: IconButtonProps): ReactElement {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      aria-label={label}
      className={buttonStyles({
        variant: "quiet",
        size,
        className: `aspect-square px-0 ${className ?? ""}`,
      })}
    >
      {children}
    </button>
  );
}
