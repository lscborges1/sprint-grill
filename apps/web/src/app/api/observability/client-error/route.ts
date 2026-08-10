import { z } from "zod";
import { logger } from "@/lib/logger";

const clientErrorSchema = z.object({
  kind: z.literal("invalid-sse-payload"),
  path: z.string().startsWith("/api/cerimonia/").max(512),
  schemaName: z.enum(["dossieStateSchema", "palcoStateSchema"]),
  sessionId: z.string().min(1).max(128),
});

/** Registra no servidor falhas de parsing do SSE, sem reter seu payload. */
export async function POST(request: Request): Promise<Response> {
  const parsed = clientErrorSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return new Response(null, { status: 400 });

  const { kind, path, schemaName, sessionId } = parsed.data;
  logger.error({ kind, path, schemaName, sessionId }, "falha no SSE do navegador");
  return new Response(null, { status: 204 });
}
