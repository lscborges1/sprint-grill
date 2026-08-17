// @vitest-environment happy-dom

import type { PalcoState } from "@sprint-griller/ceremony";
import type { DetachedWindowAPI } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Palco, PalcoView } from "./palco";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

declare global {
  interface Window {
    readonly happyDOM: DetachedWindowAPI;
  }
}

vi.mock("@/components/live-state", () => ({
  useLiveState: (_path: string, _schema: unknown, initial: PalcoState) => ({
    state: initial,
    connected: true,
  }),
}));

vi.mock("../actions", () => ({
  addDoubtAction: () => Promise.resolve(null),
  confirmRefinementAction: () => Promise.resolve(null),
  continueRefiningAction: () => Promise.resolve(null),
  resumeCeremonyAction: () => Promise.resolve(null),
  submitDecisionAction: () => Promise.resolve(null),
}));

const stoppedSpecReview = {
  sessionId: "session-1",
  story: {
    id: 117,
    title: "Exportar relatório",
    url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/117",
  },
  refinement: { phase: "revisando-spec", revision: 4 },
  completionProposal: null,
  agenda: [],
  decisionCount: 0,
  decisions: [],
  pendingQuestions: [],
  lastDecision: null,
  consultation: null,
  pending: [],
  live: false,
  current: { phase: "retomavel" },
} as const satisfies PalcoState;

it("should let the operator resume when a Spec review turn has stopped", () => {
  const html = renderToStaticMarkup(<Palco initial={stoppedSpecReview} />);

  expect(html).toContain("O Refinamento está parado");
  expect(html).toContain("Retomar Refinamento");
  expect(html).not.toContain("Abrir revisão no Dossiê");
});

it("should show the failure when a Spec review turn fails", () => {
  const failedReview = {
    ...stoppedSpecReview,
    current: { phase: "falhou", message: "O runtime parou." },
  } as const satisfies PalcoState;

  const html = renderToStaticMarkup(<Palco initial={failedReview} />);

  expect(html).toContain("O Refinamento parou por um erro");
  expect(html).toContain("O runtime parou.");
  expect(html).not.toContain("Abrir revisão no Dossiê");
});

it("should register one semantic decision after choosing a radio answer", () => {
  const asking = {
    ...stoppedSpecReview,
    refinement: { phase: "refinando", revision: 1 },
    pendingQuestions: [],
    current: {
      phase: "perguntando",
      question: {
        questionSeq: 1,
        id: "q1",
        agendaItemId: "agenda-1",
        source: "agent",
        header: "Comportamento",
        question: "A sala confirma o comportamento?",
        recommendation: "Sim, manter a regra atual.",
        evidence: [],
        options: [{ label: "Sim", description: "Mantém compatibilidade." }, { label: "Não", description: "Exige nova regra." }],
        allowFreeText: true,
      },
    },
  } as const satisfies PalcoState;

  const html = renderToStaticMarkup(<PalcoView state={asking} connected />);

  expect(html).toMatch(/type="radio"[^>]*name="answerKind"/);
  expect(html).toMatch(/type="radio"[^>]*name="answer"/);
  expect(html).toContain("Registrar decisão");
  expect(html).not.toContain("answerLivre");
  expect((html.match(/Registrar decisão/g) ?? []).length).toBe(1);
});

it("should reopen the decision rail on desktop and restore its collapsed mobile state", async () => {
  const serverHtml = renderToStaticMarkup(<PalcoView state={stoppedSpecReview} connected />);
  expect(serverHtml).toMatch(/<details[^>]*open/);

  window.happyDOM.setViewport({ width: 768, height: 1024 });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(<PalcoView state={stoppedSpecReview} connected />));
    const details = container.querySelector("details");
    const summary = details?.querySelector("summary");
    if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) {
      throw new Error("expected the Palco decision rail disclosure");
    }

    await act(async () => summary.click());
    expect(details.open).toBe(false);

    await act(async () => window.happyDOM.setViewport({ width: 1280, height: 800 }));
    expect(details.open).toBe(true);

    await act(async () => window.happyDOM.setViewport({ width: 768, height: 1024 }));
    expect(details.open).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.happyDOM.setViewport({ width: 1024, height: 768 });
  }
});
