import { notFound } from "next/navigation";
import { getPalco, sessionIdSchema } from "@/lib/ceremonies";
import { Palco } from "./palco";

// O Palco mostra a cerimônia agora; nada aqui é pré-renderizável.
export const dynamic = "force-dynamic";

/**
 * O estado inicial vem do banco, renderizado no servidor: é o que faz um F5 no
 * meio da cerimônia voltar exatamente no mesmo ponto, sem esperar o SSE abrir.
 */
export default async function CerimoniaPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const parsed = sessionIdSchema.safeParse((await params).sessionId);
  if (!parsed.success) notFound();

  const state = getPalco(parsed.data);
  if (!state) notFound();

  return <Palco initial={state} />;
}
