"use client";

import { useEffect, useState } from "react";
import type { z } from "zod";
import { reportClientError } from "../lib/client-error";
import type { ClientErrorContext } from "../lib/client-error";

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
export type LiveStateParseResult<T> =
  | { readonly ok: true; readonly state: T }
  | { readonly ok: false; readonly error: unknown };

export function parseLiveState<T>(
  data: string,
  schema: z.ZodType<T>,
): LiveStateParseResult<T> {
  try {
    return { ok: true, state: schema.parse(JSON.parse(data) as unknown) };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

export function useLiveState<T>(
  path: string,
  schema: z.ZodType<T>,
  initial: T,
  context: Pick<ClientErrorContext, "schemaName" | "sessionId">,
): { state: T; connected: boolean } {
  const [state, setState] = useState(initial);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const source = new EventSource(path);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event: MessageEvent<string>) => {
      const parsed = parseLiveState(event.data, schema);
      if (!parsed.ok) {
        reportClientError({
          kind: "invalid-sse-payload",
          path,
          schemaName: context.schemaName,
          sessionId: context.sessionId,
        });
        setConnected(false);
        return;
      }

      setState(parsed.state);
      setConnected(true);
    };

    return () => source.close();
  }, [context.schemaName, context.sessionId, path, schema]);

  return { state, connected };
}
