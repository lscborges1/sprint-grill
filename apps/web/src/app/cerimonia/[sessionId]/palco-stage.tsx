"use client";

import type { CeremonyQuestion, PalcoState } from "@sprint-griller/ceremony";
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { Alert, Button, Field, buttonStyles } from "../../../components/ui";
import {
  confirmRefinementAction,
  continueRefiningAction,
  resumeCeremonyAction,
  submitDecisionAction,
} from "../actions";

export function Stage({ state }: { readonly state: PalcoState }) {
  if (state.current.phase === "falhou") {
    return (
      <Alert heading="O Refinamento parou por um erro">{state.current.message}</Alert>
    );
  }
  if (
    state.current.phase === "retomavel" &&
    (state.refinement.phase === "revisando-spec" || state.refinement.phase === "revisando-tickets")
  ) {
    return (
      <Waiting
        heading="O Refinamento está parado"
        action={<ResumeButton sessionId={state.sessionId} />}
      >
        O agente terminou sem submeter o artefato desta etapa. Retomar continua do gate atual.
      </Waiting>
    );
  }
  if (state.refinement.phase === "aguardando-confirmacao") {
    return <ConfirmationGate state={state} />;
  }
  if (state.refinement.phase === "revisando-spec") {
    return <ReviewStage state={state} artifact="Spec" />;
  }
  if (state.refinement.phase === "revisando-tickets") {
    return <ReviewStage state={state} artifact="Tickets" />;
  }
  if (state.refinement.phase === "pronto-para-publicar") {
    return <ReviewStage state={state} artifact="publicação" />;
  }
  if (state.refinement.phase === "publicado") {
    return (
      <Waiting heading="Refinamento publicado">
        A Spec e os Tickets aprovados estão no Azure DevOps.
      </Waiting>
    );
  }

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

    case "revisao-humana":
      return <ReviewStage state={state} artifact="artefato" />;

    case "retomavel":
      return (
        <Waiting
          heading="O Refinamento está parado"
          action={<ResumeButton sessionId={state.sessionId} />}
        >
          O turno do agente não está mais rodando neste processo — as decisões já
          registradas estão salvas. Retomar continua de onde parou.
        </Waiting>
      );

    case "encerrada":
      return (
        <Waiting heading="Refinamento encerrado">
          O agente não tem mais decisões a levantar. Foram {state.decisionCount}{" "}
          {state.decisionCount === 1 ? "decisão registrada" : "decisões registradas"}.
        </Waiting>
      );
  }
}

function ConfirmationGate({ state }: { readonly state: PalcoState }) {
  const [confirmError, confirm, confirming] = useActionState(confirmRefinementAction, null);
  const [continueError, continueAction, continuing] = useActionState(continueRefiningAction, null);
  const busy = confirming || continuing;

  return (
    <section className="flex flex-1 flex-col justify-center gap-6" aria-labelledby="confirmar-refinamento">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Gate coletivo</p>
      <h2 id="confirmar-refinamento" className="font-serif text-3xl tracking-tight">
        A sala confirma que o Refinamento está concluído?
      </h2>
      <p className="max-w-[62ch] text-lg text-muted">
        {state.completionProposal?.summary ?? "O agente propôs encerrar a Agenda do refinamento."}
      </p>
      <div className="flex flex-wrap gap-3">
        <GateForm
          action={confirm}
          label={confirming ? "Confirmando…" : "Confirmar e revisar Spec"}
          disabled={busy}
          state={state}
          primary
        />
        <GateForm
          action={continueAction}
          label={continuing ? "Retomando…" : "Continuar Refinamento"}
          disabled={busy}
          state={state}
        />
      </div>
      {(confirmError ?? continueError) && (
        <p role="alert" className="text-sm text-red-600">{confirmError ?? continueError}</p>
      )}
    </section>
  );
}

