import type { PalcoState } from "@sprint-griller/ceremony";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Palco } from "./palco";

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
