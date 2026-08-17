import { OperationalFrame } from "@/components/operational-frame";
import { StatusBadge } from "@/components/ui";

export default function Loading() {
  return (
    <OperationalFrame>
      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-4 px-4 py-8 sm:px-6 lg:px-10 lg:py-12" aria-busy="true" aria-live="polite">
        <StatusBadge tone="info">Carregando Refina…</StatusBadge>
        <div className="h-10 w-2/3 animate-pulse rounded-[var(--radius-md)] bg-foreground/[0.08]" />
        <div className="h-32 w-full animate-pulse rounded-[var(--radius-md)] bg-foreground/[0.06]" />
      </main>
    </OperationalFrame>
  );
}
