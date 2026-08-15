import { notFound } from "next/navigation";
import { startCeremonyAction } from "@/app/cerimonia/actions";
import { findOpenCeremony } from "@/lib/ceremonies";
import { getInvestigation, storyIdSchema } from "@/lib/investigations";
import { publishInvestigationAction } from "../actions";
import { InvestigationView } from "./investigation-view";

// O preview mostra o estado do turno agora; nada aqui é pré-renderizável.
export const dynamic = "force-dynamic";

export default async function InvestigationPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const parsed = storyIdSchema.safeParse((await params).storyId);
  if (!parsed.success) notFound();

  const storyId = parsed.data;
  const run = getInvestigation(storyId);
  const openCeremonyId = run?.status === "aprovado"
    ? findOpenCeremony(storyId)?.id
    : undefined;

  return (
    <InvestigationView
      model={{ storyId, run, openCeremonyId }}
      actions={{
        startCeremony: startCeremonyAction,
        publishInvestigation: publishInvestigationAction,
      }}
    />
  );
}
