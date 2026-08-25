import type { StoryDetails } from "@sprint-griller/ado-client";

/** A US como a Investigação precisa dela: o que o agente lê e para onde linkar. */
export type InvestigationStory = Pick<
  StoryDetails,
  "id" | "title" | "description" | "url" | "wikiContext"
>;
