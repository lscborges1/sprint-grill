import { describe, expect, it } from "vitest";
import { sessionEventStream } from "./session-stream";

describe("sessionEventStream", () => {
  it("should send the current state after subscribing", async () => {
    let state = { decisionCount: 0 };
    const response = sessionEventStream(
      new Request("http://localhost/stream"),
      () => state,
      (send) => {
        state = { decisionCount: 1 };
        send(state);
        return () => undefined;
      },
    );

    const reader = response.body?.getReader();
    if (!reader) throw new Error("SSE response should have a body");

    const first = await reader.read();
    const decoder = new TextDecoder();

    expect(decoder.decode(first.value)).toBe('data: {"decisionCount":1}\n\n');

    await reader.cancel();
  });
});
