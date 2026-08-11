import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ERROR_REPORT_PATH, reportClientError } from "./client-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportClientError", () => {
  it("should send only safe SSE context to the application boundary", async () => {
    const sendBeacon = vi.fn<typeof navigator.sendBeacon>(() => true);
    vi.stubGlobal("navigator", { sendBeacon });

    const sent = reportClientError({
      kind: "invalid-sse-payload",
      path: "/api/cerimonia/thread-1/stream",
      schemaName: "palcoStateSchema",
      sessionId: "thread-1",
    });

    expect(sent).toBe(true);
    expect(sendBeacon).toHaveBeenCalledWith(CLIENT_ERROR_REPORT_PATH, expect.any(Blob));
    const body = sendBeacon.mock.calls[0]?.[1];
    if (!(body instanceof Blob)) {
      throw new Error("Expected reportClientError to send a Blob payload");
    }

    expect(await body.text()).toBe(
      JSON.stringify({
        kind: "invalid-sse-payload",
        path: "/api/cerimonia/thread-1/stream",
        schemaName: "palcoStateSchema",
        sessionId: "thread-1",
      }),
    );
  });

  it("should not attempt reporting outside the browser", () => {
    vi.stubGlobal("navigator", undefined);

    expect(
      reportClientError({
        kind: "invalid-sse-payload",
        path: "/api/cerimonia/thread-1/stream",
        schemaName: "palcoStateSchema",
        sessionId: "thread-1",
      }),
    ).toBe(false);
  });
});
