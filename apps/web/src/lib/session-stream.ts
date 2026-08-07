/** Comentário SSE periódico: sem tráfego, um proxy ocioso derruba a conexão. */
const HEARTBEAT_MS = 15_000;

/**
 * O empurrão ao vivo de uma cerimônia. Cada mudança de estado vira um evento
 * aqui — nem a sala no Palco nem o Operador no Dossiê ficam em polling entre uma
 * pergunta e a próxima.
 *
 * O primeiro evento é o estado atual: a tela nunca começa vazia esperando mudança.
 */
export function sessionEventStream<T>(
  request: Request,
  initial: T,
  subscribe: (send: (state: T) => void) => () => void,
): Response {
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
      const send = (state: T): void => write(`data: ${JSON.stringify(state)}\n\n`);

      send(initial);

      const unsubscribe = subscribe(send);
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
