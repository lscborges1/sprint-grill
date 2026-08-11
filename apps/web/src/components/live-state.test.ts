import { z } from "zod";
import { describe, expect, it } from "vitest";
import { parseLiveState } from "./live-state";

const schema = z.object({ count: z.number() });

describe("parseLiveState", () => {
  it("should return a validated state for a well-formed SSE payload", () => {
    expect(parseLiveState('{"count":2}', schema)).toEqual({ ok: true, state: { count: 2 } });
  });

  it("should reject malformed JSON without throwing", () => {
    const result = parseLiveState("not-json", schema);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected malformed JSON to be rejected");
    expect(result.error).toBeInstanceOf(SyntaxError);
  });

  it("should reject a payload that fails its schema without throwing", () => {
    const result = parseLiveState('{"count":"two"}', schema);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid state to be rejected");
    expect(result.error).toBeInstanceOf(z.ZodError);
  });
});
