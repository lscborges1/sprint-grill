"use client";

import { useEffect, useState } from "react";
import type { z } from "zod";

/**
 * O estado da cerimônia chega empurrado por SSE — entre uma pergunta e a próxima
 * ninguém fica olhando tela parada nem esperando polling. O estado inicial veio
 * do servidor, então a tela já nasce certa mesmo antes da conexão abrir.
 *
 * `connected` existe porque tela mentindo é pior que tela em branco: sem
 * conexão, o que está ali pode já ter mudado, e quem lê precisa saber.
 *
 * O que chega pela rede é dado externo do ponto de vista do browser, e entra
 * por schema — nunca por `as`.
 */
export function useLiveState<T>(
  path: string,
  schema: z.ZodType<T>,
  initial: T,
): { state: T; connected: boolean } {
  const [state, setState] = useState(initial);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const source = new EventSource(path);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event: MessageEvent<string>) => {
      setState(schema.parse(JSON.parse(event.data)));
      setConnected(true);
    };

    return () => source.close();
  }, [path, schema]);

  return { state, connected };
}
