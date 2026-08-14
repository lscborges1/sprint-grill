"use client";

import type { CeremonyDumpState, RefinementPhase } from "@sprint-griller/ceremony";
import { CEREMONY_ESTIMATES } from "@sprint-griller/ceremony/estimate";
import { useDumpGate } from "./use-dump-gate";

export interface DumpGateProps {
  readonly sessionId: string;
  readonly phase: RefinementPhase;
  readonly dump: CeremonyDumpState;
}

export function DumpGate({ sessionId, phase, dump }: DumpGateProps) {
  const gate = useDumpGate(dump);

  if (gate.view.status === "completed") {
    return <p role="status" className="rounded-lg border border-line px-5 py-4">Publicação concluída.</p>;
  }
  if (gate.view.status === "publishing") {
    return <p role="status" className="rounded-lg border border-line px-5 py-4">Publicação em andamento…</p>;
  }
  if (phase !== "pronto-para-publicar") {
    return <p role="status" className="text-sm text-muted">Aprove a Spec e os Tickets antes de publicar.</p>;
  }

  const retryable = gate.view.status === "retryable";
  return (
    <form action={gate.action} className="flex flex-col items-start gap-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <label htmlFor="estimate" className="flex w-full max-w-xs flex-col gap-2 text-sm">
        Estimativa da squad
        {retryable ? (
          <>
            <input type="hidden" name="estimate" value={gate.view.estimate} />
            <output id="estimate" className="rounded-lg border border-line px-4 py-3 text-base">
              {gate.view.estimate}
            </output>
          </>
        ) : (
          <select
            id="estimate"
            name="estimate"
            required
            disabled={gate.dumping}
            defaultValue=""
            className="rounded-lg border border-line bg-transparent px-4 py-3 text-base"
          >
            <option value="" disabled>Selecione a estimativa</option>
            {CEREMONY_ESTIMATES.map((estimate) => (
              <option key={estimate} value={estimate}>{estimate}</option>
            ))}
          </select>
        )}
      </label>
      <button
        type="submit"
        disabled={gate.dumping}
        className="rounded-xl border border-foreground bg-foreground px-6 py-3 font-medium text-background disabled:opacity-50"
      >
        {gate.dumping ? "Publicando…" : retryable ? "Tentar publicação novamente" : "Publicar"}
      </button>
      {gate.result.status === "error" && (
        <p role="alert" className="text-sm text-red-600">{gate.result.message}</p>
      )}
    </form>
  );
}
