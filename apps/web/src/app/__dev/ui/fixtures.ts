import type { DossieState, PalcoState } from "@sprint-griller/ceremony";
import type { PickerStory } from "@/components/picker";
import type { InvestigationViewModel } from "@/app/investigacao/[storyId]/investigation-view";
import { z } from "zod";

export const UI_VIEWS = ["picker", "investigacao", "palco", "dossie"] as const;

export const uiQuerySchema = z.object({
  view: z.enum(UI_VIEWS).default("picker"),
}).strict();

export type UiQuery = z.infer<typeof uiQuerySchema>;
export type UiView = UiQuery["view"];

const STORY = {
  id: 117,
  title: "Exportar relatório",
  url: "https://example.com/117",
} as const;

const DECISION = {
  questionSeq: 1,
  questionId: "question-1",
  question: "Qual formato será exportado?",
  recommendation: "CSV em UTF-8.",
  answer: "CSV em UTF-8.",
  decidedAt: 1,
} as const;

const SPEC_MARKDOWN = "# Spec da US #117 — Exportar relatório\n";
const TICKETS_MARKDOWN = "## Implementar exportação\n";

export const PICKER_STORIES = [{
  ...STORY,
  type: "User Story",
  state: "Active",
  assignedTo: "Ana",
  refinement: "investigada",
  action: { kind: "open", label: "Revisar relatório" },
}] as const satisfies readonly PickerStory[];

export const INVESTIGATION_MODEL = {
  storyId: STORY.id,
  openCeremonyId: undefined,
  run: {
    storyId: STORY.id,
    story: {
      ...STORY,
      type: "User Story",
      state: "Active",
      description: "Exportar o relatório em CSV.",
    },
    startedAt: 1,
    finishedAt: 2,
    previous: undefined,
    publication: undefined,
    status: "reprovado",
    report: {
      summary: "A regra ainda não está ancorada no código.",
      gaps: [],
      impacts: [],
      externalRepos: [],
      unverified: ["Formato final do CSV."],
    },
    markdown: "# Investigação — US #117\n",
    violations: [{
      claim: "O endpoint já existe.",
      citation: { repo: "core-api", path: "src/export.ts" },
      reason: "caminho-inexistente",
      detail: "core-api: o arquivo src/export.ts não existe.",
    }],
  },
} as const satisfies InvestigationViewModel;

export const PALCO_STATE = {
  sessionId: "fixture-session",
  story: STORY,
  refinement: { phase: "publicado", revision: 6 },
  completionProposal: null,
  agenda: [],
  decisionCount: 1,
  decisions: [DECISION],
  pendingQuestions: [],
  lastDecision: DECISION,
  consultation: null,
  pending: [],
  live: false,
  current: { phase: "encerrada" },
} as const satisfies PalcoState;

export const DOSSIE_STATE = {
  sessionId: "fixture-session",
  status: "encerrada",
  timeZone: "UTC",
  refinement: { phase: "publicado", revision: 6 },
  completionProposal: null,
  agenda: [],
  story: STORY,
  decisions: [DECISION],
  pending: [],
  investigation: { impact: "Impacto confirmado.", unverified: "Nenhuma hipótese." },
  spec: { generated: SPEC_MARKDOWN, draft: null },
  taskPreview: TICKETS_MARKDOWN,
  artifacts: {
    spec: {
      revision: 3,
      submission: {
        problem: "Exportação indisponível.",
        solution: "Gerar CSV.",
        expectedBehaviors: ["Entrega CSV em UTF-8."],
        implementationDecisions: ["Processamento síncrono."],
        testStrategy: ["Teste de integração do endpoint."],
        outOfScope: [],
        traceability: ["question-1"],
      },
      markdown: SPEC_MARKDOWN,
      submittedAt: 2,
      approval: {
        revision: 3,
        hash: "spec-hash",
        markdown: SPEC_MARKDOWN,
        approvedAt: 3,
      },
    },
    tickets: {
      revision: 4,
      submission: {
        tickets: [{
          id: "task-1",
          title: "Implementar exportação",
          description: "Entrega o CSV da US.",
          acceptanceCriteria: ["Retorna CSV em UTF-8."],
          specUrl: STORY.url,
          blockedBy: [],
        }],
      },
      markdown: TICKETS_MARKDOWN,
      submittedAt: 4,
      specRevision: 3,
      specHash: "spec-hash",
      approval: {
        revision: 4,
        hash: "tickets-hash",
        markdown: TICKETS_MARKDOWN,
        approvedAt: 5,
        specRevision: 3,
        specHash: "spec-hash",
      },
    },
  },
  dump: {
    status: "completed",
    inputs: {
      dumpId: "dump-fixture",
      markdown: SPEC_MARKDOWN,
      tasksMarkdown: TICKETS_MARKDOWN,
      estimate: 3,
    },
    completedAt: 6,
  },
} as const satisfies DossieState;

export function parseUiQuery(input: unknown): UiQuery {
  const result = uiQuerySchema.safeParse(input);
  if (!result.success) throw new Error("Fixture de UI inválida.");
  return result.data;
}
