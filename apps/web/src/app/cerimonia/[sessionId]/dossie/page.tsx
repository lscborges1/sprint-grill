import { notFound } from "next/navigation";
import { getDossie, sessionIdSchema } from "@/lib/ceremonies";
import { Dossie } from "./dossie";

// O Dossiê mostra a cerimônia agora; nada aqui é pré-renderizável.
export const dynamic = "force-dynamic";

/**
 * A aba do Operador. O estado inicial vem do banco, renderizado no servidor: é
 * o que faz o F5 voltar com o documento — e com a edição — exatamente onde
 * estavam.
 */
export default async function DossiePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const parsed = sessionIdSchema.safeParse((await params).sessionId);
  if (!parsed.success) notFound();

  const state = getDossie(parsed.data);
  if (!state) notFound();

  return <Dossie initial={state} />;
}
