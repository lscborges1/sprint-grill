export const CLIENT_ERROR_REPORT_PATH = "/api/observability/client-error";

/** Contexto seguro de uma falha no browser; o payload SSE nunca sai do cliente. */
export interface ClientErrorContext {
  readonly kind: "invalid-sse-payload";
  readonly path: string;
  readonly schemaName: "dossieStateSchema" | "palcoStateSchema";
  readonly sessionId: string;
}

/** Encaminha falhas do browser para o limite observável da aplicação. */
export function reportClientError(context: ClientErrorContext): boolean {
  if (typeof navigator === "undefined") return false;

  return navigator.sendBeacon(
    CLIENT_ERROR_REPORT_PATH,
    new Blob([JSON.stringify(context)], { type: "application/json" }),
  );
}
