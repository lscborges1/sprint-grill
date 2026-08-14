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
  assertValidPublicationSpecMarkdown,
  readSpecSection,
  renderSpecMarkdown,
  renderStructuredSpecMarkdown,
  assertValidStructuredSpecMarkdown,
  stripDecisionRecordLinks,
} from "./spec";
export { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";
export {
  parseTaskDraft,
  renderStructuredTicketsMarkdown,
  assertValidStructuredTickets,
  taskDraftTemplate,
  taskPreviewFromTranscript,
  validateTaskDraft,
} from "./task-draft";
export type { StructuredTicket, TaskDraft, TaskDraftValidation } from "./task-draft";
export type {
  ArtifactGateInput,
  DiscardSpecDraftInput,
  RecordDecisionInput,
  SaveSpecDraftInput,
  TransitionRefinementItemInput,
  UpdateRefinementPhaseInput,
} from "./store";
export type {
  ApprovedRefinementArtifacts,
  ArtifactApproval,
  RefinementArtifactState,
  SpecArtifact,
  TicketArtifact,
} from "./artifact-workflow";
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
  RefinementCompletionProposal,
  RefinementItemTransition,
  RefinementPhase,
  RefinementResolution,
  RefinementState,
  RoomChoiceConsultation,
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
