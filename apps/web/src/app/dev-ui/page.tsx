import { notFound } from "next/navigation";
import { OperationalFrame } from "@/components/operational-frame";
import { Alert, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { UI_FIXTURES, parseUiQuery } from "@/app/__dev/ui/fixtures";

export const dynamic = "force-dynamic";

export default async function UiGallery({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  let query;
  try {
    query = parseUiQuery(await searchParams);
  } catch {
    notFound();
  }

  const fixture = UI_FIXTURES[query.view];
  return (
    <OperationalFrame>
      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <PageHeader eyebrow={`UI dev · ${query.view}`} title={fixture.title} description={fixture.description} />
        <FixtureState state={query.state} />
      </main>
    </OperationalFrame>
  );
}

function FixtureState({ state }: { readonly state: "default" | "empty" | "error" | "loading" }) {
  if (state === "empty") return <EmptyState heading="Nenhum resultado">Ajuste os filtros para continuar.</EmptyState>;
  if (state === "error") return <Alert heading="Falha controlada">O próximo passo é tentar novamente ou conferir a fonte.</Alert>;
  if (state === "loading") return <div aria-busy="true" role="status"><StatusBadge tone="info">Carregando…</StatusBadge></div>;
  return <StatusBadge tone="success">Estado padrão</StatusBadge>;
}
