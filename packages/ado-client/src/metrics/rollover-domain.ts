import { z } from "zod";

/** A positive integer used for bounded metric windows. */
export const positiveIntegerSchema = z.number().int().positive();

/** Parses the decimal form used by CLI flags with the domain rule above. */
export const positiveIntegerInputSchema = z.preprocess(
  (value: unknown) =>
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : value,
  positiveIntegerSchema,
);

/** Keeps the default and runtime validation for metric windows in one place. */
export function validatePositiveInteger(
  value: number | undefined,
  defaultValue: number,
  fieldName: string,
): number {
  if (value === undefined) return defaultValue;

  const result = positiveIntegerSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(
      `${fieldName} precisa ser um inteiro positivo (recebeu ${String(value)}).`,
    );
  }

  return result.data;
}

/** A Date schema that also rejects `new Date(NaN)`. */
export const validDateSchema = z.date();
