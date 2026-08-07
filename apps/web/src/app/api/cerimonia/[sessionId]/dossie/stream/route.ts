import { getDossie, sessionIdSchema, subscribeToDossie } from "@/lib/ceremonies";
import { sessionEventStream } from "@/lib/session-stream";

// O Dossiê acompanha a cerimônia agora: nada aqui é cacheável.
export const dynamic = "force-dynamic";

/** O empurrão ao vivo para o Dossiê — o documento se formando na aba do Operador. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const parsed = sessionIdSchema.safeParse((await params).sessionId);
  if (!parsed.success) return new Response("sessão inválida", { status: 400 });

  const sessionId = parsed.data;
  const initial = getDossie(sessionId);
  if (!initial) return new Response("cerimônia não encontrada", { status: 404 });

  return sessionEventStream(request, initial, (send) => subscribeToDossie(sessionId, send));
}
