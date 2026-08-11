"use client";

// Subpath de propósito: o barril do pacote puxa o store, e o binding nativo do
// SQLite não existe no bundle do cliente.
import { SPEC_SECTIONS, dossieStateSchema } from "@sprint-griller/ceremony/session-state";
import { formatDecisionWhen, readSpecSection } from "@sprint-griller/ceremony/spec";
import { validateTaskDraft } from "@sprint-griller/ceremony/task-draft";
import type { CeremonyDecision, DossieState } from "@sprint-griller/ceremony";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useLiveState } from "@/components/live-state";
import { Section } from "@/components/section";
import { useSpecEditor } from "./use-spec-editor";
import { dumpCeremonyAction } from "../../actions";
import { DUMP_INITIAL_STATE } from "../../spec-draft-action-state";

/**
 * Modo Dossiê: a aba do Operador. A Spec da US se forma aqui ao vivo enquanto a
 * sala decide no Palco, e o Markdown que o despejo vai gravar fica editável —
 * a IA redige, o humano assina.
 *
 * Esta tela não é projetada: o que a sala vê é o Palco. Por isso ela pode ser
 * densa, com o documento inteiro e o editor na mesma página.
 *
 * Referência visual: variante B do protótipo do ticket 12.
 */
export function Dossie({ initial }: { initial: DossieState }) {
  const { state, connected } = useLiveState(
    `/api/cerimonia/${initial.sessionId}/dossie/stream`,
    dossieStateSchema,
    initial,
    { schemaName: "dossieStateSchema", sessionId: initial.sessionId },
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-8 py-16">
      <header className="flex flex-col gap-3">
        <Link
          href={`/cerimonia/${state.sessionId}`}
          className="text-sm text-muted underline underline-offset-4"
        >
          ← Voltar ao Palco
        </Link>
        <h1 className="font-serif text-4xl tracking-tight">
          Dossiê — US #{state.story.id}
        </h1>
        <p className="text-lg text-muted">
          {state.story.title} ·{" "}
          <a
            href={state.story.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            abrir no Azure DevOps
          </a>
        </p>
        <p className="text-sm text-muted">
          Esta aba é do Operador: a sala acompanha o Palco, não o documento.
        </p>
        <CeremonyProgress
          decisions={state.decisions}
          pendingCount={state.pending.length}
        />
        {!connected && (
          <p role="alert" className="text-sm text-muted">
            Sem conexão com a cerimônia — o documento pode estar desatualizado.
            Reconectando…
          </p>
        )}
      </header>

      <Section id="decisoes" heading={SPEC_SECTIONS.decisions.heading}>
        <p className="text-sm text-muted">{SPEC_SECTIONS.decisions.blurb}</p>
        {state.decisions.length === 0 ? (
          <p className="text-base text-muted">{SPEC_SECTIONS.decisions.empty}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {state.decisions.map((decision) => (
              <Decided
                key={`${decision.questionId}:${decision.decidedAt}`}
                decision={decision}
                timeZone={state.timeZone}
              />
            ))}
          </ol>
        )}
      </Section>

      <Section id="pendencias" heading={SPEC_SECTIONS.pending.heading}>
        <p className="text-sm text-muted">{SPEC_SECTIONS.pending.blurb}</p>
        {state.pending.length === 0 ? (
          <p className="text-base text-muted">{SPEC_SECTIONS.pending.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {state.pending.map((question) => (
              <li key={question.id} className="rounded-lg border border-line px-5 py-4 text-base">
                {question.question}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="impacto" heading={SPEC_SECTIONS.impact.heading}>
        <p className="text-sm text-muted">{SPEC_SECTIONS.impact.blurb}</p>
        <Inherited text={state.investigation.impact} empty={SPEC_SECTIONS.impact.empty} />
      </Section>

      <Section id="nao-verificado" heading={SPEC_SECTIONS.unverified.heading}>
        <p className="text-sm text-muted">{SPEC_SECTIONS.unverified.blurb}</p>
        <Inherited text={state.investigation.unverified} empty={SPEC_SECTIONS.unverified.empty} />
      </Section>

      <Section id="fora-de-escopo" heading={SPEC_SECTIONS.outOfScope.heading}>
        <p className="text-sm text-muted">{SPEC_SECTIONS.outOfScope.blurb}</p>
        <Inherited
          text={operatorOutOfScope(state.spec.draft?.markdown ?? "")}
          empty={SPEC_SECTIONS.outOfScope.empty}
        />
      </Section>

      <SpecEditor
        sessionId={state.sessionId}
        storyUrl={state.story.url}
        spec={state.spec}
        pending={state.pending}
        taskPreview={state.taskPreview}
        dumpInputs={state.dumpInputs}
        dumpedAt={state.dumpedAt}
        ceremonyStatus={state.status}
      />
    </main>
  );
}

/** Resumo sempre visível: decisões registradas e trabalho que ainda está aberto. */
function CeremonyProgress({
  decisions,
  pendingCount,
}: {
  decisions: readonly CeremonyDecision[];
  pendingCount: number;
}) {
  const decisionCount = decisions.length;
  const pendingLabel =
    pendingCount === 0
      ? "Sem pendências"
      : `${pendingCount} ${pendingCount === 1 ? "pendência" : "pendências"}`;

  return (
    <section
      aria-label="Progresso da cerimônia"
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line px-5 py-4"
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Progresso da cerimônia</p>
        {decisionCount === 0 ? (
          <p className="text-sm text-muted">Nenhuma decisão registrada ainda.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {decisionCount}{" "}
              {decisionCount === 1 ? "decisão registrada" : "decisões registradas"}
            </p>
            {/* As barras repetem, em forma, a contagem que a linha acima já diz. */}
            <div aria-hidden="true" className="flex gap-1.5">
              {decisions.map((decision) => (
                <span
                  key={`${decision.questionId}:${decision.decidedAt}`}
                  className="h-2 w-8 rounded-full bg-accent"
                />
              ))}
            </div>
          </>
        )}
      </div>
      <a
        href="#pendencias"
        className="text-sm font-medium underline underline-offset-4"
      >
        {pendingLabel}
      </a>
    </section>
  );
}

function Decided({
  decision,
  timeZone,
}: {
  decision: CeremonyDecision;
  timeZone: string;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line px-5 py-4">
      <p className="text-base font-medium">{decision.question}</p>
      <p className="text-base">{decision.answer}</p>
      <p className="text-sm text-muted">
        Recomendação do agente: {decision.recommendation}
      </p>
      <p className="text-sm text-muted">
        {decision.decidedBy} · {formatDecisionWhen(decision.decidedAt, timeZone)}
      </p>
    </li>
  );
}

/** Texto de uma seção do documento, preservado em Markdown para leitura. */
function Inherited({ text, empty }: { text: string; empty: string }) {
  if (text.trim() === "") return <p className="text-base text-muted">{empty}</p>;

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line px-5 py-4 font-mono text-sm">
      {text}
    </pre>
  );
}

/** Mostra no documento vivo o conteúdo de Fora de escopo que foi persistido. */
function operatorOutOfScope(markdown: string): string {
  let content = readSpecSection(markdown, SPEC_SECTIONS.outOfScope.heading);
  const generatedBlurb = SPEC_SECTIONS.outOfScope.blurb;
  const generatedEmpty = `_${SPEC_SECTIONS.outOfScope.empty}_`;

  if (content.startsWith(generatedBlurb)) {
    content = content.slice(generatedBlurb.length).trim();
  }
  if (content.startsWith(generatedEmpty)) {
    content = content.slice(generatedEmpty.length).trim();
  }

  return content;
}

/**
 * O preview do despejo, editável. O texto sai gerado do que a cerimônia gravou;
 * o que o Operador salvar é o que o despejo vai levar.
 *
 * Enquanto ainda não há rascunho nem edição local, o editor acompanha o
 * documento que chega pelo SSE. Depois que o Operador edita ou salva, texto
 * sendo digitado não pode ser sobrescrito por uma decisão que acabou de entrar.
 * Nesse caso, o aviso de desatualizado impede despejar uma Spec sem a última
 * decisão sem que isso fique claro.
 *
 * O mesmo vale entre abas: o SSE atualiza `spec.draft`, mas o textarea fica no
 * que esta aba carregou. Sem o aviso de conflito, salvar aqui apagaria a edição
 * de outra aba sem o Operador perceber. Quem decide o que é eco do próprio save
 * e o que é divergência remota é `reconcileSpecDraft`.
 */
function SpecEditor({
  sessionId,
  storyUrl,
  spec,
  pending,
  taskPreview,
  dumpInputs,
  dumpedAt,
  ceremonyStatus,
}: {
  sessionId: string;
  storyUrl: string;
  spec: DossieState["spec"];
  pending: DossieState["pending"];
  taskPreview: string;
  dumpInputs: DossieState["dumpInputs"];
  dumpedAt: number | undefined;
  ceremonyStatus: DossieState["status"];
}) {
  const {
    adoptRemote,
    base,
    busy,
    conflict,
    error,
    expectedSavedAt,
    markdown,
    regenerate,
    remoteDraftConflict,
    save,
    stale,
    updateMarkdown,
  } = useSpecEditor(spec);
  const dumpLocked = dumpInputs !== undefined;
  const dumpMarkdown = dumpInputs?.markdown ?? markdown;

  return (
    <Section id="despejo" heading="Preview do despejo">
      <p className="text-base text-muted">
        {dumpLocked
          ? "Um despejo parcial já assinou esta Spec — o retry precisa do mesmo texto."
          : "A Spec da US como ela vai para o Azure DevOps. Edite à vontade: nada foi gravado ainda, e o despejo leva o que estiver aqui."}
      </p>

      {conflict !== null && !dumpLocked && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/60 bg-amber-500/5 px-5 py-4"
        >
          <p className="text-base font-medium">
            {remoteDraftConflict
              ? "Outra aba salvou uma edição diferente"
              : "Outra aba regenerou o documento"}
          </p>
          <p className="text-sm text-muted">
            {remoteDraftConflict
              ? "Salvar daqui apagaria o que está gravado. Traga a edição remota ou confirme que quer sobrescrever."
              : "O rascunho gravado foi descartado. Traga o documento vivo ou salve o texto desta aba de novo."}
          </p>
          <button
            type="button"
            onClick={adoptRemote}
            className="self-start rounded-xl border border-line px-5 py-2.5 text-base font-medium"
          >
            {remoteDraftConflict ? "Usar a edição salva" : "Usar o documento vivo"}
          </button>
          {remoteDraftConflict && (
            <button
              type="submit"
              name="overwrite"
              value="true"
              form="spec-editor"
              className="self-start rounded-xl border border-red-700 bg-red-700 px-5 py-2.5 text-base font-medium text-white"
            >
              Confirmar e sobrescrever a edição salva
            </button>
          )}
        </div>
      )}

      {stale && !dumpLocked && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/60 bg-amber-500/5 px-5 py-4"
        >
          <p className="text-base font-medium">A cerimônia andou depois desta edição</p>
          <p className="text-sm text-muted">
            O documento vivo acima tem decisão que este texto não tem. Traga as
            novas — regenerar descarta a edição.
          </p>
          <Regenerate
            sessionId={sessionId}
            expectedSavedAt={expectedSavedAt}
            action={regenerate}
            pending={busy || remoteDraftConflict}
          />
        </div>
      )}

      <form id="spec-editor" action={save} className="flex flex-col gap-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="base" value={base} />
        <input type="hidden" name="expectedSavedAt" value={expectedSavedAt ?? ""} />
        <label className="sr-only" htmlFor="markdown">
          Markdown da Spec da US
        </label>
        <textarea
          id="markdown"
          name="markdown"
          value={dumpMarkdown}
          disabled={busy || dumpLocked}
          readOnly={dumpLocked}
          onChange={(event) => updateMarkdown(event.target.value)}
          rows={24}
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-transparent px-5 py-4 font-mono text-sm leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={busy || dumpLocked}
            className="rounded-xl border border-foreground bg-foreground px-6 py-3 text-base font-medium text-background disabled:opacity-50"
          >
            Salvar edição
          </button>
          <span className="text-sm text-muted">
            {dumpLocked
              ? "Spec assinada no despejo parcial."
              : spec.draft
                ? `Editado por último às ${formatSavedAt(spec.draft.savedAt)}.`
                : "Sem edição salva: o texto acima é o gerado da cerimônia."}
          </span>
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>

      {/* Sem isto, uma edição salva não teria volta enquanto a cerimônia não
          andasse — o Operador ficaria preso ao próprio rascunho. */}
      {spec.draft && !stale && !dumpLocked && (
        <Regenerate
          sessionId={sessionId}
          expectedSavedAt={expectedSavedAt}
          action={regenerate}
          pending={busy || remoteDraftConflict}
        />
      )}

      <DumpGate
        key={dumpInputs?.tasksMarkdown ?? taskPreview}
        sessionId={sessionId}
        storyUrl={storyUrl}
        markdown={dumpMarkdown}
        base={base}
        pending={pending}
        taskPreview={taskPreview}
        dumpInputs={dumpInputs}
        dumpedAt={dumpedAt}
        ceremonyStatus={ceremonyStatus}
        blocked={busy || conflict !== null || stale}
      />
    </Section>
  );
}

/** Última porta antes de qualquer escrita no tracker: a pendência não some nem bloqueia em silêncio. */
function DumpGate({
  sessionId,
  storyUrl,
  markdown,
  base,
  pending,
  taskPreview,
  dumpInputs,
  dumpedAt,
  ceremonyStatus,
  blocked,
}: {
  sessionId: string;
  storyUrl: string;
  markdown: string;
  base: string;
  pending: DossieState["pending"];
  taskPreview: string;
  dumpInputs: DossieState["dumpInputs"];
  dumpedAt: number | undefined;
  ceremonyStatus: DossieState["status"];
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, dump, dumping] = useActionState(dumpCeremonyAction, DUMP_INITIAL_STATE);
  const hasPending = pending.length > 0;
  const ceremonyClosed = ceremonyStatus === "encerrada";
  const initialTasksMarkdown = dumpInputs?.tasksMarkdown ?? taskPreview;
  const estimateDefault = dumpInputs?.estimate;
  const dumpLocked = dumpInputs !== undefined;
  const [tasksMarkdown, setTasksMarkdown] = useState(initialTasksMarkdown);
  const taskValidation = validateTaskDraft(tasksMarkdown, storyUrl);
  const taskErrors = taskValidation.valid ? [] : taskValidation.errors;

  if (dumpedAt !== undefined || result.status === "success") {
    return (
      <p role="status" className="rounded-lg border border-line px-5 py-4 text-sm text-muted">
        Despejo concluído: a Spec, as Tasks, a estimativa e os Registros estão na US.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {!ceremonyClosed && (
          <p role="status" className="text-sm text-muted">
            O despejo fica disponível quando a cerimônia for encerrada.
          </p>
        )}
        <button
          type="button"
          disabled={blocked || !ceremonyClosed}
          onClick={() => setOpen(true)}
          className="self-start rounded-xl border border-foreground bg-foreground px-6 py-3 text-base font-medium text-background disabled:opacity-50"
        >
          Revisar despejo
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby="gate-despejo" className="flex flex-col gap-4 rounded-lg border border-line px-5 py-4">
      <div>
        <h3 id="gate-despejo" className="text-base font-medium">Gate de maturidade</h3>
        <p className="mt-1 text-sm text-muted">
          {hasPending
            ? `${pending.length} ${pending.length === 1 ? "dúvida segue" : "dúvidas seguem"} sem resposta.`
            : "Nenhuma dúvida ficou aberta."}
        </p>
        {dumpLocked && (
          <p role="status" className="mt-2 text-sm text-muted">
            Um despejo parcial já congelou Spec, Tasks e estimativa — o retry precisa dos mesmos valores.
          </p>
        )}
      </div>
      {hasPending && (
        <ul className="flex flex-col gap-2 text-sm">
          {pending.map((question) => <li key={question.id}>{question.question}</li>)}
        </ul>
      )}
      {taskErrors.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 text-sm text-red-600">
          <p>Corrija as falhas estruturais das Tasks antes de despejar:</p>
          <ul className="list-disc pl-5">
            {taskErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}
      <form action={dump} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="markdown" value={markdown} />
        <input type="hidden" name="base" value={base} />
        <label className="flex flex-col gap-2 text-sm" htmlFor="tasks-markdown">
          Tasks agent-ready (Markdown)
          <span className="text-muted">
            Uma Task por <code>## título</code>, com <code>### Critérios de aceite</code>.
            Use <code>### Bloqueada por</code> para referenciar o título de outra Task. Se usar
            <code> conforme discutido</code>, inclua um link Markdown para a Spec desta US.
          </span>
          <textarea
            id="tasks-markdown"
            name="tasksMarkdown"
            required
            disabled={dumping}
            readOnly={dumpLocked}
            value={tasksMarkdown}
            onChange={(event) => setTasksMarkdown(event.target.value)}
            rows={16}
            spellCheck={false}
            className="w-full rounded-lg border border-line bg-transparent px-4 py-3 font-mono text-sm leading-relaxed"
          />
        </label>
        <label className="flex max-w-xs flex-col gap-2 text-sm" htmlFor="estimate">
          Estimativa da squad
          <input
            id="estimate"
            name="estimate"
            type="number"
            min="0.1"
            step="0.5"
            required
            disabled={dumping}
            readOnly={dumpLocked}
            key={`estimate:${estimateDefault ?? "new"}`}
            defaultValue={estimateDefault ?? ""}
            className="rounded-lg border border-line bg-transparent px-4 py-3 text-base"
          />
        </label>
        {hasPending ? (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="confirmPending" value="true" required disabled={dumping} />
            Entendo que estas dúvidas continuarão explícitas na Spec publicada.
          </label>
        ) : (
          <input type="hidden" name="confirmPending" value="true" />
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={dumping || blocked || !ceremonyClosed || taskErrors.length > 0}
            className="self-start rounded-xl border border-foreground bg-foreground px-6 py-3 text-base font-medium text-background disabled:opacity-50"
          >
            {dumping ? "Despejando…" : "Confirmar despejo"}
          </button>
          <button
            type="button"
            disabled={dumping}
            onClick={() => setOpen(false)}
            className="self-start rounded-xl border border-line px-5 py-3 text-base font-medium disabled:opacity-50"
          >
            Voltar à revisão
          </button>
        </div>
        {result.status === "error" && <p role="alert" className="text-sm text-red-600">{result.message}</p>}
      </form>
    </section>
  );
}

/** Joga a edição fora e volta ao documento que a cerimônia gerou. */
function Regenerate({
  sessionId,
  expectedSavedAt,
  action,
  pending,
}: {
  sessionId: string;
  expectedSavedAt: number | null;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  return (
    <form action={action} className="flex">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="expectedSavedAt" value={expectedSavedAt ?? ""} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border border-line px-5 py-2.5 text-base font-medium disabled:opacity-50"
      >
        Regenerar do documento vivo
      </button>
    </form>
  );
}

function formatSavedAt(at: number): string {
  return new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
