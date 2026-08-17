"use client";

import { OperationalFrame } from "@/components/operational-frame";
import { Button } from "@/components/ui";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <OperationalFrame>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-20 sm:px-8">
        <h1 className="font-serif text-3xl tracking-tight">Algo quebrou nesta tela</h1>
        <p className="text-lg text-muted">O detalhe do erro fica nos logs estruturados. Tente recarregar esta etapa.</p>
        <Button type="button" variant="primary" onClick={reset} className="self-start">Tentar de novo</Button>
      </main>
    </OperationalFrame>
  );
}
