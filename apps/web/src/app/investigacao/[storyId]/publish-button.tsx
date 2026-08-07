"use client";

import { useFormStatus } from "react-dom";

/**
 * O botão que grava no Azure DevOps. É client-side por um motivo só: enquanto a
 * escrita está em voo, ele fica desabilitado. Dois cliques no mesmo relatório
 * viram dois comments na US da squad — a trava do servidor só pega o segundo
 * clique depois do primeiro ter voltado, e um duplo clique não espera isso.
 */
export function PublishButton({
  storyId,
  retry,
}: {
  storyId: number;
  retry: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="self-start rounded-full border border-line px-5 py-2 text-base font-medium hover:bg-foreground/5 disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "Publicando…" : retry ? "Tentar publicar de novo" : "Publicar"}
      <span className="sr-only"> a Investigação na US {storyId}</span>
    </button>
  );
}
