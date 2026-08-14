export { CeremonyError } from "./ceremony-error";
export { createCeremonyLifecycle } from "./lifecycle";
export type {
  CeremonyLifecycle,
  CreateCeremonyLifecycleOptions,
} from "./lifecycle";
export type {
  CeremonyDumpInput,
} from "./despejo";
// Os schemas de estado vivem em subpaths: o browser não pode puxar SQLite pelo barril.
export { palcoStateSchema } from "./palco-state";
export { dossieStateSchema, signedDumpInputs } from "./session-state";
export {
  appendDecisionTraceability,
  assertValidSpecMarkdown,
  readSpecSection,
  renderSpecMarkdown,
  stripDecisionRecordLinks,
} from "./spec";
export { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";
export {
  parseTaskDraft,
  taskDraftTemplate,
  taskPreviewFromTranscript,
  validateTaskDraft,
} from "./task-draft";
export type { TaskDraft, TaskDraftValidation } from "./task-draft";
export type {
  DiscardSpecDraftInput,
  RecordDecisionInput,
  SaveSpecDraftInput,
  TransitionRefinementItemInput,
  UpdateRefinementPhaseInput,
} from "./store";
export type {
  CeremonyCitation,
  CeremonyConsultation,
  CeremonyDecision,
  CeremonyQuestion,
  CeremonyQuestionOption,
  CeremonySession,
  CeremonyDumpState,
  ConsultationOutcome,
  PersistedCeremonyQuestion,
  DossieDocument,
  DossiePendingQuestion,
  DossieState,
  PalcoPhase,
  PalcoState,
  RefinementItem,
  RefinementItemTransition,
  RefinementPhase,
  RefinementResolution,
  RefinementState,
  SeedRefinementItemInput,
  SessionStatus,
  SignedDumpInputs,
  SpecDraft,
  StoryRef,
  TranscriptEntry,
  TranscriptEvent,
  UnverifiedConsultation,
  VerifiedConsultation,
} from "./types";
