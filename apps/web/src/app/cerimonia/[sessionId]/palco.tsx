"use client";

// Subpath de propósito: o barril do pacote puxa o store, e o binding nativo do
// SQLite não existe no bundle do cliente.
import { palcoStateSchema } from "@sprint-griller/ceremony/palco-state";
import type { CeremonyQuestion, PalcoState } from "@sprint-griller/ceremony";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { resumeCeremonyAction, submitDecisionAction } from "../actions";

/**
 * Modo Palco: o que a sala inteira acompanha, projetado. Tipografia legível a
 * distância é requisito, não estética — a pergunta é o maior elemento da tela,
 * e a recomendação vem junto para ninguém decidir do zero.
 *
 * Referência visual: variante A do protótipo do ticket 12. A árvore de decisões
 * e a barra de progresso são LSC-59; aqui é só a decisão da vez.
 */
export function Palco({ initial }: { initial: PalcoState }) {
  const { state, connected } = useLivePalco(initial);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1100px] flex-1 flex-col gap-10 px-[6vw] py-12">
      <header className="flex flex-col gap-2 border-b border-line pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
            Grilling coletivo · US #{state.story.id}
          </p>
          <Link
            href={`/investigacao/${state.story.id}`}
            className="text-sm text-muted underline underline-offset-4"
          >
            ver a Investigação
          </Link>
        </div>
        <h1 className="font-serif text-2xl tracking-tight">{state.story.title}</h1>
        {!connected && (
          <p role="alert" className="text-sm text-muted">
            Sem conexão com a cerimônia — o que está na tela pode estar
            desatualizado. Reconectando…
          </p>
        )}
      </header>

      <Stage state={state} />

      {state.lastDecision && (
        <footer className="mt-auto border-t border-line pt-5 text-sm text-muted">
          Última decisão: <strong className="font-medium">{state.lastDecision.answer}</strong> —{" "}
          {state.lastDecision.decidedBy}, {formatWhen(state.lastDecision.decidedAt)}
        </footer>
      )}
    </main>
  );
}

function Stage({ state }: { state: PalcoState }) {
  switch (state.current.phase) {
    case "perguntando":
      return (
        <Decision
          // Pergunta nova é formulário novo: sem a `key`, o React reaproveita os
          // inputs e o texto digitado para a pergunta anterior vira a resposta desta.
          key={state.current.question.id}
          state={state}
          question={state.current.question}
          // Sem turno vivo a resposta não destrava o agente: ela retoma a cerimônia.
          stalled={!state.live}
        />
      );

    case "pensando":
      return (
        <Waiting heading="O agente está lendo o código…">
          Fato o agente busca sozinho. A próxima pergunta aparece aqui quando ela for
          uma decisão da sala.
        </Waiting>
      );

    case "retomavel":
      return (
        <Waiting
          heading="A cerimônia está parada"
          action={<ResumeButton sessionId={state.sessionId} />}
        >
          O turno do agente não está mais rodando neste processo — as decisões já
          registradas estão salvas. Retomar continua de onde parou.
        </Waiting>
      );

    case "encerrada":
      return (
        <Waiting heading="Cerimônia encerrada">
          O agente não tem mais decisões a levantar. Foram {state.decisionCount}{" "}
          {state.decisionCount === 1 ? "decisão registrada" : "decisões registradas"}.
        </Waiting>
      );

    case "falhou":
      return (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-red-600/50 bg-red-600/5 px-6 py-5"
        >
          <p className="text-2xl font-medium tracking-tight">A cerimônia parou por um erro</p>
          <p className="text-base text-muted">{state.current.message}</p>
        </div>
      );
  }
}

