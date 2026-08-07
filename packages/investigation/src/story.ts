/** A US como a Investigação precisa dela: o que o agente lê e para onde linkar. */
export interface InvestigationStory {
  readonly id: number;
  readonly title: string;
  /** Como veio do Azure DevOps — HTML, na maioria dos processos. */
  readonly description: string | undefined;
  readonly url: string;
}
