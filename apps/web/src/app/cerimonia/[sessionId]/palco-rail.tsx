import type {
  CeremonyDecision,
  CeremonyQuestion,
  PalcoState,
} from "@sprint-griller/ceremony";
import { ResponsiveDetails } from "../../../components/ui";

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

export function DecisionRail({ state }: { readonly state: PalcoState }) {
  const tree = decisionTree(state);
  const pendingCount = state.pendingQuestions.length;

  return (
    <aside className="order-2 border-t border-line bg-background lg:order-1 lg:col-start-1 lg:row-start-1 lg:sticky lg:top-0 lg:min-h-dvh lg:border-r lg:border-t-0">
      <ResponsiveDetails
        className="group lg:contents"
        summary={`Trilho e histórico · ${state.decisions.length} resoluções`}
        summaryClassName="cursor-pointer list-none px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted marker:hidden lg:hidden"
      >
        <div className="flex min-h-0 flex-col gap-5 px-4 pb-6 sm:px-6 sm:pb-7 lg:sticky lg:top-0 lg:min-h-dvh lg:px-6 lg:py-7">
          <div>
            <p className="mb-2 font-mono text-xs text-muted">US #{state.story.id}</p>
            <h2 className="font-serif text-xl leading-snug tracking-tight">{state.story.title}</h2>
          </div>

          <section className="flex min-h-0 flex-1 flex-col gap-3" aria-labelledby="arvore-de-decisoes">
            <h3 id="arvore-de-decisoes" className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Agenda do refinamento
            </h3>
            {state.agenda.length === 0 ? (
              <p className="text-sm text-muted">A Agenda do refinamento está vazia.</p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Agenda do refinamento">
                {state.agenda.map((item) => (
                  <li key={item.id} className="rounded-lg border border-line px-3 py-2.5 text-sm">
                    <p>{item.question}</p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-muted">
                      {agendaStatus(item.status)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Resoluções da sala
            </h3>
            {tree.length === 0 ? (
              <p className="text-sm text-muted">O agente ainda não levantou decisões.</p>
            ) : (
              <ol className="flex min-h-0 flex-col gap-2 overflow-y-auto" aria-label="Resoluções do Refinamento">
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
            <strong className="font-medium text-foreground">{state.agenda.length}</strong>{" "}
            {state.agenda.length === 1 ? "item na Agenda" : "itens na Agenda"} ·{" "}
            {pendingCount} {pendingCount === 1 ? "pergunta ativa" : "perguntas ativas"}
          </p>
        </div>
      </ResponsiveDetails>
    </aside>
  );
}

function agendaStatus(status: PalcoState["agenda"][number]["status"]): string {
  return {
    aberto: "Aberto",
    pesquisando: "Em pesquisa",
    "aguardando-sala": "Aguardando a sala",
    resolvido: "Resolvido",
    "fora-de-escopo": "Fora de escopo",
  }[status];
}

function DecidedNode({ decision }: { readonly decision: CeremonyDecision }) {
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

function PendingNode({ question, current }: { readonly question: CeremonyQuestion; readonly current: boolean }) {
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

export function Progress({ state }: { readonly state: PalcoState }) {
  const tree = decisionTree(state);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Progresso do Refinamento">
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
