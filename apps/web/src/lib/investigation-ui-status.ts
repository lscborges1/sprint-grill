import type { RefinementStatus } from "@sprint-griller/ado-client";
import type { InvestigationRun } from "./investigations";

export type InvestigationUiStatus =
  | { readonly kind: "ready"; readonly persisted: RefinementStatus }
  | { readonly kind: "running"; readonly persisted: RefinementStatus; readonly startedAt: number }
  | { readonly kind: "failure"; readonly persisted: RefinementStatus; readonly message: string }
  | { readonly kind: "review-rejected"; readonly persisted: RefinementStatus }
  | { readonly kind: "review-approved"; readonly persisted: RefinementStatus }
  | { readonly kind: "published"; readonly persisted: RefinementStatus; readonly commentId: number }
  | { readonly kind: "publication-failure"; readonly persisted: RefinementStatus; readonly message: string }
  | { readonly kind: "publication-uncertain"; readonly persisted: RefinementStatus; readonly message: string };

export function deriveInvestigationUiStatus(
  persisted: RefinementStatus,
  run: InvestigationRun | undefined,
): InvestigationUiStatus {
  if (run === undefined) return { kind: "ready", persisted };
  if (run.status === "em-andamento") {
    return { kind: "running", persisted, startedAt: run.startedAt };
  }
  if (run.status === "falhou") {
    return { kind: "failure", persisted, message: run.message };
  }
  if (run.status === "reprovado") {
    return { kind: "review-rejected", persisted };
  }
  if (run.publication?.status === "publicada") {
    return { kind: "published", persisted, commentId: run.publication.commentId };
  }
  if (run.publication?.status === "falhou") {
    return { kind: "publication-failure", persisted, message: run.publication.message };
  }
  if (run.publication?.status === "incerta") {
    return { kind: "publication-uncertain", persisted, message: run.publication.message };
  }
  return { kind: "review-approved", persisted };
}
