"use client";

// Subpath de propósito: o barril do pacote puxa o store, e o binding nativo do
// SQLite não existe no bundle do cliente.
import { palcoStateSchema } from "@sprint-griller/ceremony/palco-state";
import type {
  CeremonyCitation,
  CeremonyConsultation,
  CeremonyDecision,
  CeremonyQuestion,
  PalcoState,
} from "@sprint-griller/ceremony";
import Link from "next/link";
import { useActionState } from "react";
import { useLiveState } from "@/components/live-state";
import { askFactAction, resumeCeremonyAction, submitDecisionAction } from "../actions";

/**
 * Modo Palco: o que a sala inteira acompanha, projetado. Tipografia legível a
 * distância é requisito, não estética — a pergunta é o maior elemento da tela,
 * e a recomendação vem junto para ninguém decidir do zero.
 *
 * Referência visual: variante A do protótipo do ticket 12, com a barra de
 * progresso da variante C. A sala se orienta sozinha pelo trilho lateral (o que
 * já foi decidido, o que falta) e resolve dúvida de fato sem sair da tela.
 */
export function Palco({ initial }: { initial: PalcoState }) {
  const { state, connected } = useLiveState(
    `/api/cerimonia/${initial.sessionId}/stream`,
    palcoStateSchema,
    initial,
  );

  return (
    <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] lg:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)]">
      <DecisionRail state={state} />

      <main className="flex min-w-0 flex-col gap-10 px-[6vw] py-8 lg:px-[7vw] lg:py-12">
        <header className="flex flex-col gap-5 border-b border-line pb-6">
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
            <Link
              href={`/cerimonia/${state.sessionId}/dossie`}
              target="_blank"
              className="text-sm text-muted underline underline-offset-4"
            >
              abrir o Dossiê
            </Link>
          </div>
          <h1 className="font-serif text-2xl tracking-tight">{state.story.title}</h1>
          <Progress state={state} />
          {!connected && (
            <p role="alert" className="text-sm text-muted">
              Sem conexão com a cerimônia — o que está na tela pode estar
              desatualizado. Reconectando…
            </p>
          )}
        </header>

        <Stage state={state} />

        <LiveFacts state={state} />

        {state.lastDecision && (
          <footer className="mt-auto border-t border-line pt-5 text-sm text-muted">
            Última decisão: <strong className="font-medium">{state.lastDecision.answer}</strong> —{" "}
            {state.lastDecision.decidedBy}, {formatWhen(state.lastDecision.decidedAt)}
          </footer>
        )}
      </main>
    </div>
  );
}

/**
 * A árvore de decisões: o que a sala já decidiu, depois o que ela ainda tem
 * pela frente, com a pergunta da vez marcada.
 *
 * O trilho e a barra de progresso leem daqui, não cada um por si — são a mesma
 * árvore em duas densidades, e divergirem seria a sala vendo dois placares.
 */
function decisionTree(state: PalcoState): readonly DecisionNode[] {
  const currentQuestionId = currentQuestionIdOf(state);

  return [
    ...state.decisions.map(
      (decision) => ({ key: `question-${decision.questionSeq}`, status: "decidida", decision }) as const,
    ),
    ...state.pendingQuestions.map(
      (question) =>
        ({
          key: `question-${question.questionSeq}`,
          status: question.id === currentQuestionId ? "atual" : "aberta",
          question,
        }) as const,
    ),
  ];
}

type DecisionNode =
  | { readonly key: string; readonly status: "decidida"; readonly decision: CeremonyDecision }
  | {
      readonly key: string;
      readonly status: "atual" | "aberta";
      readonly question: CeremonyQuestion;
    };

