import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DumpGate } from "./dump-gate";
import { dumpGateView, type DumpGateController } from "./use-dump-gate";

const DEFAULT_TASKS = "## Implementar\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/1)\n\n### Critérios de aceite\n\n- Funciona.";

const DEFAULT_CONTROLLER = {
  action: () => undefined,
  ceremonyClosed: true,
  close: () => undefined,
  dumping: false,
  open: true,
  openGate: () => undefined,
  result: { status: "idle" },
  setTasksMarkdown: () => undefined,
  taskErrors: [],
  view: { status: "editable", tasksMarkdown: DEFAULT_TASKS },
} as const satisfies DumpGateController;

const controller = vi.hoisted(() => ({
  current: {} as DumpGateController,
}));

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
  storyUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/1",
  markdown: "# Spec",
  base: "# Spec",
  pending: [],
  taskPreview: DEFAULT_TASKS,
  dump: { status: "not-started" as const },
  ceremonyStatus: "encerrada" as const,
  blocked: false,
};

describe("DumpGate estimate", () => {
  it("should tell the operator every Task needs the exact current Spec URL", () => {
    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain("Toda Task deve conter um link Markdown para a URL exata da Spec desta US:");
    expect(html).toContain(props.storyUrl);
    expect(html).not.toContain("Se usar");
  });

  it("should render the allowed estimate scale as a select for a new dump", () => {
    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toMatch(/<select id="estimate" name="estimate" required=""/);
    expect(html.match(/<option value="(?:1|2|3|5|8|13|21|34|55|89)">/g)).toHaveLength(10);
  });

  it("should submit a frozen legacy estimate through a hidden field", () => {
    controller.current = {
      ...DEFAULT_CONTROLLER,
      view: { status: "retryable", tasksMarkdown: DEFAULT_TASKS, estimate: 4 },
    };

    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain('<input type="hidden" name="estimate" value="4"/>');
    expect(html).toContain("4");
  });

  it("should render a persisted publishing dump as a non-interactive status", () => {
    controller.current = {
      ...controller.current,
      view: { status: "publishing" },
      open: false,
    };

    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Despejo em andamento");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });

  it("should render a completed dump as a non-interactive status", () => {
    controller.current = {
      ...DEFAULT_CONTROLLER,
      view: { status: "completed" },
    };

    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Despejo concluído");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
});

describe("dumpGateView", () => {
  it("should project a successful action as completed before the SSE echo", () => {
    expect(
      dumpGateView(
        {
          status: "publishing",
          inputs: {
            dumpId: "dump-1",
            markdown: "# Spec",
            tasksMarkdown: DEFAULT_TASKS,
            estimate: 5,
          },
          startedAt: 1,
        },
        { status: "success" },
        DEFAULT_TASKS,
      ),
    ).toEqual({ status: "completed" });
  });
});
