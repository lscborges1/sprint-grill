import { z } from "zod";

export const signedDumpInputsSchema = z.object({
  dumpId: z.string(),
  markdown: z.string(),
  tasksMarkdown: z.string(),
  estimate: z.number().finite().positive(),
}).readonly();

export const dumpStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-started") }),
  z.object({
    status: z.literal("publishing"),
    inputs: signedDumpInputsSchema,
    startedAt: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal("retryable"), inputs: signedDumpInputsSchema }),
  z.object({
    status: z.literal("completed"),
    inputs: signedDumpInputsSchema,
    completedAt: z.number().int().nonnegative(),
  }),
]).readonly();

export type SignedDumpInputs = z.infer<typeof signedDumpInputsSchema>;
export type CeremonyDumpState = z.infer<typeof dumpStateSchema>;

/** Os inputs assinados existem em todos os estados posteriores ao primeiro beginDump. */
export function signedDumpInputs(dump: CeremonyDumpState): SignedDumpInputs | undefined {
  switch (dump.status) {
    case "not-started":
      return undefined;
    case "publishing":
    case "retryable":
    case "completed":
      return dump.inputs;
  }
}
