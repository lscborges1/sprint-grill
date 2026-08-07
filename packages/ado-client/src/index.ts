export { AdoError } from "./ado-error";
export type { AdoErrorKind } from "./ado-error";
export { publishInvestigation } from "./investigation/publish-investigation";
export type {
  InvestigationToPublish,
  PublishedInvestigation,
} from "./investigation/publish-investigation";
export { fetchCurrentIteration } from "./iteration/current-iteration";
export type {
  CurrentIteration,
  IterationStory,
} from "./iteration/current-iteration";
// Quem gravar artefato novo no ADO precisa embutir o marcador — é o que o
// picker lê para inferir o status. Ver README, "Status de refinamento".
export {
  INVESTIGATION_MARKER,
  SPEC_MARKER,
} from "./refinement/refinement-status";
export type { RefinementStatus } from "./refinement/refinement-status";
export type { AdoClientOptions } from "./rest/ado-rest";
export { fetchStory } from "./story/story";
export type { StoryDetails } from "./story/story";
