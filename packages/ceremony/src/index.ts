export { CeremonyError } from "./ceremony-error";
export { NAO_E_DECISAO, createCeremony } from "./ceremony";
export type {
  Ceremony,
  ConsultInput,
  CreateCeremonyOptions,
  StartCeremonyInput,
} from "./ceremony";
export { readPalco } from "./palco";
// O schema do estado mora no subpath `/palco-state`: é o que o browser importa,
// e ele não pode arrastar o store (SQLite nativo) junto.
export { palcoStateSchema } from "./palco-state";
export { ceremonyInstructions, ceremonyOpeningPrompt, ceremonyResumePrompt } from "./prompt";
export type { CeremonyStory } from "./prompt";
export { openCeremonyStore } from "./store";
export type {
  CeremonyStore,
  CreateSessionInput,
  FinishSessionOutcome,
  RecordDecisionInput,
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
  PalcoPhase,
  PalcoState,
  SessionStatus,
  TranscriptEntry,
  TranscriptEvent,
} from "./types";
