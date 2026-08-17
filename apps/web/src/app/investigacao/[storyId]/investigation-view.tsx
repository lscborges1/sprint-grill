import {
  MARKDOWN_PREVIEW,
  REJECTED_BLURB,
  REJECTED_HEADING,
  REPORT_SECTIONS,
  formatCitation,
} from "@sprint-griller/investigation";
import type {
  CitationViolation,
  InvestigationReport,
} from "@sprint-griller/investigation";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { OperationalFrame } from "../../../components/operational-frame";
import { Section } from "../../../components/section";
import {
  Alert,
  Button,
  ConfirmAction,
  EmptyState,
  MarkdownPreview,
  PageHeader,
} from "../../../components/ui";
import type { InvestigationRun, ReportRun } from "../../../lib/investigations";
import { AutoRefresh } from "./auto-refresh";
import { PublishButton } from "./publish-button";

/** Enquanto o turno roda a tela se recarrega sozinha; investigação é lenta. */
const REFRESH_SECONDS = 5;

export interface InvestigationViewModel {
  readonly storyId: number;
  readonly run: InvestigationRun | undefined;
  readonly openCeremonyId: string | undefined;
}

export type InvestigationFormAction = (formData: FormData) => void | Promise<void>;

export interface InvestigationViewActions {
  readonly startCeremony: InvestigationFormAction;
  readonly publishInvestigation: InvestigationFormAction;
  readonly retryInvestigation?: InvestigationFormAction;
}

