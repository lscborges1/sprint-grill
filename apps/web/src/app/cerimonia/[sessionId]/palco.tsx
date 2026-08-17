"use client";

// Subpath de propósito: o barril do pacote puxa o store, e o binding nativo do
// SQLite não existe no bundle do cliente.
import { palcoStateSchema } from "@sprint-griller/ceremony/palco-state";
import type { PalcoState } from "@sprint-griller/ceremony";
import Link from "next/link";
import { useState } from "react";
import { useLiveState } from "@/components/live-state";
import { ThemeSelector } from "../../../components/theme-selector";
import { Button } from "../../../components/ui";
import { Doubts } from "./palco-consultation";
import { DecisionRail, Progress } from "./palco-rail";
import { Stage } from "./palco-stage";

/**
 * Modo Palco: o que a sala inteira acompanha, projetado. Tipografia legível a
 * distância é requisito, não estética — a pergunta é o maior elemento da tela,
 * e a recomendação vem junto para ninguém decidir do zero.
 *
 * Referência visual: variante A do protótipo do ticket 12, com a barra de
 * progresso da variante C. A sala se orienta sozinha pelo trilho lateral (o que
 * já foi decidido, o que falta) e resolve dúvida de fato sem sair da tela.
 */
export function Palco({ initial }: { readonly initial: PalcoState }) {
  const { state, connected } = useLiveState(
    `/api/cerimonia/${initial.sessionId}/stream`,
    palcoStateSchema,
    initial,
    { schemaName: "palcoStateSchema", sessionId: initial.sessionId },
  );

  return <PalcoView state={state} connected={connected} />;
}

/** Projeção pura do Palco: não abre SSE nem conhece o estado inicial do servidor. */
export function PalcoView({ state, connected }: { readonly state: PalcoState; readonly connected: boolean }) {
  const [focusMode, setFocusMode] = useState(false);

  return (
    <div className={`mx-auto grid min-h-dvh w-full max-w-[1440px] grid-cols-1 lg:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)] ${focusMode ? "palco-focus" : ""}`}>
      <main className="order-1 flex min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 lg:col-start-2 lg:row-start-1 lg:px-[7vw] lg:py-10">
        <header className="flex flex-col gap-5 border-b border-line pb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Refinamento coletivo · US #{state.story.id}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/investigacao/${state.story.id}`} className="text-sm text-muted underline underline-offset-4">ver a Investigação</Link>
              {!focusMode && <Link href={`/cerimonia/${state.sessionId}/dossie`} target="_blank" className="text-sm text-muted underline underline-offset-4">abrir o Dossiê</Link>}
              <ThemeSelector />
              <Button type="button" size="sm" variant="quiet" onClick={() => setFocusMode((value) => !value)} aria-pressed={focusMode}>{focusMode ? "Sair do foco" : "Modo foco"}</Button>
            </div>
          </div>
          <h1 className="font-serif text-2xl tracking-tight">{state.story.title}</h1>
          <Progress state={state} />
          {!connected && (
            <p role="alert" aria-live="polite" className="text-sm text-muted">
              Sem conexão com o Refinamento — o que está na tela pode estar
              desatualizado. Reconectando…
            </p>
          )}
        </header>

        <div aria-live="polite" aria-busy={state.current.phase === "pensando"}>
          <Stage state={state} />
        </div>

        <Doubts state={state} />

        {state.lastDecision && (
          <footer className="mt-auto border-t border-line pt-5 text-sm text-muted">
            Última Resolução: <strong className="font-medium">{state.lastDecision.answer}</strong>
            {" · "}{formatWhen(state.lastDecision.decidedAt)}
          </footer>
        )}
      </main>
      <DecisionRail state={state} />
    </div>
  );
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
