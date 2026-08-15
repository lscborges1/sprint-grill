import type { RefinementStatus } from "@sprint-griller/ado-client";
import type { InvestigationRun } from "./investigations";

export type PickerAction =
  | { readonly kind: "start"; readonly label: "Investigar" | "Investigar novamente" }
  | {
      readonly kind: "open";
      readonly label:
        | "Acompanhar execução"
        | "Revisar falha"
        | "Revisar reprovação"
        | "Tentar publicação"
        | "Conferir publicação"
        | "Revisar relatório";
    };

export function derivePickerAction(
  persisted: RefinementStatus,
  run: InvestigationRun | undefined,
): PickerAction {
  if (run === undefined) {
    return {
      kind: "start",
      label: persisted === "sem-investigacao" ? "Investigar" : "Investigar novamente",
    };
  }
  if (run.status === "em-andamento") return { kind: "open", label: "Acompanhar execução" };
  if (run.status === "falhou") return { kind: "open", label: "Revisar falha" };
  if (run.status === "reprovado") return { kind: "open", label: "Revisar reprovação" };
  if (run.publication?.status === "falhou") return { kind: "open", label: "Tentar publicação" };
  if (run.publication?.status === "incerta") return { kind: "open", label: "Conferir publicação" };
  return { kind: "open", label: "Revisar relatório" };
}
