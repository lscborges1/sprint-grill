export { CeremonyError } from "./ceremony-error";
export { NAO_E_DECISAO, createCeremony } from "./ceremony";
export type {
  Ceremony,
  ConsultInput,
  CreateCeremonyOptions,
  StartCeremonyInput,
} from "./ceremony";
export { readDossie } from "./dossie";
export { readPalco } from "./palco";
export { ceremonyInstructions, ceremonyOpeningPrompt, ceremonyResumePrompt } from "./prompt";
export type { CeremonyStory } from "./prompt";
// Os schemas de estado vivem em subpaths: o browser não pode puxar SQLite pelo barril.
export { palcoStateSchema } from "./palco-state";
export { dossieStateSchema } from "./session-state";
export {
  appendDecisionTraceability,
  readSpecSection,
  renderSpecMarkdown,
  stripDecisionRecordLinks,
} from "./spec";
export { SPEC_BLURB, SPEC_SECTIONS } from "./spec-vocabulary";
export { openCeremonyStore } from "./store";
export type {
  CeremonyStore,
  AttachDecisionRecordInput,
  CreateSessionInput,
  DiscardSpecDraftInput,
  FinishSessionOutcome,
  RecordDecisionInput,
  SaveSpecDraftInput,
} from "./store";
export type {
  CeremonyCitation,
  CeremonyConsultation,
  CeremonyDecision,
  CeremonyQuestion,
  CeremonyQuestionOption,
  CeremonySession,
  ConsultationOutcome,
  PersistedCeremonyQuestion,
  DossieDocument,
  DossiePendingQuestion,
  DossieState,
  PalcoPhase,
  PalcoState,
  SessionStatus,
  SpecDraft,
  StoryRef,
  TranscriptEntry,
  TranscriptEvent,
  UnverifiedConsultation,
  VerifiedConsultation,
} from "./types";
