import type {
  Citation,
  CitationViolation,
  InvestigationReport,
} from "@sprint-griller/investigation";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "@/components/section";
import { getInvestigation } from "@/lib/investigations";
import type { InvestigationRun } from "@/lib/investigations";
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
  const storyId = Number((await params).storyId);
  if (!Number.isInteger(storyId) || storyId <= 0) notFound();

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

      <Outcome run={run} />
    </main>
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
      </>
    );
  }

  if (run.status === "falhou") {
    return (
      <Alert heading="A Investigação não terminou">
        <p className="text-base text-muted">{run.message}</p>
      </Alert>
    );
  }

  return (
    <>
      {run.status === "reprovado" && <Violations violations={run.violations} />}
      <Report report={run.report} approved={run.status === "aprovado"} />
      <Section id="markdown" heading="Markdown do relatório">
        <details className="rounded-lg border border-line px-5 py-4">
          <summary className="cursor-pointer text-base">
            Ver o Markdown que vai para o Azure DevOps
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
    <Alert heading="Relatório reprovado na checagem de citações">
      <p className="text-base text-muted">
        Citação que não fecha com o código é ruído com cara de fato. Nada disto
        vai para o Azure DevOps — redispare a Investigação.
      </p>
      <ul className="flex flex-col gap-2">
        {violations.map((violation, index) => (
          <li key={`${violation.citation.repo}:${violation.citation.path}:${index}`}>
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

      <Section id="gaps" heading="Furos da US">
        <Items
          items={report.gaps}
          empty="Nenhum furo aberto."
          render={(gap) => (
            <>
              <strong className="font-medium">{gap.question}</strong> — {gap.why}
            </>
          )}
          keyOf={(gap) => gap.question}
        />
      </Section>

      <Section id="impacts" heading="Impacto mapeado">
        <p className="text-sm text-muted">
          {approved
            ? "Toda afirmação abaixo passou pela checagem mecânica de citações."
            : "Estas afirmações não passaram na checagem — leia como rascunho."}
        </p>
        <Items
          items={report.impacts}
          empty="Nenhum impacto ancorado no código."
          keyOf={(impact) => impact.claim}
          render={(impact) => (
            <>
              {impact.claim}
              <ul className="mt-2 flex flex-col gap-1">
                {impact.citations.map((citation) => (
                  <li key={anchor(citation)} className="font-mono text-sm text-muted">
                    {anchor(citation)}
                    {citation.symbol === undefined ? "" : ` → ${citation.symbol}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        />
      </Section>

      <Section id="external" heading="Impacto suspeito fora do config">
        <p className="text-sm text-muted">
          Repos que não estão na config da squad — ninguém leu o código deles.
        </p>
        <Items
          items={report.externalRepos}
          empty="Nenhum."
          keyOf={(external) => external.repo}
          render={(external) => (
            <>
              <strong className="font-medium">{external.repo}</strong> —{" "}
              {external.suspicion}
            </>
          )}
        />
      </Section>

      <Section id="unverified" heading="Não verificado">
        <p className="text-sm text-muted">
          Hipóteses que o agente não conseguiu ancorar no código. Não são fato.
        </p>
        <Items
          items={report.unverified}
          empty="Nada ficou sem âncora."
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

function anchor(citation: Citation): string {
  return `${citation.repo}:${citation.path}`;
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
