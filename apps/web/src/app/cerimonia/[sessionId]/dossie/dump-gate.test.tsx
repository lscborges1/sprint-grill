import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DumpGate } from "./dump-gate";
import { dumpGateView, type DumpGateController } from "./use-dump-gate";

const DEFAULT_CONTROLLER = {
  action: () => undefined,
  dumping: false,
  result: { status: "idle" },
  view: { status: "ready" },
} as const satisfies DumpGateController;

const controller = vi.hoisted(() => ({ current: {} as DumpGateController }));

vi.mock("../../actions", () => ({
  dumpCeremonyAction: () => Promise.resolve({ status: "idle" }),
}));

vi.mock("./use-dump-gate", async (importOriginal) => ({
  ...(await importOriginal()),
  useDumpGate: () => controller.current,
}));

beforeEach(() => {
  controller.current = { ...DEFAULT_CONTROLLER };
});

const props = {
  sessionId: "ceremony-1",
  phase: "pronto-para-publicar" as const,
  dump: { status: "not-started" as const },
};

describe("DumpGate", () => {
  it("should submit only the server-owned session and estimate fields", () => {
    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain('name="sessionId"');
    expect(html).toContain('name="estimate"');
    expect(html).not.toContain('name="markdown"');
    expect(html).not.toContain('name="tasksMarkdown"');
    expect(html).not.toContain('name="confirmPending"');
  });

  it("should render the Fibonacci estimate scale for a new publication", () => {
    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toMatch(/<select id="estimate" name="estimate" required=""/);
    expect(html.match(/<option value="(?:1|2|3|5|8|13|21|34|55|89)">/g)).toHaveLength(10);
  });

  it("should preserve a frozen legacy estimate on retry", () => {
    controller.current = { ...DEFAULT_CONTROLLER, view: { status: "retryable", estimate: 4 } };

    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain('<input type="hidden" name="estimate" value="4"/>');
    expect(html).toContain("Tentar publicação novamente");
  });

  it.each([
    ["publishing", "Publicação em andamento"],
    ["completed", "Publicação concluída"],
  ] as const)("should render %s as a non-interactive status", (status, label) => {
    controller.current = { ...DEFAULT_CONTROLLER, view: { status } };

    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain('role="status"');
    expect(html).toContain(label);
    expect(html).not.toContain("<form");
  });
});

describe("dumpGateView", () => {
  it("should project a successful action before the SSE echo", () => {
    expect(dumpGateView({ status: "not-started" }, { status: "success" }))
      .toEqual({ status: "completed" });
  });
});
