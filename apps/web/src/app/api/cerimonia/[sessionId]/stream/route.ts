import type { PalcoState } from "@sprint-griller/ceremony";
import { getPalco, sessionIdSchema, subscribeToPalco } from "@/lib/ceremonies";

// O Palco é uma conexão aberta com a sala: nada aqui é cacheável.
export const dynamic = "force-dynamic";

/** Comentário SSE periódico: sem tráfego, um proxy ocioso derruba a conexão. */
const HEARTBEAT_MS = 15_000;

/**
 * O empurrão ao vivo para o Palco. Cada mudança de estado da cerimônia vira um
 * evento aqui — a sala não fica esperando polling entre uma pergunta e a
 * próxima.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const parsed = sessionIdSchema.safeParse((await params).sessionId);
  if (!parsed.success) return new Response("sessão inválida", { status: 400 });

  const sessionId = parsed.data;
  if (!getPalco(sessionId)) return new Response("cerimônia não encontrada", { status: 404 });

  const encoder = new TextEncoder();
  /**
   * Aba fechada chega como `cancel`; request abortada, como `abort`. Os dois
   * caem aqui: assinante que sobrevive à tela vira vazamento no processo do
   * Operador, que fica aberto a cerimônia inteira.
   */
  let stop = (): void => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (chunk: string): void => {
        if (!open) return;
        controller.enqueue(encoder.encode(chunk));
      };
      const send = (state: PalcoState): void => write(`data: ${JSON.stringify(state)}\n\n`);

      // O primeiro evento é o estado atual: a tela nunca começa vazia esperando mudança.
      const initial = getPalco(sessionId);
      if (initial) send(initial);

      const unsubscribe = subscribeToPalco(sessionId, send);
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

      stop = () => {
        if (!open) return;
        open = false;
        unsubscribe();
        clearInterval(heartbeat);
      };

      request.signal.addEventListener("abort", () => {
        stop();
        controller.close();
      });
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
