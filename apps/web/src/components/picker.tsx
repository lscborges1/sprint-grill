"use client";

import type { BacklogStory, RefinementStatus } from "@sprint-griller/ado-client";
import type { RepoConfig } from "@sprint-griller/core";
import Link from "next/link";
import { useState, type ReactElement } from "react";
import type { PickerAction } from "@/lib/picker-action";
import { Button, EmptyState, PageHeader, StatusBadge } from "./ui";

export type PickerFilter = "all" | RefinementStatus;

export type PickerStory = BacklogStory & {
  readonly action: PickerAction;
};

type StartInvestigationAction = (formData: FormData) => void | Promise<void>;

const REFINEMENT_LABEL: Record<PickerFilter, string> = {
  all: "Todos os status",
  "sem-investigacao": "Sem investigação",
  investigada: "Investigada",
  refinada: "Refinada",
};

const STATUS_TONE = {
  "sem-investigacao": "neutral",
  investigada: "warning",
  refinada: "success",
} as const satisfies Record<RefinementStatus, "neutral" | "warning" | "success">;

export function filterPickerStories(
  stories: readonly PickerStory[],
  query: string,
  filter: PickerFilter,
): readonly PickerStory[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  return stories.filter((story) => {
    const matchesFilter = filter === "all" || story.refinement === filter;
    const matchesQuery =
      normalizedQuery === "" ||
      String(story.id).includes(normalizedQuery) ||
      story.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  });
}

export function Picker({
  stories,
  project,
  repos,
  startAction,
}: {
  readonly stories: readonly PickerStory[];
  readonly project: string;
  readonly repos: { readonly primary: RepoConfig; readonly related: readonly RepoConfig[] };
  readonly startAction: StartInvestigationAction;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PickerFilter>("all");
  const visibleStories = filterPickerStories(stories, query, filter);
  const hasFilters = query !== "" || filter !== "all";

  function clearFilters(): void {
    setQuery("");
    setFilter("all");
  }

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
      <PageHeader
        eyebrow="Picker · Backlog"
        title="Refina"
        description={`US do backlog de ${project}, do topo da prioridade para baixo. Busque por ID ou título; os filtros valem somente para esta tela.`}
      />

      <section aria-labelledby="picker-controls" className="flex flex-col gap-4">
        <h2 id="picker-controls" className="sr-only">Filtros do Picker</h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label htmlFor="picker-search" className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
            Buscar no backlog
            <input
              id="picker-search"
              aria-label="Buscar no backlog"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="ID ou título"
              className="min-h-10 rounded-[var(--radius-md)] border border-line bg-surface px-3 text-base text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <label htmlFor="picker-filter" className="flex flex-col gap-1.5 text-sm font-medium md:w-56">
            Status de refinamento
            <select
              id="picker-filter"
              value={filter}
              onChange={(event) => setFilter(parsePickerFilter(event.currentTarget.value))}
              className="min-h-10 rounded-[var(--radius-md)] border border-line bg-surface px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {(Object.keys(REFINEMENT_LABEL) as PickerFilter[]).map((value) => (
                <option key={value} value={value}>{REFINEMENT_LABEL[value]}</option>
              ))}
            </select>
          </label>
          <Button type="button" variant="quiet" onClick={clearFilters} disabled={!hasFilters}>Limpar filtros</Button>
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {visibleStories.length} {visibleStories.length === 1 ? "US visível" : "USs visíveis"} de {stories.length}
        </p>
      </section>

      {visibleStories.length === 0 ? (
        <EmptyState heading={hasFilters ? "Nenhuma US corresponde aos filtros" : "O backlog não tem US"}>
          {hasFilters ? "Limpe a busca ou escolha outro status de refinamento." : "Quando o PO criar uma US no backlog do Azure DevOps, ela aparecerá aqui."}
        </EmptyState>
      ) : (
        <>
          <div className="hidden lg:block">
            <StoryTable stories={visibleStories} startAction={startAction} />
          </div>
          <div className="grid gap-3 lg:hidden">
            {visibleStories.map((story) => <StoryCompact key={story.id} story={story} startAction={startAction} />)}
          </div>
        </>
      )}

      <details className="border-t border-line pt-5">
        <summary className="cursor-pointer text-sm font-medium text-muted">Config da squad</summary>
        <div className="mt-4 grid gap-5 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted">Repo principal</p>
            <p className="font-medium">{repos.primary.name}</p>
            <code className="break-all text-xs text-muted">{repos.primary.path}</code>
          </div>
          <div>
            <p className="text-muted">Repos relacionados</p>
            {repos.related.length === 0 ? <p>Nenhum configurado.</p> : <ul>{repos.related.map((repo) => <li key={repo.path}>{repo.name}</li>)}</ul>}
          </div>
        </div>
      </details>
    </main>
  );
}

function StoryTable({ stories, startAction }: { readonly stories: readonly PickerStory[]; readonly startAction: StartInvestigationAction }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">User Stories do backlog</caption>
        <thead className="border-b border-line text-xs uppercase tracking-[0.14em] text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">US / tipo</th>
            <th scope="col" className="px-4 py-3 font-medium">Estado</th>
            <th scope="col" className="px-4 py-3 font-medium">Responsável</th>
            <th scope="col" className="px-4 py-3 font-medium">Refinamento</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Próxima ação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {stories.map((story) => (
            <tr key={story.id}>
              <td className="px-4 py-4"><StoryIdentity story={story} /></td>
              <td className="px-4 py-4 text-muted">{story.state}</td>
              <td className="px-4 py-4 text-muted">{story.assignedTo ?? "Não atribuído"}</td>
              <td className="px-4 py-4"><RefinementBadge story={story} /></td>
              <td className="px-4 py-4 text-right"><StoryAction story={story} startAction={startAction} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoryCompact({ story, startAction }: { readonly story: PickerStory; readonly startAction: StartInvestigationAction }) {
  return (
    <article className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3"><StoryIdentity story={story} /><RefinementBadge story={story} /></div>
      <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted">Estado</dt><dd>{story.state}</dd></div><div><dt className="text-muted">Responsável</dt><dd>{story.assignedTo ?? "Não atribuído"}</dd></div></dl>
      <StoryAction story={story} startAction={startAction} />
    </article>
  );
}

function StoryIdentity({ story }: { readonly story: PickerStory }) {
  return <div className="flex min-w-0 flex-col gap-1"><a href={story.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">#{story.id} · {story.title}</a><span className="text-xs text-muted">{story.type}</span></div>;
}

function RefinementBadge({ story }: { readonly story: PickerStory }) {
  return <StatusBadge tone={STATUS_TONE[story.refinement]}>{REFINEMENT_LABEL[story.refinement]}</StatusBadge>;
}

function StoryAction({ story, startAction }: { readonly story: PickerStory; readonly startAction: StartInvestigationAction }) {
  const accessibleLabel = `${story.action.label} — US #${story.id}: ${story.title}`;

  if (story.action.kind === "start") {
    return (
      <form action={startAction}>
        <input type="hidden" name="storyId" value={story.id} />
        <Button type="submit" size="sm" variant="secondary" aria-label={accessibleLabel}>{story.action.label}</Button>
      </form>
    );
  }
  return (
    <Link
      href={`/investigacao/${story.id}`}
      className="inline-flex min-h-8 items-center justify-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-accent underline-offset-4 hover:underline"
      aria-label={accessibleLabel}
    >
      {story.action.label}
    </Link>
  );
}

function parsePickerFilter(value: string): PickerFilter {
  if (value === "sem-investigacao" || value === "investigada" || value === "refinada") return value;
  return "all";
}
