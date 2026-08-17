import type { ReactElement, ReactNode } from "react";
import { ThemeSelector } from "./theme-selector";

export function OperationalFrame({
  children,
  className = "",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  return (
    <div className={`relative flex min-h-full flex-1 flex-col ${className}`}>
      <div className="mx-auto flex w-full max-w-[1440px] justify-end px-4 pt-3 sm:px-6">
        <ThemeSelector />
      </div>
      {children}
    </div>
  );
}