export function InvestigationView({
  model,
  actions,
}: {
  readonly model: InvestigationViewModel;
  readonly actions: InvestigationViewActions;
}): ReactElement {
  const { storyId, run, openCeremonyId } = model;

  return (
    <OperationalFrame>
      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <PageHeader
          eyebrow={`Investigação · US #${storyId}`}
          title={run?.story?.title ?? `Investigação — US #${storyId}`}
          back={<Link href="/" className="text-sm text-muted underline underline-offset-4">← Voltar ao Picker</Link>}
          description={run?.story ? <a href={run.story.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Abrir no Azure DevOps</a> : undefined}
        />
        <Outcome
          run={run}
          publishAction={actions.publishInvestigation}
          retryAction={actions.retryInvestigation}
        />
        {run?.status === "aprovado" && (
          <RefinementCallToAction
            storyId={storyId}
            publication={run.publication}
            openCeremonyId={openCeremonyId}
            action={actions.startCeremony}
          />
        )}
      </main>
    </OperationalFrame>
  );
}

/**
 * A ponte entre os dois momentos do produto: a Investigação aprovada é o insumo
 * do Refinamento, e é daqui que a sessão nasce. Se já existe uma aberta para
 * esta US, o botão volta para ela em vez de abrir outra.
 */
function RefinementCallToAction({
  storyId,
  publication,
  openCeremonyId,
  action,
}: {
  readonly storyId: number;
  readonly publication: ReportRun["publication"];
  readonly openCeremonyId: string | undefined;
  readonly action: InvestigationFormAction;
}) {
  if (openCeremonyId !== undefined) {
    return (
      <Section id="refinar" heading="Próxima ação">
        <Link href={`/cerimonia/${openCeremonyId}`}>Voltar ao Palco</Link>
        <p className="mt-2 text-sm text-muted">O Refinamento desta US já está aberto.</p>
      </Section>
    );
  }

  if (publication?.status !== "publicada") {
    return (
      <Section id="refinar" heading="Próxima ação">
        <p className="text-sm text-muted">
          Publique a Investigação antes de abrir o Refinamento para levar um insumo rastreável à sala.
        </p>
        <ConfirmAction
          triggerLabel="Refinar sem publicar"
          title="Abrir Refinamento sem publicar?"
          description="A sala receberá a Investigação aprovada, mas ela ainda não será registrada no Azure DevOps. Confirme somente se isso for intencional."
          confirmLabel="Abrir sem publicar"
          action={action}
          triggerProps={{ variant: "secondary" }}
        >
          <input type="hidden" name="storyId" value={storyId} />
        </ConfirmAction>
      </Section>
    );
  }

  return (
    <Section id="refinar" heading="Próxima ação">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="storyId" value={storyId} />
        <Button type="submit" variant="primary">Refinar com a sala</Button>
        <span className="text-sm text-muted">
          A Investigação publicada será o insumo do Refinamento coletivo.
        </span>
      </form>
    </Section>
  );
}

function Outcome({
  run,
  publishAction,
  retryAction,
}: {
  readonly run: InvestigationRun | undefined;
  readonly publishAction: InvestigationFormAction;
  readonly retryAction: InvestigationFormAction | undefined;
}) {
  if (!run) {
    return (
      <EmptyState heading="Nenhuma Investigação neste processo">Volte ao Picker e clique em Investigar para iniciar o processamento.</EmptyState>
    );
  }

  if (run.status === "em-andamento") {
    return (
      <>
        <p role="status" className="text-lg text-muted">
          Investigando… O agente está lendo a US e os repos da squad. Pode fechar
          esta tela: o turno segue rodando e o relatório espera aqui.
        </p>
        <AutoRefresh seconds={REFRESH_SECONDS} />
        <Previous run={run.previous} />
      </>
    );
  }

  if (run.status === "falhou") {
    return (
      <>
        <Alert heading="A Investigação não terminou">
          <p className="text-base text-muted">{run.message}</p>
        </Alert>
        <RetryInvestigation storyId={run.storyId} action={retryAction} />
        <Previous run={run.previous} />
      </>
    );
  }

  return (
    <>
      <Result run={run} />
      {run.status === "reprovado" && (
        <RetryInvestigation storyId={run.storyId} action={retryAction} />
      )}
      {/* Só o relatório em cena publica: o do disparo anterior aparece em
          `Previous`, e a própria tela já o chamou de antigo. */}
      {run.status === "aprovado" && <Publish run={run} action={publishAction} />}
    </>
  );
}

function RetryInvestigation({
  storyId,
  action,
}: {
  readonly storyId: number;
  readonly action: InvestigationFormAction | undefined;
}) {
  if (action === undefined) return null;

  return (
    <form action={action}>
      <input type="hidden" name="storyId" value={storyId} />
      <Button type="submit" variant="secondary">Investigar novamente</Button>
    </form>
  );
}

/**
 * O relatório do disparo anterior, enquanto o turno em curso não entrega outro.
 * Dito com todas as letras que é o antigo: relatório sem data de validade na
 * tela vira fato de sprint passada.
 */
function Previous({ run }: { readonly run: ReportRun | undefined }) {
  if (!run) return null;

  return (
    <>
      <p className="text-lg text-muted">
        Abaixo, o relatório do disparo anterior desta US — ele fica até um turno
        novo entregar outro.
      </p>
      <Result run={run} />
    </>
  );
}

function Result({ run }: { readonly run: ReportRun }) {
  return (
    <>
      {run.status === "reprovado" && <Violations violations={run.violations} />}
      <Report report={run.report} approved={run.status === "aprovado"} />
      <Section id="markdown" heading="Prévia do relatório">
        <details className="rounded-[var(--radius-md)] border border-line bg-surface px-5 py-4">
          <summary className="cursor-pointer text-base">
            {MARKDOWN_PREVIEW[run.status]}
          </summary>
          <div className="mt-4 border-t border-line pt-4"><MarkdownPreview markdown={run.markdown} /></div>
        </details>
      </Section>
    </>
  );
}

/**
 * A única escrita no Azure DevOps que a tela oferece, e ela é um clique — nada
 * sai daqui sozinho. Só o relatório aprovado a ganha: o reprovado já vem com o
 * aviso de que não vai para o ADO.
 */
function Publish({
  run,
  action,
}: {
  readonly run: ReportRun;
  readonly action: InvestigationFormAction;
}) {
  const publication = run.publication;

  if (publication?.status === "publicada") {
    return (
      <Section id="publicacao" heading="Publicada no Azure DevOps">
        <p className="text-base text-muted">
          A Investigação está na US #{run.storyId} como comment (
          {publication.commentId}). O picker passa a mostrar esta US como{" "}
          <strong className="font-medium">investigada</strong>.
        </p>
        <a
          href={publication.url}
          target="_blank"
          rel="noreferrer"
          className="text-base underline underline-offset-4"
        >
          Abrir a US no Azure DevOps
        </a>
      </Section>
    );
  }

  if (publication?.status === "incerta") {
    return (
      <Section id="publicacao" heading="Confirme a publicação no Azure DevOps">
        <Alert heading="A publicação pode ter acontecido">
          <p className="text-base text-muted">{publication.message}</p>
        </Alert>
        <p className="text-base text-muted">
          A conexão caiu depois de enviar o relatório, o Azure DevOps respondeu
          com erro de servidor, ou devolveu uma resposta inválida. Confira a US
          antes de publicar este relatório de novo, para não criar um comment
          duplicado.
        </p>
        {run.story && (
          <a
            href={run.story.url}
            target="_blank"
            rel="noreferrer"
            className="text-base underline underline-offset-4"
          >
            Abrir a US no Azure DevOps
          </a>
        )}
      </Section>
    );
  }

  return (
    <Section id="publicacao" heading="Publicar no Azure DevOps">
      {publication?.status === "falhou" && (
        <Alert heading="Nada foi publicado">
          <p className="text-base text-muted">{publication.message}</p>
        </Alert>
      )}
      <p className="text-base text-muted">
        A Investigação vira um comment Markdown na própria US, onde a squad e o
        PO já trabalham. Até este clique, nada foi gravado no Azure DevOps.
      </p>
      <form action={action} className="flex">
        <input type="hidden" name="storyId" value={run.storyId} />
        <PublishButton
          storyId={run.storyId}
          retry={publication?.status === "falhou"}
        />
      </form>
    </Section>
  );
}

