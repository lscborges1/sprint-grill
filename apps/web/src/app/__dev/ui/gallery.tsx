import type { ReactElement } from "react";
import { DossieView } from "@/app/cerimonia/[sessionId]/dossie/dossie";
import { PalcoView } from "@/app/cerimonia/[sessionId]/palco";
import {
  InvestigationView,
  type InvestigationFormAction,
} from "@/app/investigacao/[storyId]/investigation-view";
import { OperationalFrame } from "@/components/operational-frame";
import { Picker } from "@/components/picker";
import {
  DOSSIE_STATE,
  INVESTIGATION_MODEL,
  PALCO_STATE,
  PICKER_STORIES,
  type UiView,
} from "./fixtures";

export interface UiGalleryViewProps {
  readonly view: UiView;
  readonly action: InvestigationFormAction;
}

export function UiGalleryView({ view, action }: UiGalleryViewProps): ReactElement {
  switch (view) {
    case "picker":
      return (
        <OperationalFrame>
          <Picker
            iterationName="Sprint fixture"
            stories={PICKER_STORIES}
            project="Plataforma"
            repos={{ primary: { name: "core-api", path: "/fixture/core-api" }, related: [] }}
            startAction={action}
          />
        </OperationalFrame>
      );
    case "investigacao":
      return (
        <InvestigationView
          model={INVESTIGATION_MODEL}
          actions={{ startCeremony: action, publishInvestigation: action }}
        />
      );
    case "palco":
      return <PalcoView state={PALCO_STATE} connected />;
    case "dossie":
      return <DossieView state={DOSSIE_STATE} connected />;
  }
}
