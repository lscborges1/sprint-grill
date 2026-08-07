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
