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
import { notFound } from "next/navigation";
import { Section } from "@/components/section";
import { startCeremonyAction } from "@/app/cerimonia/actions";
import { findOpenCeremony } from "@/lib/ceremonies";
import { getInvestigation, storyIdSchema } from "@/lib/investigations";
import type { InvestigationRun, ReportRun } from "@/lib/investigations";
import { AutoRefresh } from "./auto-refresh";

// O preview mostra o estado do turno agora; nada aqui é pré-renderizável.
export const dynamic = "force-dynamic";

/** Enquanto o turno roda a tela se recarrega sozinha; investigação é lenta. */
const REFRESH_SECONDS = 5;

export default async function InvestigationPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const parsed = storyIdSchema.safeParse((await params).storyId);
  if (!parsed.success) notFound();

  const storyId = parsed.data;
  const run = getInvestigation(storyId);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-8 py-20">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-muted underline underline-offset-4">
          ← Voltar ao picker
        </Link>
        <h1 className="text-4xl font-semibold tracking-tight">
          Investigação — US #{storyId}
        </h1>
        {run?.story && (
          <p className="text-lg text-muted">
            {run.story.title} ·{" "}
            <a
              href={run.story.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              abrir no Azure DevOps
            </a>
          </p>
        )}
      </header>

      {run?.status === "aprovado" && <Grill storyId={storyId} />}

      <Outcome run={run} />
    </main>
  );
}

/**
 * A ponte entre os dois momentos do produto: a Investigação aprovada é o insumo
 * do grilling, e é daqui que a cerimônia nasce. Se já existe uma aberta para
 * esta US, o botão volta para ela em vez de abrir outra.
 */
function Grill({ storyId }: { storyId: number }) {
  const open = findOpenCeremony(storyId);

  return (
    <form action={startCeremonyAction} className="flex flex-wrap items-center gap-4">
      <input type="hidden" name="storyId" value={storyId} />
      <button
        type="submit"
        className="rounded-full border border-foreground bg-foreground px-6 py-3 text-base font-medium text-background"
      >
        {open ? "Voltar ao Palco" : "Grelhar com a sala"}
      </button>
      <span className="text-sm text-muted">
        {open
          ? "A cerimônia desta US já está aberta."
          : "Abre o Palco com esta Investigação como insumo do grilling."}
      </span>
    </form>
  );
}

function Outcome({ run }: { run: InvestigationRun | undefined }) {
  if (!run) {
    return (
      <p className="text-lg text-muted">
        Nenhuma Investigação disparada para esta US neste processo. Volte ao
        picker e clique em <strong>Investigar</strong>.
      </p>
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
        <Previous run={run.previous} />
      </>
    );
  }

  return <Result run={run} />;
}

/**
 * O relatório do disparo anterior, enquanto o turno em curso não entrega outro.
 * Dito com todas as letras que é o antigo: relatório sem data de validade na
 * tela vira fato de sprint passada.
 */
function Previous({ run }: { run: ReportRun | undefined }) {
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

function Result({ run }: { run: ReportRun }) {
  return (
    <>
      {run.status === "reprovado" && <Violations violations={run.violations} />}
      <Report report={run.report} approved={run.status === "aprovado"} />
      <Section id="markdown" heading="Markdown do relatório">
        <details className="rounded-lg border border-line px-5 py-4">
          <summary className="cursor-pointer text-base">
            {MARKDOWN_PREVIEW[run.status]}
          </summary>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap font-mono text-sm text-muted">
            {run.markdown}
          </pre>
        </details>
      </Section>
    </>
  );
}

/**
 * O relatório reprovado continua visível — o Operador precisa ver o que o agente
 * disse para decidir se redispara — mas nunca sem o aviso de que ele não passou.
 */
function Violations({ violations }: { violations: readonly CitationViolation[] }) {
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
  report: InvestigationReport;
  approved: boolean;
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
  items: readonly T[];
  empty: string;
  render: (item: T) => React.ReactNode;
  keyOf: (item: T) => string;
}) {
  if (items.length === 0) {
    return <p className="text-base text-muted">{empty}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={keyOf(item)} className="rounded-lg border border-line px-5 py-4 text-base">
          {render(item)}
        </li>
      ))}
    </ul>
  );
}

function Alert({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-red-600/50 bg-red-600/5 px-5 py-4"
    >
      <p className="text-lg font-medium tracking-tight">{heading}</p>
      {children}
    </div>
  );
}
