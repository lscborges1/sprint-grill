import type { BacklogStory } from "@sprint-griller/ado-client";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { OperationalFrame } from "@/components/operational-frame";
import { Picker, type PickerStory } from "@/components/picker";
import { loadBacklog } from "@/lib/backlog";
import { getInvestigation } from "@/lib/investigations";
import { derivePickerAction } from "@/lib/picker-action";
import { getSquadConfig } from "@/lib/squad-config";
import { startInvestigationAction } from "./investigacao/actions";

// O backlog é lido do Azure DevOps a cada request; nada aqui é pré-renderizável.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { azureDevOps, repos } = getSquadConfig();
  const result = await loadBacklog();

  return (
    <OperationalFrame>
      {result.status === "error" ? (
        <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <PageHeader eyebrow="Picker" title="Refina" description={`US do backlog de ${azureDevOps.project}.`} />
          <Alert heading="Não deu para ler o Azure DevOps">{result.message}</Alert>
        </main>
      ) : result.stories.length === 0 ? (
        <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <PageHeader eyebrow="Picker" title="Refina" description={`US do backlog de ${azureDevOps.project}.`} />
          <EmptyState heading="O backlog não tem US">Quando o PO criar uma US no backlog do Azure DevOps, ela aparecerá aqui.</EmptyState>
        </main>
      ) : (
        <Picker
          stories={pickerStories(result.stories)}
          project={azureDevOps.project}
          repos={repos}
          startAction={startInvestigationAction}
        />
      )}
    </OperationalFrame>
  );
}

function pickerStories(stories: readonly BacklogStory[]): readonly PickerStory[] {
  return stories.map((story) => ({
    ...story,
    action: derivePickerAction(story.refinement, getInvestigation(story.id)),
  }));
}
