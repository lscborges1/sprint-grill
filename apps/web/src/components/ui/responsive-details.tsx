"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

const DESKTOP_NAVIGATION_QUERY = "(min-width: 64rem)";

export function ResponsiveDetails({
  summary,
  children,
  className,
  summaryClassName,
}: {
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly summaryClassName?: string;
}): ReactElement {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (details === null) return;
    const responsiveDetails = details;

    const desktop = window.matchMedia(DESKTOP_NAVIGATION_QUERY);
    let mobileOpen = responsiveDetails.open;

    function rememberMobileState(): void {
      if (!desktop.matches) mobileOpen = responsiveDetails.open;
    }

    function synchronizeViewport(): void {
      responsiveDetails.open = desktop.matches || mobileOpen;
    }

    responsiveDetails.addEventListener("toggle", rememberMobileState);
    desktop.addEventListener("change", synchronizeViewport);
    synchronizeViewport();

    return () => {
      responsiveDetails.removeEventListener("toggle", rememberMobileState);
      desktop.removeEventListener("change", synchronizeViewport);
    };
  }, []);

  return (
    <details ref={detailsRef} open className={className}>
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
}
