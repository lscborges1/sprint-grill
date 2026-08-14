import type {
  CurrentIteration,
  IterationStory,
  RefinementStatus,
} from "@sprint-griller/ado-client";
import type { RepoConfig } from "@sprint-griller/core";
import Link from "next/link";
import { Section } from "@/components/section";
import { loadCurrentIteration } from "@/lib/current-iteration";
import type { CurrentIterationResult } from "@/lib/current-iteration";
import { getInvestigation } from "@/lib/investigations";
import { getSquadConfig } from "@/lib/squad-config";
import { startInvestigationAction } from "./investigacao/actions";

// A iteration é lida do Azure DevOps a cada request; nada aqui é pré-renderizável.
export const dynamic = "force-dynamic";

/**
 * Os três estados do refinamento. Cada um tem rótulo próprio — quem distingue
 * cor não é o único a diferenciá-los.
 */
const REFINEMENT_BADGE = {
  "sem-investigacao": {
    label: "Sem investigação",
    className: "border-line text-muted",
  },
  investigada: {
    label: "Investigada",
    className:
      "border-amber-500/60 bg-amber-500/10 text-investigated",
  },
  refinada: {
    label: "Refinada",
    className:
      "border-emerald-600/60 bg-emerald-600/10 text-refined",
  },
} satisfies Record<
  RefinementStatus,
  { readonly label: string; readonly className: string }
>;

export default async function Home() {
  const { azureDevOps, repos } = getSquadConfig();
  const result = await loadCurrentIteration();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-14 px-8 py-20">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Sprint Griller</h1>
        <p className="text-lg text-muted">
          As US da iteration atual de {azureDevOps.project}. O status vem dos
          artefatos no Azure DevOps — a ferramenta não guarda estado próprio.
        </p>
      </header>

      <Iteration result={result} />

      <Section id="squad" heading="Config da squad">
        <dl className="grid gap-6 sm:grid-cols-2">
          <Field label="Organização" value={azureDevOps.organization} />
          <Field label="Projeto" value={azureDevOps.project} />
        </dl>
        <ul className="flex flex-col gap-3">
          <RepoRow repo={repos.primary} role="principal" />
          {repos.related.map((repo) => (
            <RepoRow key={repo.path} repo={repo} role="relacionado" />
          ))}
        </ul>
        {repos.related.length === 0 && (
          <p className="text-sm text-muted">
            Nenhum repo relacionado configurado — a Investigação vai olhar só o
            principal.
          </p>
        )}
      </Section>
    </main>
  );
}

function Iteration({ result }: { result: CurrentIterationResult }) {
  if (result.status === "error") {
    return (
      <Section id="iteration" heading="Iteration atual">
        <AdoFailure message={result.message} />
      </Section>
    );
  }

  if (!result.iteration) {
    return (
      <Section id="iteration" heading="Iteration atual">
        <p className="text-lg text-muted">
          Nenhuma iteration corrente no Azure DevOps. Abra a sprint no board e
          recarregue esta tela.
        </p>
      </Section>
    );
  }

  return (
    <Section id="iteration" heading={result.iteration.name}>
      <Stories iteration={result.iteration} />
    </Section>
  );
}

function Stories({ iteration }: { iteration: CurrentIteration }) {
  if (iteration.stories.length === 0) {
    return (
      <p className="text-lg text-muted">
        A iteration {iteration.name} ainda não tem nenhuma US — só tasks, ou
        nada.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {iteration.stories.map((story) => (
        <StoryRow key={story.id} story={story} />
      ))}
    </ul>
  );
}

function StoryRow({ story }: { story: IterationStory }) {
  const badge = REFINEMENT_BADGE[story.refinement];
  const run = getInvestigation(story.id);

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="flex flex-col gap-1">
        <a
          href={story.url}
          target="_blank"
          rel="noreferrer"
          className="text-xl font-medium tracking-tight underline-offset-4 hover:underline"
        >
          {story.title}
        </a>
        <span className="text-sm text-muted">
          #{story.id} · {story.type} · {story.state}
          {story.assignedTo === undefined ? "" : ` · ${story.assignedTo}`}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-3">
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] ${badge.className}`}
        >
          {badge.label}
        </span>
        {run && (
          <Link
            href={`/investigacao/${story.id}`}
            className="text-sm text-muted underline underline-offset-4"
          >
            {run.status === "em-andamento" ? "investigando…" : "preview"}
          </Link>
        )}
        <InvestigateButton story={story} />
      </span>
    </li>
  );
}

/**
 * O disparo em um clique. A partir daqui o Operador pode fechar a tela: quem
 * roda a Investigação é o processo, não a request.
 */
function InvestigateButton({ story }: { story: IterationStory }) {
  return (
    <form action={startInvestigationAction}>
      <input type="hidden" name="storyId" value={story.id} />
      <button
        type="submit"
        className="rounded-full border border-line px-4 py-1.5 text-sm font-medium hover:bg-foreground/5"
      >
        Investigar
        <span className="sr-only"> a US {story.title}</span>
      </button>
    </form>
  );
}

/** Falha de conexão/auth com o ADO é conteúdo da tela, não tela quebrada. */
function AdoFailure({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-red-600/50 bg-red-600/5 px-5 py-4"
    >
      <p className="text-lg font-medium tracking-tight">
        Não deu para ler o Azure DevOps
      </p>
      <p className="text-base text-muted">{message}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-2xl font-medium tracking-tight">{value}</dd>
    </div>
  );
}

function RepoRow({
  repo,
  role,
}: {
  repo: RepoConfig;
  role: "principal" | "relacionado";
}) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-line px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span className="text-xl font-medium tracking-tight">{repo.name}</span>
        <span className="text-xs uppercase tracking-[0.14em] text-muted">
          {role}
        </span>
      </div>
      <code className="font-mono text-sm text-muted">{repo.path}</code>
    </li>
  );
}