function GateForm({
  action,
  label,
  disabled,
  state,
  primary = false,
}: {
  readonly action: (formData: FormData) => void;
  readonly label: string;
  readonly disabled: boolean;
  readonly state: PalcoState;
  readonly primary?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="sessionId" value={state.sessionId} />
      <input type="hidden" name="expectedRevision" value={state.refinement.revision} />
      <Button
        type="submit"
        variant={primary ? "primary" : "secondary"}
        size="lg"
        disabled={disabled}
      >
        {label}
      </Button>
    </form>
  );
}

function ReviewStage({ state, artifact }: { readonly state: PalcoState; readonly artifact: string }) {
  return (
    <Waiting
      heading={`Revisar ${artifact}`}
      action={(
        <Link
          href={`/cerimonia/${state.sessionId}/dossie`}
          target="_blank"
          className={buttonStyles({ variant: "primary", size: "lg", className: "self-start" })}
        >
          Abrir revisão no Dossiê
        </Link>
      )}
    >
      O Refinamento coletivo está aguardando a revisão humana deste gate.
    </Waiting>
  );
}

function Decision({
  state,
  question,
  stalled,
}: {
  readonly state: PalcoState;
  readonly question: CeremonyQuestion;
  readonly stalled: boolean;
}) {
  const [error, submit, pending] = useActionState(submitDecisionAction, null);
  const initialKind = question.options.length > 0 ? "option" : "free-text";
  const [answerKind, setAnswerKind] = useState<"option" | "free-text">(initialKind);
  const hasOptions = question.options.length > 0;

  return (
    <section className="flex flex-1 flex-col justify-center gap-8" aria-labelledby="pergunta" aria-busy={pending}>
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
        <fieldset className="flex flex-wrap gap-3" disabled={pending}>
          <legend className="mb-2 text-sm font-medium">Como a sala quer responder?</legend>
          {hasOptions && (
            <label className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm ${answerKind === "option" ? "border-accent bg-accent/10" : "border-line"}`}>
              <input type="radio" name="answerKind" value="option" checked={answerKind === "option"} onChange={() => setAnswerKind("option")} />
              Escolher uma opção
            </label>
          )}
          {question.allowFreeText && (
            <label className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm ${answerKind === "free-text" ? "border-accent bg-accent/10" : "border-line"}`}>
              <input type="radio" name="answerKind" value="free-text" checked={answerKind === "free-text"} onChange={() => setAnswerKind("free-text")} />
              Escrever outra resposta
            </label>
          )}
        </fieldset>

        {answerKind === "option" && hasOptions ? (
          <fieldset className="flex flex-col gap-3" disabled={pending}>
            <legend className="text-sm font-medium">Opções da pergunta</legend>
            {question.options.map((option) => (
              <label key={option.label} className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-4 py-3 hover:border-accent">
                <input type="radio" name="answer" value={option.label} required />
                <span className="flex flex-col gap-1"><span className="font-medium">{option.label}</span>{option.description && <span className="text-sm text-muted">{option.description}</span>}</span>
              </label>
            ))}
          </fieldset>
        ) : question.allowFreeText ? (
          <Field id="free-text-answer" label="Resposta da sala">
            <input id="free-text-answer" type="text" name="answer" required disabled={pending} className="min-h-11 rounded-[var(--radius-md)] border border-line bg-surface px-3 text-base text-foreground" />
          </Field>
        ) : (
          <p role="status" className="text-sm text-muted">A pergunta não tem uma resposta disponível.</p>
        )}

        <Button type="submit" variant="primary" disabled={pending || (!hasOptions && !question.allowFreeText)} aria-busy={pending}>
          {pending ? "Registrando…" : "Registrar decisão"}
        </Button>

        {stalled && (
          <p className="text-sm text-muted" aria-live="polite">
            O turno do agente caiu. A decisão é registrada do mesmo jeito e retoma a
            sessão de onde parou.
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

function ResumeButton({ sessionId }: { readonly sessionId: string }) {
  const [error, resume, pending] = useActionState(resumeCeremonyAction, null);

  return (
    <form action={resume} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={pending}
        aria-busy={pending}
      >
        Retomar Refinamento
      </Button>
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
  readonly heading: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
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
