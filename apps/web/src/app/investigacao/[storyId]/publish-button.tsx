"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

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
    <Button
      type="submit"
      variant="primary"
      disabled={pending}
      aria-busy={pending}
      className="self-start disabled:cursor-progress"
    >
      {pending ? "Publicando…" : retry ? "Tentar publicar de novo" : "Publicar"}
      <span className="sr-only"> a Investigação na US {storyId}</span>
    </Button>
  );
}
