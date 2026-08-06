export interface EventQueue<T> {
  push(event: T): void;
  /** Encerra o stream depois que o que já está na fila for consumido. */
  finish(): void;
  stream(): AsyncGenerator<T>;
}

/**
 * Ponte entre callbacks e `for await`: o que chega enquanto ninguém está lendo
 * fica na fila, e não se perde.
 */
export function createEventQueue<T>(): EventQueue<T> {
  const buffered: T[] = [];
  let wake: (() => void) | null = null;
  let finished = false;

  function notify(): void {
    wake?.();
    wake = null;
  }

  return {
    push(event) {
      if (finished) return;
      buffered.push(event);
      notify();
    },
    finish() {
      finished = true;
      notify();
    },
    async *stream() {
      for (;;) {
        const next = buffered.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (finished) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
