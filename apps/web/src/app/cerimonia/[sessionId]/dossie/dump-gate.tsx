"use client";

import type { DossieState } from "@sprint-griller/ceremony";
import { CEREMONY_ESTIMATES } from "@sprint-griller/ceremony/estimate";
import type { ReactElement } from "react";
import { useDumpGate, type DumpGateController } from "./use-dump-gate";

interface DumpGateProps {
  readonly sessionId: string;
  readonly storyUrl: string;
  readonly markdown: string;
  readonly base: string;
  readonly pending: DossieState["pending"];
  readonly taskPreview: string;
  readonly dump: DossieState["dump"];
  readonly ceremonyStatus: DossieState["status"];
  readonly blocked: boolean;
}

/** Última porta antes de qualquer escrita no tracker: a pendência não some nem bloqueia em silêncio. */
export function DumpGate(props: DumpGateProps): ReactElement {
  const gate = useDumpGate(props);

  if (gate.dumpCompleted) return <CompletedDump />;
  if (gate.dumpPublishing) return <PublishingDump />;
  if (!gate.open) {
    return (
      <UnavailableDump
        blocked={props.blocked}
        ceremonyClosed={gate.ceremonyClosed}
        open={gate.openGate}
      />
    );
  }

  return <DumpReviewForm {...props} gate={gate} />;
}

function PublishingDump() {
  return (
    <p role="status" className="rounded-lg border border-line px-5 py-4 text-sm text-muted">
      Despejo em andamento: Spec, Tasks, estimativa e Registros estão sendo publicados.
    </p>
  );
}

function CompletedDump() {
  return (
    <p role="status" className="rounded-lg border border-line px-5 py-4 text-sm text-muted">
      Despejo concluído: a Spec, as Tasks, a estimativa e os Registros estão na US.
    </p>
  );
}

function UnavailableDump({
  blocked,
  ceremonyClosed,
  open,
}: {
  readonly blocked: boolean;
  readonly ceremonyClosed: boolean;
  readonly open: () => void;
}) {
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
        onClick={open}
        className="self-start rounded-xl border border-foreground bg-foreground px-6 py-3 text-base font-medium text-background disabled:opacity-50"
      >
        Revisar despejo
      </button>
    </div>
  );
}

function DumpReviewForm({
  sessionId,
  storyUrl,
  markdown,
  base,
  pending,
  blocked,
  gate,
}: DumpGateProps & { readonly gate: DumpGateController }) {
  const hasPending = pending.length > 0;

  return (
    <section
      aria-labelledby="gate-despejo"
      className="flex flex-col gap-4 rounded-lg border border-line px-5 py-4"
    >
      <div>
        <h3 id="gate-despejo" className="text-base font-medium">Gate de maturidade</h3>
        <p className="mt-1 text-sm text-muted">
          {hasPending
            ? `${pending.length} ${pending.length === 1 ? "dúvida segue" : "dúvidas seguem"} sem resposta.`
            : "Nenhuma dúvida ficou aberta."}
        </p>
        {gate.dumpLocked && (
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
      {gate.taskErrors.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 text-sm text-red-600">
          <p>Corrija as falhas estruturais das Tasks antes de despejar:</p>
          <ul className="list-disc pl-5">
            {gate.taskErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}
      <form action={gate.action} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="markdown" value={markdown} />
        <input type="hidden" name="base" value={base} />
        <label className="flex flex-col gap-2 text-sm" htmlFor="tasks-markdown">
          Tasks agent-ready (Markdown)
          <span className="text-muted">
            Uma Task por <code>## título</code>, com uma descrição e <code>### Critérios de aceite</code>.
            Use <code>### Bloqueada por</code> para referenciar o título de outra Task.
            Toda Task deve conter um link Markdown para a URL exata da Spec desta US: <code>{storyUrl}</code>.
          </span>
          <textarea
            id="tasks-markdown"
            name="tasksMarkdown"
            required
            disabled={gate.dumping}
            readOnly={gate.dumpLocked}
            value={gate.tasksMarkdown}
            onChange={(event) => gate.setTasksMarkdown(event.target.value)}
            rows={16}
            spellCheck={false}
            className="w-full rounded-lg border border-line bg-transparent px-4 py-3 font-mono text-sm leading-relaxed"
          />
        </label>
        <label className="flex max-w-xs flex-col gap-2 text-sm" htmlFor="estimate">
          Estimativa da squad
          {gate.dumpLocked ? (
            <>
              <input type="hidden" name="estimate" value={gate.estimateDefault ?? ""} />
              <output
                id="estimate"
                className="rounded-lg border border-line px-4 py-3 text-base"
              >
                {gate.estimateDefault}
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
        {hasPending ? (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="confirmPending" value="true" required disabled={gate.dumping} />
            Entendo que estas dúvidas continuarão explícitas na Spec publicada.
          </label>
        ) : (
          <input type="hidden" name="confirmPending" value="true" />
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={gate.dumping || blocked || !gate.ceremonyClosed || gate.taskErrors.length > 0}
            className="self-start rounded-xl border border-foreground bg-foreground px-6 py-3 text-base font-medium text-background disabled:opacity-50"
          >
            {gate.dumping ? "Despejando…" : "Confirmar despejo"}
          </button>
          <button
            type="button"
            disabled={gate.dumping}
            onClick={gate.close}
            className="self-start rounded-xl border border-line px-5 py-3 text-base font-medium disabled:opacity-50"
          >
            Voltar à revisão
          </button>
        </div>
        {gate.result.status === "error" && (
          <p role="alert" className="text-sm text-red-600">{gate.result.message}</p>
        )}
      </form>
    </section>
  );
}
