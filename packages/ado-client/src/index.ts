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
  dumpCompletionMarker,
  dumpMarker,
} from "./refinement/dump-marker";
export type {
  DecisionRecordToPublish,
  ChildTaskToPublish,
  ChildTasksToPublish,
  PublishedDecisionRecord,
  StorySpecToPublish,
} from "./refinement/publish-refinement";
export { fetchCurrentIteration } from "./iteration/current-iteration";
export type {
  CurrentIteration,
  IterationStory,
} from "./iteration/current-iteration";
export { renderRolloverReport } from "./metrics/rollover-report";
export type { RolloverReportOptions } from "./metrics/rollover-report";
export { fetchRolloverBaseline } from "./metrics/rollover";
export type {
  RolloverBaseline,
  RolloverBaselineOptions,
  RolloverCounts,
  SprintRollover,
} from "./metrics/rollover";
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
