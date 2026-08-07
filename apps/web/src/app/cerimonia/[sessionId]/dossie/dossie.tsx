"use client";

// Subpath de propósito: o barril do pacote puxa o store, e o binding nativo do
// SQLite não existe no bundle do cliente.
import { SPEC_SECTIONS, dossieStateSchema } from "@sprint-griller/ceremony/session-state";
import type { CeremonyDecision, DossieState } from "@sprint-griller/ceremony";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useLiveState } from "@/components/live-state";
import { Section } from "@/components/section";
import { discardSpecDraftAction, saveSpecDraftAction } from "../../actions";

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
              <Decided key={`${decision.questionId}:${decision.decidedAt}`} decision={decision} />
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
              <li key={question} className="rounded-lg border border-line px-5 py-4 text-base">
                {question}
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

      <SpecEditor sessionId={state.sessionId} spec={state.spec} />
    </main>
  );
}

function Decided({ decision }: { decision: CeremonyDecision }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line px-5 py-4">
      <p className="text-base font-medium">{decision.question}</p>
      <p className="text-base">{decision.answer}</p>
      <p className="text-sm text-muted">
        Recomendação do agente: {decision.recommendation}
      </p>
      <p className="text-sm text-muted">
        {decision.decidedBy} · {formatWhen(decision.decidedAt)}
      </p>
    </li>
  );
}

/** Trecho herdado da Investigação: Markdown que o documento carrega como veio. */
function Inherited({ text, empty }: { text: string; empty: string }) {
  if (text.trim() === "") return <p className="text-base text-muted">{empty}</p>;

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line px-5 py-4 font-mono text-sm">
      {text}
    </pre>
  );
}

/**
 * O preview do despejo, editável. O texto sai gerado do que a cerimônia gravou;
 * o que o Operador salvar é o que o despejo vai levar.
 *
 * O editor é semeado uma vez e não é mexido pelo SSE — texto sendo digitado não
 * pode ser sobrescrito por uma decisão que acabou de entrar. O preço disso é o
 * documento andar por baixo da edição, e é exatamente o que o aviso de
 * desatualizado existe para mostrar: despejar uma Spec sem a última decisão é o
 * erro que esta tela não pode deixar passar calado.
 */
function SpecEditor({
  sessionId,
  spec,
}: {
  sessionId: string;
  spec: DossieState["spec"];
}) {
  const [markdown, setMarkdown] = useState(spec.draft?.markdown ?? spec.generated);
  const [base, setBase] = useState(spec.draft?.base ?? spec.generated);
  const [saveError, save, saving] = useActionState(saveSpecDraftAction, null);
  const [discardError, discard, discarding] = useActionState(discardSpecDraftAction, null);

  const stale = spec.generated !== base;

  function regenerate(formData: FormData): void {
    setMarkdown(spec.generated);
    setBase(spec.generated);
    discard(formData);
  }

  return (
    <Section id="despejo" heading="Preview do despejo">
      <p className="text-base text-muted">
        A Spec da US como ela vai para o Azure DevOps. Edite à vontade: nada foi
        gravado ainda, e o despejo leva o que estiver aqui.
      </p>

      {stale && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/60 bg-amber-500/5 px-5 py-4"
        >
          <p className="text-base font-medium">A cerimônia andou depois desta edição</p>
          <p className="text-sm text-muted">
            O documento vivo acima tem decisão que este texto não tem. Traga as
            novas — regenerar descarta a edição.
          </p>
          <Regenerate sessionId={sessionId} action={regenerate} pending={discarding} />
        </div>
      )}

      <form action={save} className="flex flex-col gap-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="base" value={base} />
        <label className="sr-only" htmlFor="markdown">
          Markdown da Spec da US
        </label>
        <textarea
          id="markdown"
          name="markdown"
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          rows={24}
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-transparent px-5 py-4 font-mono text-sm leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl border border-foreground bg-foreground px-6 py-3 text-base font-medium text-background disabled:opacity-50"
          >
            Salvar edição
          </button>
          <span className="text-sm text-muted">
            {spec.draft
              ? `Editado por último às ${formatWhen(spec.draft.savedAt)}.`
              : "Sem edição salva: o texto acima é o gerado da cerimônia."}
          </span>
        </div>
        {(saveError ?? discardError) && (
          <p role="alert" className="text-sm text-red-600">
            {saveError ?? discardError}
          </p>
        )}
      </form>

      {/* Sem isto, uma edição salva não teria volta enquanto a cerimônia não
          andasse — o Operador ficaria preso ao próprio rascunho. */}
      {spec.draft && !stale && (
        <Regenerate sessionId={sessionId} action={regenerate} pending={discarding} />
      )}
    </Section>
  );
}

/** Joga a edição fora e volta ao documento que a cerimônia gerou. */
function Regenerate({
  sessionId,
  action,
  pending,
}: {
  sessionId: string;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  return (
    <form action={action} className="flex">
      <input type="hidden" name="sessionId" value={sessionId} />
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

function formatWhen(at: number): string {
  return new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