/**
 * O relatório reprovado continua visível — o Operador precisa ver o que o agente
 * disse para decidir se redispara — mas nunca sem o aviso de que ele não passou.
 */
function Violations({ violations }: { readonly violations: readonly CitationViolation[] }) {
  return (
    <Alert heading={REJECTED_HEADING}>
      <p className="text-base text-muted">{REJECTED_BLURB}</p>
      <ul className="flex flex-col gap-2">
        {violations.map((violation) => (
          <li key={`${violation.reason}:${violation.detail}:${violation.claim}`}>
            <span className="text-base">{violation.detail}</span>
            <br />
            <span className="text-sm text-muted">
              Afirmação afetada: {violation.claim}
            </span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function Report({
  report,
  approved,
}: {
  readonly report: InvestigationReport;
  readonly approved: boolean;
}) {
  return (
    <>
      <p className="text-lg">{report.summary}</p>

      <Section id="gaps" heading={REPORT_SECTIONS.gaps.heading}>
        <Items
          items={report.gaps}
          empty={REPORT_SECTIONS.gaps.empty}
          render={(gap) => (
            <>
              <strong className="font-medium">{gap.question}</strong> — {gap.why}
            </>
          )}
          keyOf={(gap) => gap.question}
        />
      </Section>

      <Section id="impacts" heading={REPORT_SECTIONS.impacts.heading}>
        <p className="text-sm text-muted">
          {approved
            ? REPORT_SECTIONS.impacts.verified
            : REPORT_SECTIONS.impacts.rejected}
        </p>
        <Items
          items={report.impacts}
          empty={REPORT_SECTIONS.impacts.empty}
          keyOf={(impact) => impact.claim}
          render={(impact) => (
            <>
              {impact.claim}
              <ul className="mt-2 flex flex-col gap-1">
                {impact.citations.map((citation) => (
                  <li
                    key={formatCitation(citation)}
                    className="font-mono text-sm text-muted"
                  >
                    {formatCitation(citation)}
                  </li>
                ))}
              </ul>
            </>
          )}
        />
      </Section>

      <Section id="external" heading={REPORT_SECTIONS.externalRepos.heading}>
        <p className="text-sm text-muted">{REPORT_SECTIONS.externalRepos.blurb}</p>
        <Items
          items={report.externalRepos}
          empty={REPORT_SECTIONS.externalRepos.empty}
          keyOf={(external) => external.repo}
          render={(external) => (
            <>
              <strong className="font-medium">{external.repo}</strong> —{" "}
              {external.suspicion}
            </>
          )}
        />
      </Section>

      <Section id="unverified" heading={REPORT_SECTIONS.unverified.heading}>
        <p className="text-sm text-muted">{REPORT_SECTIONS.unverified.blurb}</p>
        <Items
          items={report.unverified}
          empty={REPORT_SECTIONS.unverified.empty}
          keyOf={(claim) => claim}
          render={(claim) => <>{claim}</>}
        />
      </Section>
    </>
  );
}

function Items<T>({
  items,
  empty,
  render,
  keyOf,
}: {
  readonly items: readonly T[];
  readonly empty: string;
  readonly render: (item: T) => ReactNode;
  readonly keyOf: (item: T) => string;
}) {
  if (items.length === 0) {
    return <p className="text-base text-muted">{empty}</p>;
  }

  return (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((item) => <li key={keyOf(item)} className="py-4 text-base">{render(item)}</li>)}
    </ul>
  );
}
