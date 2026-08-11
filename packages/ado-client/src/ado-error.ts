/**
 * Por que a conversa com o Azure DevOps falhou. Existe para a UI dizer o que o
 * Operador tem que corrigir — PAT, config ou rede — em vez de mostrar um stack
 * trace ou uma tela quebrada.
 */
export type AdoErrorKind =
  | "auth"
  | "not-found"
  | "conflict"
  | "connection"
  | "unexpected-response"
  | "unexpected";

export class AdoError extends Error {
  override readonly name = "AdoError";
  readonly kind: AdoErrorKind;

  constructor(kind: AdoErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}
