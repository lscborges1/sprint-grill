import { z } from "zod";

/** Uma consulta WIQL devolve só ids; os campos vêm do batch depois. */
export const wiqlIdsSchema = z.object({
  workItems: z.array(z.object({ id: z.number() })).default([]),
});

/** Aspas simples são escapadas dobrando, como manda a WIQL. */
export function escapeWiql(value: string): string {
  return value.replaceAll("'", "''");
}

/**
 * Instante como a WIQL espera na cláusula `ASOF`. Sempre UTC: o `ASOF` sem
 * fuso é interpretado no fuso da organização, e uma sprint fechada às 23h
 * viraria o dia seguinte na conta.
 */
export function asOfLiteral(instant: Date): string {
  return `'${escapeWiql(instant.toISOString())}'`;
}
