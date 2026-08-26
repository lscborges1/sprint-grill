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
  title: "Aplicar cupom de desconto no checkout",
  url: "https://example.com/117",
} as const;

const DECISION = {
  questionSeq: 1,
  questionId: "question-1",
  question: "Cupom pode acumular com promoção automática?",
  recommendation: "Não acumular no primeiro piloto; escolher sempre o maior desconto.",
  answer: "Não acumula. O checkout deve aplicar o maior desconto elegível e registrar o motivo.",
  decidedAt: 1768478400000,
} as const;

const SPEC_MARKDOWN = "# Spec da US #117 — Aplicar cupom de desconto no checkout\n";
const TICKETS_MARKDOWN = "## Validar elegibilidade do cupom\n";

const ACTIVE_QUESTION = {
  questionSeq: 1,
  id: "question-1",
  agendaItemId: "agenda-1",
  source: "agent",
  header: "Regra de negócio",
  question: "Cupom pode acumular com promoção automática?",
  recommendation: "Não acumular no primeiro piloto; escolher sempre o maior desconto para reduzir ambiguidade de cálculo e suporte.",
  evidence: ["checkout-api · src/pricing/discounts.ts", "checkout-web · src/cart/apply-coupon.ts"],
  options: [
    { label: "Não acumula", description: "Mais simples de auditar; evita desconto duplo inesperado." },
    { label: "Acumula", description: "Exige regra explícita de ordem, teto e arredondamento." },
  ],
  allowFreeText: true,
} as const satisfies PalcoState["pendingQuestions"][number];

const ACTIVE_AGENDA_ITEM = {
  id: ACTIVE_QUESTION.agendaItemId,
  question: ACTIVE_QUESTION.question,
  createdAt: 1,
  updatedAt: 1,
  status: "aguardando-sala",
} as const satisfies PalcoState["agenda"][number];

export const PICKER_STORIES = [
  {
    ...STORY,
    type: "User Story",
    state: "Active",
    assignedTo: undefined,
    refinement: "sem-investigacao",
    action: { kind: "start", label: "Investigar" },
  },
  {
    id: 118,
    title: "Exibir histórico de tentativas de pagamento",
    url: "https://example.com/118",
    type: "User Story",
    state: "Active",
    assignedTo: undefined,
    refinement: "investigada",
    action: { kind: "open", label: "Revisar relatório" },
  },
  {
    id: 119,
    title: "Notificar cliente sobre expiração de orçamento",
    url: "https://example.com/119",
    type: "User Story",
    state: "Active",
    assignedTo: undefined,
    refinement: "refinada",
    action: { kind: "open", label: "Revisar relatório" },
  },
] as const satisfies readonly PickerStory[];

export const INVESTIGATION_MODEL = {
  storyId: STORY.id,
  openCeremonyId: undefined,
  run: {
    storyId: STORY.id,
    story: {
      ...STORY,
      type: "User Story",
      state: "Active",
      description: "Como cliente, quero informar um cupom no checkout para receber desconto antes de finalizar a compra.",
      wikiContext: {
        references: [],
        omitted: [],
        attempts: 0,
        contentCharacters: 0,
      },
    },
    startedAt: 1,
    finishedAt: 2,
    previous: undefined,
    publication: undefined,
    status: "aprovado",
    report: {
      summary: "A US parece simples na superfície, mas toca cálculo de preço, idempotência do pedido e mensagens de erro do checkout. A Investigação antecipa decisões sobre cumulatividade, expiração e auditoria do desconto antes de a US entrar na sprint.",
      gaps: [
        {
          question: "Cupom pode acumular com promoção automática?",
          why: "Sem esta regra, o cálculo pode aplicar desconto duplo ou divergir entre tela e backend.",
        },
        {
          question: "Qual mensagem aparece quando o cupom expira durante o checkout?",
          why: "A validação pode acontecer minutos depois da digitação, no fechamento do pedido.",
        },
        {
          question: "O desconto aplicado precisa ficar auditável no pedido?",
          why: "Suporte e financeiro podem precisar explicar o preço final depois da compra.",
        },
      ],
      impacts: [
        {
          claim: "O cálculo de total precisa receber uma fonte de desconto adicional sem quebrar promoções já existentes.",
          citations: [{ repo: "checkout-api", path: "src/pricing/discounts.ts", symbol: "calculateDiscount" }],
        },
        {
          claim: "A UI do carrinho já tem uma ação de recálculo assíncrona que precisa representar erro de cupom sem perder o estado do checkout.",
          citations: [{ repo: "checkout-web", path: "src/cart/apply-coupon.ts", symbol: "applyCoupon" }],
        },
      ],
      externalRepos: [
        { repo: "billing", suspicion: "Pode precisar receber o motivo do desconto para conciliação, mas este repo não está na config da squad." },
      ],
      unverified: ["Não foi possível confirmar no código se cupons têm limite por cliente."],
    },
    markdown: "# Investigação — US #117\n\n## Furos da US\n\n- **Cupom pode acumular com promoção automática?** — Sem esta regra, o cálculo pode aplicar desconto duplo ou divergir entre tela e backend.\n- **Qual mensagem aparece quando o cupom expira durante o checkout?** — A validação pode acontecer minutos depois da digitação, no fechamento do pedido.\n- **O desconto aplicado precisa ficar auditável no pedido?** — Suporte e financeiro podem precisar explicar o preço final depois da compra.\n\n## Impactos verificados\n\n- O cálculo de total precisa receber uma fonte de desconto adicional sem quebrar promoções já existentes.\n  - checkout-api · src/pricing/discounts.ts · calculateDiscount\n- A UI do carrinho já tem uma ação de recálculo assíncrona que precisa representar erro de cupom sem perder o estado do checkout.\n  - checkout-web · src/cart/apply-coupon.ts · applyCoupon\n",
  },
} as const satisfies InvestigationViewModel;

export const PALCO_STATE = {
  sessionId: "fixture-session",
  story: STORY,
  refinement: { phase: "refinando", revision: 1 },
  completionProposal: null,
  agenda: [ACTIVE_AGENDA_ITEM],
  decisionCount: 0,
  decisions: [],
  pendingQuestions: [ACTIVE_QUESTION],
  lastDecision: null,
  consultation: null,
  pending: [],
  live: true,
  current: {
    phase: "perguntando",
    question: ACTIVE_QUESTION,
  },
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
  investigation: {
    impact: "Impactos no cálculo de desconto e no estado assíncrono do checkout.",
    unverified: "Limite de uso por cliente ainda não confirmado.",
  },
  spec: { generated: SPEC_MARKDOWN, draft: null },
  taskPreview: TICKETS_MARKDOWN,
  artifacts: {
    spec: {
      revision: 3,
      submission: {
        problem: "A US de cupom não define regras suficientes para implementar o desconto com segurança.",
        solution: "Aplicar cupom sem cumulatividade no piloto, com mensagem clara de expiração e auditoria do desconto no pedido.",
        expectedBehaviors: ["Aplica o maior desconto elegível.", "Mostra erro claro para cupom expirado."],
        implementationDecisions: ["Cupom não acumula com promoção automática.", "Pedido registra código e motivo do desconto aplicado."],
        testStrategy: ["Teste de cálculo com promoção existente.", "Teste de cupom expirado entre digitação e fechamento."],
        outOfScope: ["Criar campanha de marketing de cupons."],
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
          title: "Validar elegibilidade do cupom",
          description: "Entrega a regra de cupom sem cumulatividade no checkout.",
          acceptanceCriteria: ["Retorna o maior desconto elegível.", "Registra motivo do desconto no pedido."],
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
