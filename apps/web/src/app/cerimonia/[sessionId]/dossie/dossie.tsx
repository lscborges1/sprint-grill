"use client";

import { dossieStateSchema } from "@sprint-griller/ceremony/session-state";
import { formatDecisionWhen } from "@sprint-griller/ceremony/spec";
import type { CeremonyDecision, DossieState } from "@sprint-griller/ceremony";
import Link from "next/link";
import { useActionState } from "react";
import { useLiveState } from "@/components/live-state";
import { Section } from "@/components/section";
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

export function Dossie({ initial }: { initial: DossieState }) {
  const { state, connected } = useLiveState(
    `/api/cerimonia/${initial.sessionId}/dossie/stream`,
    dossieStateSchema,
    initial,
    { schemaName: "dossieStateSchema", sessionId: initial.sessionId },
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-8 py-16">
      <header className="flex flex-col gap-3">
        <Link href={`/cerimonia/${state.sessionId}`} className="text-sm text-muted underline underline-offset-4">
          ← Voltar ao Palco
        </Link>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
          {PHASE_LABEL[state.refinement.phase]} · revisão {state.refinement.revision}
        </p>
        <h1 className="font-serif text-4xl tracking-tight">Dossiê — US #{state.story.id}</h1>
        <p className="text-lg text-muted">
          {state.story.title} ·{" "}
          <a href={state.story.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            abrir no Azure DevOps
          </a>
        </p>
        {!connected && (
          <p role="alert" className="text-sm text-muted">
            Sem conexão com o Refinamento — o Dossiê pode estar desatualizado. Reconectando…
          </p>
        )}
      </header>

      <Agenda state={state} />
      <Resolutions decisions={state.decisions} timeZone={state.timeZone} />
      <ArtifactWorkflow state={state} />
    </main>
  );
}

function Agenda({ state }: { state: DossieState }) {
  return (
    <Section id="agenda" heading="Agenda do refinamento">
      {state.agenda.length === 0 ? (
        <p className="text-base text-muted">A Agenda do refinamento está vazia.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.agenda.map((item) => (
            <li key={item.id} className="rounded-lg border border-line px-5 py-4">
              <p>{item.question}</p>
              <p className="mt-1 text-sm text-muted">{item.status}</p>
            </li>
          ))}
        </ul>
      )}
      {state.completionProposal && (
        <p className="rounded-lg border border-line px-5 py-4 text-sm text-muted">
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
        <p className="text-base text-muted">Nenhuma escolha coletiva foi registrada.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {decisions.map((decision) => (
            <li key={`${decision.questionId}:${decision.decidedAt}`} className="rounded-lg border border-line px-5 py-4">
              <p className="font-medium">{decision.question}</p>
              <p className="mt-1">{decision.answer}</p>
              <p className="mt-2 text-sm text-muted">Recomendação: {decision.recommendation}</p>
              <p className="text-sm text-muted">{formatDecisionWhen(decision.decidedAt, timeZone)}</p>
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
  const approvalBlocked = editor.busy || editor.dirty || editor.conflict !== null || editor.stale;

  return (
    <Section id="spec" heading={`Revisar Spec · versão ${revision}`}>
      <SpecEditor state={state} editor={editor} />
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
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-amber-500/60 px-4 py-3 text-sm">
          <p>A Spec mudou em outra revisão. Recarregue o documento antes de aprovar.</p>
          {editor.remoteDraftConflict ? (
            <button type="button" onClick={editor.adoptRemote} className="rounded-lg border border-line px-4 py-2 font-medium">
              Usar edição salva
            </button>
          ) : (
            <form action={editor.regenerate}>
              <input type="hidden" name="sessionId" value={state.sessionId} />
              <input type="hidden" name="expectedSavedAt" value={editor.expectedSavedAt ?? ""} />
              <button type="submit" className="rounded-lg border border-line px-4 py-2 font-medium">
                Regenerar da versão atual
              </button>
            </form>
          )}
        </div>
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
        <button
          type="submit"
          disabled={blocked}
          className="self-start rounded-xl border border-line px-5 py-2.5 font-medium disabled:opacity-50"
        >
          {editor.busy ? "Salvando…" : "Salvar edição da Spec"}
        </button>
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
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line px-5 py-4 font-mono text-sm">
            {artifact.markdown}
          </pre>
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
  return (
    <Section id="publicacao" heading="Publicar artefatos aprovados">
      <p className="text-base text-muted">
        A publicação lê a Spec e os Tickets aprovados do servidor. O formulário envia somente a estimativa.
      </p>
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
      <button
        type="submit"
        disabled={pending || disabled}
        className="rounded-xl border border-foreground bg-foreground px-6 py-3 font-medium text-background disabled:opacity-50"
      >
        {pending ? "Processando…" : label}
      </button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function ReopenForm({ state }: { state: DossieState }) {
  return (
    <ArtifactGateForm
      action={reopenRefinementAction}
      label="Reabrir Refinamento"
      sessionId={state.sessionId}
      revision={state.refinement.revision}
    />
  );
}

function Status({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section role="status" className="rounded-lg border border-line px-6 py-5">
      <h2 className="font-serif text-2xl tracking-tight">{heading}</h2>
      <p className="mt-2 text-base text-muted">{children}</p>
    </section>
  );
}
