export { AdoError } from "./ado-error";
export type { AdoErrorKind } from "./ado-error";
export { publishInvestigation } from "./investigation/publish-investigation";
export type {
  InvestigationToPublish,
  PublishedInvestigation,
} from "./investigation/publish-investigation";
export {
  publishDecisionRecord,
  publishChildTasks,
  publishDumpCompletion,
  publishStorySpec,
  readDumpCompletion,
  readIncompleteDumps,
  renderDecisionRecordMarkdown,
  replaceManagedSpec,
  markdownToAdoHtml,
} from "./refinement/publish-refinement";
export {
  dumpAudits,
  dumpAuditMarker,
  dumpCompletionMarker,
  dumpMarker,
} from "./refinement/dump-marker";
export type { DumpAudit } from "./refinement/dump-marker";
export type {
  DecisionRecordToPublish,
  ChildTaskToPublish,
  ChildTasksToPublish,
  PublishedDecisionRecord,
  StorySpecToPublish,
} from "./refinement/publish-refinement";
export { fetchBacklog } from "./backlog/backlog";
export type { BacklogStory } from "./backlog/backlog";
export { renderRolloverReport } from "./metrics/rollover-report";
export type { RolloverReportOptions } from "./metrics/rollover-report";
export { fetchRolloverBaseline } from "./metrics/rollover";
export type {
  RolloverBaseline,
  RolloverBaselineOptions,
  RolloverCounts,
  SprintRollover,
} from "./metrics/rollover";
export { fetchSprintMetrics } from "./metrics/sprint-metrics";
export { renderSprintMetricsReport } from "./metrics/sprint-metrics-report";
export type {
  DumpDoubt,
  RefinementCoverage,
  SprintMetrics,
  SprintMetricsReport,
} from "./metrics/sprint-metrics";
// O picker lê a Investigação e a conclusão do dump para inferir o status.
// SPEC_MARKER identifica o bloco gerenciado, mas não significa "refinada".
export {
  INVESTIGATION_MARKER,
  SPEC_MARKER,
} from "./refinement/refinement-status";
export type { RefinementStatus } from "./refinement/refinement-status";
export type { AdoClientOptions } from "./rest/ado-rest";
export { fetchStory } from "./story/story";
export type { StoryDetails } from "./story/story";
