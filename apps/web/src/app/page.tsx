import type { CurrentIteration } from "@sprint-griller/ado-client";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { OperationalFrame } from "@/components/operational-frame";
import { Picker, type PickerStory } from "@/components/picker";
import { loadCurrentIteration } from "@/lib/current-iteration";
import { getInvestigation } from "@/lib/investigations";
import { derivePickerAction } from "@/lib/picker-action";
import { getSquadConfig } from "@/lib/squad-config";
import { startInvestigationAction } from "./investigacao/actions";

// A iteration é lida do Azure DevOps a cada request; nada aqui é pré-renderizável.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { azureDevOps, repos } = getSquadConfig();
  const result = await loadCurrentIteration();

  return (
    <OperationalFrame>
      {result.status === "error" ? (
        <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <PageHeader eyebrow="Picker" title="Refina" description={`US da sprint atual de ${azureDevOps.project}.`} />
          <Alert heading="Não deu para ler o Azure DevOps">{result.message}</Alert>
        </main>
      ) : result.iteration === undefined ? (
        <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <PageHeader eyebrow="Picker" title="Refina" description={`US da sprint atual de ${azureDevOps.project}.`} />
          <EmptyState heading="Nenhuma iteration corrente">Abra a sprint no board do Azure DevOps e recarregue esta tela.</EmptyState>
        </main>
      ) : (
        <Picker
          iterationName={result.iteration.name}
          stories={pickerStories(result.iteration)}
          project={azureDevOps.project}
          repos={repos}
          startAction={startInvestigationAction}
        />
      )}
    </OperationalFrame>
  );
}

function pickerStories(iteration: CurrentIteration): readonly PickerStory[] {
  return iteration.stories.map((story) => ({
    ...story,
    action: derivePickerAction(story.refinement, getInvestigation(story.id)),
  }));
}
