"use client";

import { dossieStateSchema } from "@sprint-griller/ceremony/session-state";
import { formatDecisionWhen } from "@sprint-griller/ceremony/spec";
import type { CeremonyDecision, DossieState } from "@sprint-griller/ceremony";
import Link from "next/link";
import { useActionState, useState } from "react";
import { OperationalFrame } from "@/components/operational-frame";
import { useLiveState } from "@/components/live-state";
import { Section } from "@/components/section";
import { Alert, Button, ConfirmAction, EmptyState, MarkdownPreview, PageHeader, StepProgress } from "@/components/ui";
import type { ProgressState } from "@/components/ui";
import {
  approveSpecAction,
  approveTicketsAction,
  reopenRefinementAction,
} from "../../actions";
import { DumpGate } from "./dump-gate";
import { useSpecEditor } from "./use-spec-editor";
import type { SpecEditorController } from "./use-spec-editor";

const PHASE_LABEL = {
  refinando: "Refinar",
  "aguardando-confirmacao": "Confirmar Refinamento",
  "revisando-spec": "Revisar Spec",
  "revisando-tickets": "Revisar Tickets",
  "pronto-para-publicar": "Publicar",
  publicado: "Publicado",
} as const;

const REFINEMENT_STEPS = [
  { id: "refinar", label: "Refinar" },
  { id: "confirmar", label: "Confirmar" },
  { id: "spec", label: "Spec" },
  { id: "tickets", label: "Tickets" },
  { id: "publicar", label: "Publicar" },
] as const;

type RefinementStepId = (typeof REFINEMENT_STEPS)[number]["id"];

const REFINEMENT_PROGRESS = {
  refinando: { kind: "active", step: "refinar" },
  "aguardando-confirmacao": { kind: "active", step: "confirmar" },
  "revisando-spec": { kind: "active", step: "spec" },
  "revisando-tickets": { kind: "active", step: "tickets" },
  "pronto-para-publicar": { kind: "active", step: "publicar" },
  publicado: { kind: "complete" },
} as const satisfies Record<
  DossieState["refinement"]["phase"],
  ProgressState<RefinementStepId>
>;

export function Dossie({ initial }: { initial: DossieState }) {
  const { state, connected } = useLiveState(
    `/api/cerimonia/${initial.sessionId}/dossie/stream`,
    dossieStateSchema,
    initial,
    { schemaName: "dossieStateSchema", sessionId: initial.sessionId },
  );

  return <DossieView state={state} connected={connected} />;
}