function Decision({
  state,
  question,
  stalled,
}: {
  state: PalcoState;
  question: CeremonyQuestion;
  stalled: boolean;
}) {
  const [error, submit, pending] = useActionState(submitDecisionAction, null);

  return (
    <section className="flex flex-1 flex-col justify-center gap-8" aria-labelledby="pergunta">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
        Decisão {state.decisionCount + 1} · {question.header}
      </p>

      <h2
        id="pergunta"
        className="max-w-[22ch] font-serif text-[clamp(30px,3.6vw,46px)] leading-[1.18] tracking-tight"
      >
        {question.question}
      </h2>

      <p className="max-w-[62ch] border-l-[3px] border-accent pl-5 text-lg leading-relaxed text-muted">
        <strong className="font-medium text-foreground">Recomendação do agente:</strong>{" "}
        {question.recommendation}
      </p>

      {question.evidence.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {question.evidence.map((evidence) => (
            <li
              key={evidence}
              className="rounded-md border border-line px-2.5 py-1 font-mono text-xs text-muted"
            >
              {evidence}
            </li>
          ))}
        </ul>
      )}

      <form action={submit} className="flex flex-col gap-5">
        <input type="hidden" name="sessionId" value={state.sessionId} />
        <input type="hidden" name="questionId" value={question.id} />

        {question.options.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {question.options.map((option) => (
              <button
                key={option.label}
                type="submit"
                name="answer"
                value={option.label}
                disabled={pending}
                className="flex flex-col items-start gap-1 rounded-xl border border-foreground bg-foreground px-6 py-3.5 text-left text-background disabled:opacity-50"
              >
                <span className="text-base font-medium">{option.label}</span>
                {/* Projetado: o porquê da opção fica na tela, não num tooltip. */}
                {option.description && (
                  <span className="text-sm opacity-75">{option.description}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4">
          {question.allowFreeText && (
            <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
              Outra resposta
              <input
                type="text"
                name="answerLivre"
                className="min-w-64 rounded-lg border border-line bg-transparent px-4 py-2.5 text-base text-foreground"
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Quem decidiu
            <input
              type="text"
              name="decidedBy"
              required
              defaultValue={state.lastDecision?.decidedBy ?? ""}
              placeholder="PO, squad, PO + squad…"
              className="w-56 rounded-lg border border-line bg-transparent px-4 py-2.5 text-base text-foreground"
            />
          </label>

          <button
            type="submit"
            disabled={pending}
            className="rounded-xl border border-line px-6 py-3.5 text-base font-medium disabled:opacity-50"
          >
            Registrar decisão
          </button>
        </div>

        {stalled && (
          <p className="text-sm text-muted">
            O turno do agente caiu. A decisão é registrada do mesmo jeito e retoma a
            cerimônia de onde parou.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function ResumeButton({ sessionId }: { sessionId: string }) {
  const [error, resume, pending] = useActionState(resumeCeremonyAction, null);

  return (
    <form action={resume} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-xl border border-foreground bg-foreground px-6 py-3.5 text-base font-medium text-background disabled:opacity-50"
      >
        Retomar cerimônia
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

function Waiting({
  heading,
  action,
  children,
}: {
  heading: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section role="status" className="flex flex-1 flex-col justify-center gap-5">
      <h2 className="font-serif text-[clamp(26px,2.6vw,34px)] leading-tight tracking-tight">
        {heading}
      </h2>
      <p className="max-w-[62ch] text-lg text-muted">{children}</p>
      {action}
    </section>
  );
}

/**
 * O estado chega empurrado por SSE — entre uma pergunta e a próxima a sala não
 * fica olhando tela parada nem esperando polling. O estado inicial veio do
 * servidor, então a tela já nasce certa mesmo antes da conexão abrir.
 *
 * `connected` existe porque tela projetada mentindo é pior que tela em branco:
 * sem conexão, o que está ali pode já ter mudado, e a sala precisa saber.
 */
function useLivePalco(initial: PalcoState): {
  state: PalcoState;
  connected: boolean;
} {
  const [state, setState] = useState(initial);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const source = new EventSource(`/api/cerimonia/${initial.sessionId}/stream`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event: MessageEvent<string>) => {
      setState(palcoStateSchema.parse(JSON.parse(event.data)));
      setConnected(true);
    };

    return () => source.close();
  }, [initial.sessionId]);

  return { state, connected };
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