function DecisionRail({ state }: { state: PalcoState }) {
  const tree = decisionTree(state);
  const pendingCount = state.pendingQuestions.length;

  return (
    <aside className="flex min-h-0 flex-col gap-5 border-b border-line bg-background px-6 py-7 lg:sticky lg:top-0 lg:min-h-dvh lg:border-r lg:border-b-0">
      <div>
        <p className="mb-2 font-mono text-xs text-muted">US #{state.story.id}</p>
        <h2 className="font-serif text-xl leading-snug tracking-tight">{state.story.title}</h2>
      </div>

      <section className="flex min-h-0 flex-1 flex-col gap-3" aria-labelledby="arvore-de-decisoes">
        <h3 id="arvore-de-decisoes" className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Árvore de decisões
        </h3>
        {tree.length === 0 ? (
          <p className="text-sm text-muted">O agente ainda não levantou decisões.</p>
        ) : (
          <ol className="flex min-h-0 flex-col gap-2 overflow-y-auto" aria-label="Decisões da cerimônia">
            {tree.map((node) =>
              node.status === "decidida" ? (
                <DecidedNode key={node.key} decision={node.decision} />
              ) : (
                <PendingNode
                  key={node.key}
                  question={node.question}
                  current={node.status === "atual"}
                />
              ),
            )}
          </ol>
        )}
      </section>

      <p className="border-t border-line pt-4 text-sm text-muted">
        <strong className="font-medium text-foreground">{pendingCount}</strong>{" "}
        {pendingCount === 1 ? "dúvida aberta" : "dúvidas abertas"}
      </p>
    </aside>
  );
}

function DecidedNode({ decision }: { decision: CeremonyDecision }) {
  return (
    <li className="rounded-lg bg-foreground/[0.04] px-3 py-2.5 text-sm leading-snug">
      <p className="flex gap-2 text-muted">
        <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-600" />
        {decision.question}
      </p>
      <p className="mt-1 pl-3.5 font-medium">{decision.answer}</p>
    </li>
  );
}

