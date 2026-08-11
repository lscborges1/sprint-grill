import { getPalco, sessionIdSchema, subscribeToPalco } from "@/lib/ceremonies";
import { sessionEventStream } from "@/lib/session-stream";

// O Palco é uma conexão aberta com a sala: nada aqui é cacheável.
export const dynamic = "force-dynamic";

/** O empurrão ao vivo para o Palco — o que a sala acompanha projetado. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const parsed = sessionIdSchema.safeParse((await params).sessionId);
  if (!parsed.success) return new Response("sessão inválida", { status: 400 });

  const sessionId = parsed.data;
  const initial = getPalco(sessionId);
  if (!initial) return new Response("cerimônia não encontrada", { status: 404 });

  return sessionEventStream(
    request,
    () => getPalco(sessionId) ?? initial,
    (send) => subscribeToPalco(sessionId, send),
  );
}
