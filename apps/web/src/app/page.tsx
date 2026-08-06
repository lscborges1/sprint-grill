import type { RepoConfig } from "@sprint-griller/core";
import { getSquadConfig } from "@/lib/squad-config";

// A config é lida do disco a cada request; nada aqui é pré-renderizável.
export const dynamic = "force-dynamic";

export default function Home() {
  const { azureDevOps, repos } = getSquadConfig();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-14 px-8 py-20">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Sprint Griller</h1>
        <p className="text-lg text-muted">
          Config da squad carregada. Definida uma vez — nenhuma cerimônia começa
          escolhendo repositório.
        </p>
      </header>

      <section className="flex flex-col gap-5" aria-labelledby="ado-heading">
        <h2
          id="ado-heading"
          className="text-xs font-medium uppercase tracking-[0.18em] text-muted"
        >
          Azure DevOps
        </h2>
        <dl className="grid gap-6 sm:grid-cols-2">
          <Field label="Organização" value={azureDevOps.organization} />
          <Field label="Projeto" value={azureDevOps.project} />
        </dl>
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="repos-heading">
        <h2
          id="repos-heading"
          className="text-xs font-medium uppercase tracking-[0.18em] text-muted"
        >
          Repos da squad
        </h2>
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
      </section>
    </main>
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
