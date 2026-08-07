import { ConfigError } from "@sprint-griller/core";
import { z } from "zod";
import { positiveIntegerInputSchema } from "./rollover-domain";

const beforeInputSchema = z.iso.date().transform(
  (value) => new Date(`${value}T00:00:00.000Z`),
);

const rolagemOptionsSchema = z
  .object({
    sprints: positiveIntegerInputSchema.optional(),
    before: beforeInputSchema.optional(),
  })
  .strict();

const rolagemArgsSchema = z.preprocess((input: unknown) => {
  if (!Array.isArray(input)) return input;
  if (input.length === 0) return {};

  if (input.length === 2 && input[0] === "--sprints") {
    return { sprints: input[1] };
  }
  if (input.length === 2 && input[0] === "--before") {
    return { before: input[1] };
  }
  if (
    input.length === 4 &&
    input[0] === "--sprints" &&
    input[2] === "--before"
  ) {
    return { sprints: input[1], before: input[3] };
  }
  if (
    input.length === 4 &&
    input[0] === "--before" &&
    input[2] === "--sprints"
  ) {
    return { before: input[1], sprints: input[3] };
  }

  return { arguments: input };
}, rolagemOptionsSchema);

export type RolagemArgs = z.output<typeof rolagemOptionsSchema>;

/**
 * `--sprints N`: a janela padrão são as ~6 sprints anteriores ao rollout.
 * `--before YYYY-MM-DD`: inclui o fechamento nessa data e exclui os posteriores.
 * Qualquer outra forma (`--sprints=10`, typo, flag desconhecida) falha —
 * silenciar e cair no default reportaria a baseline da janela errada.
 */
export function parseRolagemArgs(argv: readonly string[]): RolagemArgs {
  const result = rolagemArgsSchema.safeParse(argv);
  if (!result.success) {
    throw new ConfigError(
      `Argumentos inválidos para rolagem: ${z.prettifyError(result.error)}`,
    );
  }

  return {
    ...(result.data.sprints === undefined
      ? {}
      : { sprints: result.data.sprints }),
    ...(result.data.before === undefined ? {} : { before: result.data.before }),
  };
}
