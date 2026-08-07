/** Erro de cerimônia: acontece com a sala na frente, e a mensagem vai para o Palco. */
export class CeremonyError extends Error {
  override readonly name = "CeremonyError";
}