/** Projeção pura do documento: o stream fica restrito ao controller acima. */
export function DossieView({ state, connected }: { readonly state: DossieState; readonly connected: boolean }) {
  return (
    <OperationalFrame>
      <div className="mx-auto grid w-full max-w-[1440px] flex-1 grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-line px-4 py-4 lg:sticky lg:top-0 lg:min-h-[calc(100dvh-4rem)] lg:border-b-0 lg:border-r lg:px-5 lg:py-8">
          <details className="lg:contents" open>
            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.18em] text-muted lg:hidden">Navegação do Dossiê</summary>
            <nav aria-label="Navegação do Dossiê" className="mt-4 flex flex-col gap-2 lg:mt-0">
              <a href="#gate" className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">Gate atual</a>
              <a href="#agenda" className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">Agenda</a>
              <a href="#resolucoes" className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">Resoluções</a>
              <a href="#spec" className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">Spec</a>
              <a href="#tickets" className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">Tickets</a>
              <a href="#publicacao" className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">Publicação</a>
            </nav>
          </details>
        </aside>
        <main className="flex min-w-0 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
          <PageHeader
            eyebrow={`${PHASE_LABEL[state.refinement.phase]} · revisão ${state.refinement.revision}`}
            title={`Dossiê — US #${state.story.id}`}
            back={<Link href={`/cerimonia/${state.sessionId}`} className="text-sm text-muted underline underline-offset-4">← Voltar ao Palco</Link>}
            description={<>{state.story.title} · <a href={state.story.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">abrir no Azure DevOps</a></>}
          />
          {!connected && <p role="alert" aria-live="polite" className="text-sm text-muted">Sem conexão com o Refinamento — o Dossiê pode estar desatualizado. Reconectando…</p>}
          <PhaseGate state={state} />
          <Agenda state={state} />
          <Resolutions decisions={state.decisions} timeZone={state.timeZone} />
          <ArtifactWorkflow state={state} />
        </main>
      </div>
    </OperationalFrame>
  );
}

function PhaseGate({ state }: { readonly state: DossieState }) {
  return (
    <Section id="gate" heading="Gate atual">
      <StepProgress
        steps={REFINEMENT_STEPS}
        progress={REFINEMENT_PROGRESS[state.refinement.phase]}
      />
      <Status heading={PHASE_LABEL[state.refinement.phase]}>
        {state.completionProposal?.summary ?? gateDescription(state.refinement.phase)}
      </Status>
    </Section>
  );
}

function gateDescription(phase: DossieState["refinement"]["phase"]): string {
  return {
    refinando: "O agente e a sala ainda estão levantando e resolvendo pendências.",
    "aguardando-confirmacao": "A sala precisa confirmar o encerramento antes de revisar os artefatos.",
    "revisando-spec": "A Spec está disponível para leitura e aprovação.",
    "revisando-tickets": "Os Tickets estruturados aguardam aprovação.",
    "pronto-para-publicar": "Spec e Tickets aprovados; falta registrar a estimativa e publicar.",
    publicado: "Spec e Tickets aprovados foram publicados no Azure DevOps.",
  }[phase];
}

function Agenda({ state }: { state: DossieState }) {
  return (
    <Section id="agenda" heading="Agenda do refinamento">
      {state.agenda.length === 0 ? (
        <EmptyState heading="Agenda vazia">Nenhuma pendência foi registrada nesta sessão.</EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {state.agenda.map((item) => (
            <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-3 py-4">
              <p>{item.question}</p>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{item.status}</p>
            </li>
          ))}
        </ul>
      )}
      {state.completionProposal && (
        <p className="border-l-2 border-accent pl-4 text-sm text-muted">
          Proposta de conclusão: {state.completionProposal.summary}
        </p>
      )}
    </Section>
  );
}

function Resolutions({ decisions, timeZone }: {
  decisions: readonly CeremonyDecision[];
  timeZone: string;
}) {
  return (
    <Section id="resolucoes" heading="Resoluções">
      {decisions.length === 0 ? (
        <EmptyState heading="Nenhuma resolução registrada">As escolhas da sala aparecerão aqui.</EmptyState>
      ) : (
        <ol className="divide-y divide-line border-y border-line">
          {decisions.map((decision) => (
            <li key={`${decision.questionId}:${decision.decidedAt}`} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)]">
              <div><p className="font-medium">{decision.question}</p><p className="mt-1">{decision.answer}</p></div>
              <div className="text-sm text-muted"><p>Recomendação: {decision.recommendation}</p><p>{formatDecisionWhen(decision.decidedAt, timeZone)}</p></div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function ArtifactWorkflow({ state }: { state: DossieState }) {
  switch (state.refinement.phase) {
    case "refinando":
    case "aguardando-confirmacao":
      return (
        <Status heading="Finalize o Refinamento no Palco">
          A revisão da Spec começa somente depois da confirmação coletiva.
        </Status>
      );
    case "revisando-spec":
      return <SpecReview state={state} />;
    case "revisando-tickets":
      return <TicketsReview state={state} />;
    case "pronto-para-publicar":
      return <PublicationReview state={state} />;
    case "publicado":
      return (
        <Status heading="Refinamento publicado">
          A Spec e os Tickets aprovados foram publicados no Azure DevOps.
        </Status>
      );
  }
}

function SpecReview({ state }: { state: DossieState }) {
  const artifact = state.artifacts.spec;
  if (!artifact) return <Status heading="Aguardando a Spec">O agente está preparando a submissão estruturada.</Status>;
  return <SubmittedSpecReview state={state} revision={artifact.revision} />;
}

function SubmittedSpecReview({ state, revision }: { state: DossieState; revision: number }) {
  const editor = useSpecEditor(state.spec);
  const [editing, setEditing] = useState(false);
  const approvalBlocked = editor.busy || editor.dirty || editor.conflict !== null || editor.stale;

  return (
    <Section id="spec" heading={`Revisar Spec · versão ${revision}`}>
      <div className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-line bg-surface px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Documento</p><p className="mt-1 text-sm text-muted">A leitura é a vista padrão. A edição mantém rascunho, CAS e conflito.</p></div>
          <Button type="button" variant="secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Fechar editor" : "Editar Markdown"}</Button>
        </div>
        {editing ? <SpecEditor state={state} editor={editor} /> : <MarkdownPreview markdown={state.spec.draft?.markdown ?? state.spec.generated} />}
      </div>
      <ArtifactGateForm
        action={approveSpecAction}
        label="Aprovar Spec e gerar Tickets"
        sessionId={state.sessionId}
        revision={state.refinement.revision}
        disabled={approvalBlocked}
      />
      {editor.dirty && <p role="status" className="text-sm text-muted">Salve a edição antes de aprovar.</p>}
      <ReopenForm state={state} />
    </Section>
  );
}

function SpecEditor({ state, editor }: { state: DossieState; editor: SpecEditorController }) {
  const blocked = editor.busy || editor.conflict !== null || editor.stale;

  return (
    <div className="flex flex-col gap-4">
      {(editor.conflict !== null || editor.stale) && (
        <Alert heading="A Spec precisa ser reconciliada" tone="warning">
          <p>A Spec mudou em outra revisão. Recarregue o documento antes de aprovar.</p>
          {editor.remoteDraftConflict ? (
            <Button type="button" size="sm" onClick={editor.adoptRemote}>
              Usar edição salva
            </Button>
          ) : (
            <form action={editor.regenerate}>
              <input type="hidden" name="sessionId" value={state.sessionId} />
              <input type="hidden" name="expectedSavedAt" value={editor.expectedSavedAt ?? ""} />
              <Button type="submit" size="sm">
                Regenerar da versão atual
              </Button>
            </form>
          )}
        </Alert>
      )}
      <form action={editor.save} className="flex flex-col gap-4">
        <input type="hidden" name="sessionId" value={state.sessionId} />
        <input type="hidden" name="base" value={editor.base} />
        <input type="hidden" name="expectedSavedAt" value={editor.expectedSavedAt ?? ""} />
        <label htmlFor="spec-markdown" className="text-sm font-medium">Markdown aprovado da Spec</label>
        <textarea
          id="spec-markdown"
          name="markdown"
          value={editor.markdown}
          onChange={(event) => editor.updateMarkdown(event.target.value)}
          rows={24}
          disabled={editor.busy}
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-transparent px-5 py-4 font-mono text-sm leading-relaxed"
        />
        <Button type="submit" disabled={blocked}>
          {editor.busy ? "Salvando…" : "Salvar edição da Spec"}
        </Button>
        {editor.error && <p role="alert" className="text-sm text-red-600">{editor.error}</p>}
      </form>
    </div>
  );
}

function TicketsReview({ state }: { state: DossieState }) {
  const artifact = state.artifacts.tickets;
  return (
    <Section id="tickets" heading={artifact ? `Revisar Tickets · versão ${artifact.revision}` : "Aguardando Tickets"}>
      {artifact ? (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {artifact.submission.tickets.map((ticket) => (
              <li key={ticket.id} className="flex flex-col gap-3 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3"><h3 className="font-medium">{ticket.id} · {ticket.title}</h3><a href={ticket.specUrl} target="_blank" rel="noreferrer" className="text-sm text-accent underline underline-offset-2">Abrir Spec</a></div>
                <p className="text-sm text-muted">{ticket.description}</p>
                <div className="grid gap-4 text-sm sm:grid-cols-2"><div><h4 className="font-medium">Critérios de aceite</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{ticket.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div><div><h4 className="font-medium">Dependências</h4>{ticket.blockedBy.length === 0 ? <p className="mt-2 text-muted">Nenhuma.</p> : <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{ticket.blockedBy.map((dependency) => <li key={dependency}>{dependency}</li>)}</ul>}</div></div>
              </li>
            ))}
          </ul>
          <ArtifactGateForm
            action={approveTicketsAction}
            label="Aprovar Tickets"
            sessionId={state.sessionId}
            revision={state.refinement.revision}
          />
        </>
      ) : (
        <p role="status" className="text-base text-muted">O agente está preparando slices verticais.</p>
      )}
      <ReopenForm state={state} />
    </Section>
  );
}

function PublicationReview({ state }: { state: DossieState }) {
  const ticketCount = state.artifacts.tickets?.submission.tickets.length ?? 0;
  return (
    <Section id="publicacao" heading="Publicar artefatos aprovados">
      <div className="grid gap-4 rounded-[var(--radius-md)] border border-line bg-surface px-5 py-5 sm:grid-cols-3">
        <div><p className="text-xs uppercase tracking-[0.14em] text-muted">Destino</p><p className="mt-1 font-medium">Azure DevOps · US #{state.story.id}</p></div>
        <div><p className="text-xs uppercase tracking-[0.14em] text-muted">Artefatos</p><p className="mt-1 font-medium">1 Spec · {ticketCount} {ticketCount === 1 ? "Ticket" : "Tickets"}</p></div>
        <div><p className="text-xs uppercase tracking-[0.14em] text-muted">Estimativa</p><p className="mt-1 font-medium">Registrada no gate abaixo</p></div>
      </div>
      <DumpGate sessionId={state.sessionId} phase={state.refinement.phase} dump={state.dump} />
      <ReopenForm state={state} />
    </Section>
  );
}

function ArtifactGateForm({ action, label, sessionId, revision, disabled = false }: {
  action: (previous: string | null, formData: FormData) => Promise<string | null>;
  label: string;
  sessionId: string;
  revision: number;
  disabled?: boolean;
}) {
  const [error, submit, pending] = useActionState(action, null);
  return (
    <form action={submit} className="flex flex-col items-start gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <Button type="submit" variant="primary" disabled={pending || disabled} aria-busy={pending}>
        {pending ? "Processando…" : label}
      </Button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function ReopenForm({ state }: { state: DossieState }) {
  const [error, reopen, pending] = useActionState(reopenRefinementAction, null);
  return (
    <div className="flex flex-col items-start gap-3 border-t border-line pt-5">
      <ConfirmAction
        triggerLabel="Reabrir Refinamento"
        title="Reabrir Refinamento"
        description="As aprovações atuais serão invalidadas. O histórico e os rascunhos permanecem preservados."
        confirmLabel={pending ? "Reabrindo…" : "Confirmar reabertura"}
        action={reopen}
        triggerProps={{ variant: "quiet", disabled: pending }}
      >
        <input type="hidden" name="sessionId" value={state.sessionId} />
        <input type="hidden" name="expectedRevision" value={state.refinement.revision} />
      </ConfirmAction>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Status({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section role="status" aria-live="polite" className="rounded-[var(--radius-md)] border border-line bg-surface px-6 py-5">
      <h2 className="font-serif text-2xl tracking-tight">{heading}</h2>
      <p className="mt-2 text-base text-muted">{children}</p>
    </section>
  );
}
