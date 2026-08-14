"use client";

import { useId, useRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "./button";

export function ConfirmAction({
  triggerLabel,
  title,
  description,
  confirmLabel,
  action,
  triggerProps,
  children,
}: {
  readonly triggerLabel: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly action: (formData: FormData) => void | Promise<void>;
  readonly triggerProps?: Omit<ButtonProps, "children" | "type">;
  readonly children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <>
      <Button
        {...triggerProps}
        type="button"
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-w-md rounded-[var(--radius-md)] border border-line bg-surface p-0 text-foreground shadow-xl backdrop:bg-foreground/30"
      >
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-2">
            <h2 id={titleId} className="font-serif text-2xl tracking-tight">{title}</h2>
            <p id={descriptionId} className="text-sm text-muted">{description}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <form method="dialog">
              <Button type="submit" variant="quiet">Cancelar</Button>
            </form>
            <form action={action}>
              {children}
              <Button type="submit" variant="danger">{confirmLabel}</Button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
