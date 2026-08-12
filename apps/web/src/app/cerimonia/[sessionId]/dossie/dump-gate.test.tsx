import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DumpGate } from "./dump-gate";

const controller = vi.hoisted(() => ({
  current: {
    action: () => undefined,
    ceremonyClosed: true,
    close: () => undefined,
    dumpCompleted: false,
    dumpLocked: false,
    dumpPublishing: false,
    dumping: false,
    estimateDefault: undefined as number | undefined,
    open: true,
    openGate: () => undefined,
    result: { status: "idle" as const },
    setTasksMarkdown: () => undefined,
    taskErrors: [],
    tasksMarkdown: "## Implementar\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/1)\n\n### Critérios de aceite\n\n- Funciona.",
  },
}));

vi.mock("./use-dump-gate", () => ({
  useDumpGate: () => controller.current,
}));

const props = {
  sessionId: "ceremony-1",
  storyUrl: "https://dev.azure.com/acme/Plataforma/_workitems/edit/1",
  markdown: "# Spec",
  base: "# Spec",
  pending: [],
  taskPreview: "## Implementar\n\n[Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/1)\n\n### Critérios de aceite\n\n- Funciona.",
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
    controller.current = { ...controller.current, dumpLocked: false, estimateDefault: undefined };

    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toMatch(/<select id="estimate" name="estimate" required=""/);
    expect(html.match(/<option value="(?:1|2|3|5|8|13|21|34|55|89)">/g)).toHaveLength(10);
  });

  it("should submit a frozen legacy estimate through a hidden field", () => {
    controller.current = { ...controller.current, dumpLocked: true, estimateDefault: 4 };

    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain('<input type="hidden" name="estimate" value="4"/>');
    expect(html).toContain("4");
  });

  it("should render a persisted publishing dump as a non-interactive status", () => {
    controller.current = {
      ...controller.current,
      dumpCompleted: false,
      dumpLocked: true,
      dumpPublishing: true,
      open: false,
    };

    const html = renderToStaticMarkup(<DumpGate {...props} />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Despejo em andamento");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
});
