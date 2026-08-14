import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationalFrame } from "../operational-frame";
import {
  Alert,
  Button,
  ConfirmAction,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  StatusBadge,
  StepProgress,
} from "./index";

describe("Refina UI primitives", () => {
  it("should render a primary button with a visible focus contract", () => {
    const html = renderToStaticMarkup(<Button variant="primary">Salvar</Button>);

    expect(html).toContain("Salvar");
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("bg-accent");
  });

  it("should expose an icon button label to assistive technology", () => {
    const html = renderToStaticMarkup(<IconButton label="Abrir menu">+</IconButton>);

    expect(html).toMatch(/aria-label="Abrir menu"/);
    expect(html).toContain("focus-visible:ring-2");
  });

  it("should connect a field label, hint, and error to its control", () => {
    const html = renderToStaticMarkup(
      <Field id="story-search" label="Buscar US" hint="ID ou título" error="Informe uma busca">
        <input id="story-search" />
      </Field>,
    );

    expect(html).toMatch(/for="story-search"/);
    expect(html).toMatch(/aria-describedby="story-search-hint story-search-error"/);
    expect(html).toContain("Informe uma busca");
  });

  it("should render status, alert, and empty states with semantic roles", () => {
    const html = renderToStaticMarkup(
      <>
        <StatusBadge tone="success">Publicado</StatusBadge>
        <Alert heading="Falha">Tente novamente.</Alert>
        <EmptyState heading="Nenhuma US">Ajuste os filtros.</EmptyState>
      </>,
    );

    expect(html).toMatch(/role="status"/);
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("Nenhuma US");
  });

  it("should render a page header and an accessible step progress", () => {
    const html = renderToStaticMarkup(
      <>
        <PageHeader eyebrow="Sprint 42" title="Refina" description="Trabalho atual" />
        <StepProgress
          steps={["Investigar", "Refinar", "Publicar"]}
          current={1}
        />
      </>,
    );

    expect(html).toContain("Refina");
    expect(html).toMatch(/aria-label="Progresso"/);
    expect(html).toMatch(/aria-current="step"/);
  });

  it("should put a destructive action behind a cancelable native dialog", () => {
    const html = renderToStaticMarkup(
      <ConfirmAction
        triggerLabel="Reabrir"
        title="Reabrir Refinamento"
        description="Aprovações serão invalidadas."
        confirmLabel="Confirmar reabertura"
        action={() => undefined}
      />,
    );

    expect(html).toContain("<dialog");
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain("Aprovações serão invalidadas.");
    expect(html).toContain("Cancelar");
    expect(html).toContain("Confirmar reabertura");
  });

  it("should keep theme utilities inside the operational frame", () => {
    const html = renderToStaticMarkup(<OperationalFrame><main>Conteúdo</main></OperationalFrame>);

    expect(html).toContain("Conteúdo");
    expect(html).toContain('id="theme-preference"');
    expect(html).toContain("min-h-full");
  });
});