function PendingNode({ question, current }: { question: CeremonyQuestion; current: boolean }) {
  return (
    <li
      className={`rounded-lg px-3 py-2.5 text-sm leading-snug ${
        current ? "bg-accent/10 font-medium" : "border border-dashed border-line text-muted"
      }`}
      aria-current={current ? "step" : undefined}
    >
      <p className="flex gap-2">
        <span
          aria-hidden="true"
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
            current ? "bg-accent" : "border border-muted"
          }`}
        />
        {question.question}
      </p>
    </li>
  );
}

const SEGMENT = {
  decidida: { className: "bg-emerald-600", label: "Decisão registrada" },
  atual: { className: "bg-accent", label: "Decisão em discussão" },
  aberta: { className: "bg-line", label: "Decisão pendente" },
} as const;

function Progress({ state }: { state: PalcoState }) {
  const tree = decisionTree(state);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Progresso da cerimônia">
      {tree.length > 0 && (
        <ol
          className="flex gap-1"
          aria-label={`${state.decisions.length} decisões registradas de ${tree.length}`}
        >
          {tree.map((node) => (
            <li
              key={node.key}
              className={`h-1.5 w-6 rounded-full ${SEGMENT[node.status].className}`}
              aria-label={SEGMENT[node.status].label}
            />
          ))}
        </ol>
      )}
      <p className="text-sm text-muted">
        <strong className="font-medium text-foreground">{state.decisionCount}</strong>{" "}
        {state.decisionCount === 1 ? "decisão" : "decisões"} ·{" "}
        <strong className="font-medium text-foreground">{state.pendingQuestions.length}</strong>{" "}
        {state.pendingQuestions.length === 1 ? "pendência" : "pendências"}
      </p>
    </div>
  );
}

function currentQuestionIdOf(state: PalcoState): string | undefined {
  return state.current.phase === "perguntando" ? state.current.question.id : undefined;
}

/**
 * Fato ao vivo: o que mata o "alguém verifica depois". Dúvida factual que surge
 * na sala é disparada aqui, o agente lê o código na hora e volta com a resposta
 * e o arquivo que a sustenta.
 *
 * Fica fora do Palco da decisão de propósito: a pergunta que a sala está
 * decidindo continua projetada enquanto o fato é buscado, e a resposta **não**
 * é Registro de decisão — ninguém decidiu nada, o repositório respondeu.
 */
function LiveFacts({ state }: { state: PalcoState }) {
  const over = state.current.phase === "encerrada" || state.current.phase === "falhou";
  if (over && !state.consultation) return null;

  return (
    <section
      aria-labelledby="fato-ao-vivo"
      className="flex flex-col gap-5 rounded-xl border border-line px-6 py-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="fato-ao-vivo" className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Fato ao vivo
        </h2>
        <p className="text-sm text-muted">
          O agente lê o código agora — a resposta é fato, não decisão da sala.
        </p>
      </div>

      {state.consultation && <Consultation consultation={state.consultation} />}
      {!over && (
        <FactForm
          // Consulta nova é campo limpo: sem a `key`, a dúvida anterior fica no input.
          key={state.consultation?.id ?? "primeira"}
          sessionId={state.sessionId}
          // Uma de cada vez: o Palco só projeta a última, e outra no meio da busca
          // faria a resposta anterior sumir da tela.
          looking={state.consultation?.status === "buscando"}
        />
      )}
    </section>
  );
}

function Consultation({ consultation }: { consultation: CeremonyConsultation }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted">{consultation.question}</p>

      {consultation.status === "buscando" && (
        <p role="status" className="text-lg">
          O agente está lendo o código…
        </p>
      )}

      {consultation.status === "falhou" && (
        <p role="alert" className="text-lg text-red-600">
          A consulta não voltou: {consultation.message}
        </p>
      )}

      {(consultation.status === "respondida" || consultation.status === "sem-lastro") && (
        <>
          <p className="max-w-[62ch] text-[clamp(19px,1.7vw,23px)] leading-snug">
            {consultation.answer}
          </p>
          {consultation.citations.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {consultation.citations.map((citation) => (
                <li
                  key={formatCitation(citation)}
                  className="rounded-md border border-line px-2.5 py-1 font-mono text-xs text-muted"
                >
                  {formatCitation(citation)}
                </li>
              ))}
            </ul>
          )}
          {consultation.status === "sem-lastro" && (
            // Resposta sem lastro continua na tela, marcada: o que ela não pode é
            // sair da sala como fato conferido.
            <p role="alert" className="max-w-[62ch] border-l-[3px] border-amber-600 pl-4 text-sm">
              <strong className="font-medium">Não verificado</strong> — {consultation.motivo} Trate
              como suspeita até alguém abrir o arquivo.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FactForm({
  sessionId,
  looking,
}: {
  sessionId: string;
  /** Já tem consulta em voo — o submit fica fechado até ela terminar. */
  looking: boolean;
}) {
  const [error, ask, pending] = useActionState(askFactAction, null);
  const blocked = pending || looking;

  return (
    <form action={ask} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
        Dúvida de fato da sala
        <input
          type="text"
          name="question"
          required
          disabled={blocked}
          placeholder="O contrato de CreateOrder já tem campo de parcelas?"
          className="min-w-64 rounded-lg border border-line bg-transparent px-4 py-2.5 text-base text-foreground disabled:opacity-50"
        />
      </label>
      <button
        type="submit"
        disabled={blocked}
        className="rounded-xl border border-line px-6 py-2.5 text-base font-medium disabled:opacity-50"
      >
        Perguntar ao agente
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * `repo · caminho → símbolo`: o `·` é o mesmo separador das evidências que o
 * agente manda com cada pergunta (elas dividem a tela com estas), e o `→` é o
 * do `formatCitation` da Investigação. Não dá para importar aquele aqui — o
 * barril do pacote arrasta o runtime do agente para o bundle do cliente.
 */
function formatCitation(citation: CeremonyCitation): string {
  const file = `${citation.repo} · ${citation.path}`;
  return citation.symbol === undefined ? file : `${file} → ${citation.symbol}`;
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

function formatWhen(at: number): string {
  return new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
