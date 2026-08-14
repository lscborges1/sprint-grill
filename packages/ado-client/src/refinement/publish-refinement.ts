import markdownIt from "markdown-it";
import { z } from "zod";
import { AdoError } from "../ado-error";
import {
  completedDumpIds,
  dumpAuditMarker,
  dumpCompletionMarker,
  dumpMarker,
  incompleteDumpIds,
} from "./dump-marker";
import { SPEC_MARKER } from "./refinement-status";
import { COMMENTS_API_VERSION, createAdoRest } from "../rest/ado-rest";
import type { AdoClientOptions } from "../rest/ado-rest";

const SPEC_BLOCK_START = "<!-- sprint-griller:spec:start -->";
const SPEC_BLOCK_END = "<!-- sprint-griller:spec:end -->";
const MARKDOWN_FORMAT = "markdown";

const adoMarkdown = markdownIt({ html: false, linkify: false });
// Parse every syntactically valid destination so unsafe links can retain their
// visible label while the renderer removes only the active element.
adoMarkdown.validateLink = () => true;
adoMarkdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const href = tokens[index]?.attrGet("href");
  if (href !== null && href !== undefined && isAllowedDestination(href, ["http:", "https:", "mailto:"])) {
    return renderer.renderToken(tokens, index, options);
  }

  const closing = tokens.slice(index + 1).find((token) => token.type === "link_close");
  if (closing) closing.hidden = true;
  return "";
};
adoMarkdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const image = tokens[index];
  const source = image?.attrGet("src");
  if (
    image !== undefined &&
    source !== null &&
    source !== undefined &&
    isAllowedDestination(source, ["http:", "https:"])
  ) {
    image.attrSet("alt", renderer.renderInlineAsText(image.children ?? [], options, env));
    return renderer.renderToken(tokens, index, options);
  }

  return adoMarkdown.utils.escapeHtml(
    renderer.renderInlineAsText(image?.children ?? [], options, env),
  );
};

export interface DecisionRecordToPublish {
  readonly storyId: number;
  /** Identidade determinística do despejo para reconciliação após crash. */
  readonly dumpId: string;
  readonly questionSeq: number;
  readonly question: string;
  readonly answer: string;
  readonly recommendation: string;
  readonly decidedAt: number;
}

export interface PublishedDecisionRecord {
  readonly commentId: number;
  /** A tela do work item é a superfície navegável onde o comment mora. */
  readonly url: string;
}

export interface StorySpecToPublish {
  readonly storyId: number;
  readonly dumpId: string;
  /** Markdown que o Operador assinou, já com o bloco de rastreabilidade. */
  readonly markdown: string;
  /** Estimativa humana da squad; o campo muda conforme o processo do projeto. */
  readonly estimate: number;
}

export interface ChildTaskToPublish {
  readonly title: string;
  /** Corpo Markdown completo assinado pelo Operador, sem o heading do título. */
  readonly bodyMarkdown: string;
  /** Títulos de outras tasks deste mesmo despejo que precisam terminar antes. */
  readonly blockedBy: readonly string[];
}

export interface ChildTasksToPublish {
  readonly storyId: number;
  readonly dumpId: string;
  readonly tasks: readonly ChildTaskToPublish[];
}

const commentSchema = z.object({ commentId: z.number().int().positive() });
const commentsSchema = z.object({
  comments: z.array(z.object({
    commentId: z.number().int().positive().optional(),
    id: z.number().int().positive().optional(),
    text: z.string(),
  })).default([]),
  continuationToken: z.string().nullable().optional(),
});
const storySchema = z.object({
  id: z.number().int().positive(),
  rev: z.number().int().nonnegative(),
  fields: z.object({
    "System.Description": z.string().optional(),
    "System.WorkItemType": z.string().min(1),
  }),
});
const updatedStorySchema = z.object({ id: z.number().int().positive() });
const workItemTypeFieldsSchema = z.object({
  value: z.array(z.object({ referenceName: z.string() })),
});
const taskTypeCategorySchema = z.object({
  workItemTypes: z.array(z.object({ name: z.string().min(1) })),
});
const wiqlIdsSchema = z.object({ workItems: z.array(z.object({ id: z.number().int().positive() })) });
const workItemRelationSchema = z.object({
  rel: z.string(),
  url: z.url(),
}).transform((relation) => ({
  rel: relation.rel,
  targetWorkItemId: workItemIdFromUrl(relation.url),
}));
const taskBatchSchema = z.object({
  value: z.array(z.object({
    id: z.number().int().positive(),
    fields: z.object({
      "System.Title": z.string(),
      "System.Description": z.string().optional(),
    }),
    relations: z.array(workItemRelationSchema).default([]),
  })),
});

/** Renderização determinística do Registro — o LLM nunca participa da escrita. */
export function renderDecisionRecordMarkdown(record: Omit<DecisionRecordToPublish, "storyId">): string {
  return [
    dumpMarker(record.dumpId, `decision:${record.questionSeq}`),
    "# Registro de decisão",
    `**Pergunta:** ${record.question}`,
    `**Decisão:** ${record.answer}`,
    `**Recomendação do agente:** ${record.recommendation}`,
    `**Quando:** ${new Date(record.decidedAt).toISOString()}`,
  ].join("\n\n");
}

/** Cria o comment que é o Registro de decisão de uma resposta humana da sessão. */
export async function publishDecisionRecord(
  options: AdoClientOptions,
  record: DecisionRecordToPublish,
): Promise<PublishedDecisionRecord> {
  const rest = createAdoRest(options);
  const marker = dumpMarker(record.dumpId, `decision:${record.questionSeq}`);
  const comments = await listDecisionRecordComments(rest, record.storyId);
  const existing = comments.filter((comment) => comment.text.includes(marker));
  if (existing.length > 1) {
    throw new AdoError("unexpected", `Há mais de um Registro para a decisão ${record.questionSeq}. Confira a US antes de despejar.`);
  }
  if (existing.length === 1) {
    const commentId = existing[0]?.commentId ?? existing[0]?.id;
    if (!commentId) {
      throw new AdoError("unexpected-response", "O Azure DevOps devolveu um Registro sem id para reconciliação.");
    }
    return { commentId, url: `${rest.workItemUrl(record.storyId)}#discussion_${commentId}` };
  }
  const comment = await rest.request({
    operation: "o Registro de decisão",
    path: `_apis/wit/workItems/${record.storyId}/comments`,
    apiVersion: COMMENTS_API_VERSION,
    query: { format: MARKDOWN_FORMAT },
    schema: commentSchema,
    write: true,
    body: { text: renderDecisionRecordMarkdown(record) },
    notFound: `O Azure DevOps não encontrou a US #${record.storyId} no projeto configurado — nada foi publicado.`,
  });

  return {
    commentId: comment.commentId,
    url: `${rest.workItemUrl(record.storyId)}#discussion_${comment.commentId}`,
  };
}

async function listDecisionRecordComments(
  rest: ReturnType<typeof createAdoRest>,
  storyId: number,
): Promise<z.infer<typeof commentsSchema>["comments"]> {
  const all: z.infer<typeof commentsSchema>["comments"][number][] = [];
  let continuationToken: string | undefined;

  do {
    const result = await rest.requestWithHeaders({
      operation: "os Registros de decisão da US",
      path: `_apis/wit/workItems/${storyId}/comments`,
      apiVersion: COMMENTS_API_VERSION,
      query: {
        $top: "200",
        order: "desc",
        ...(continuationToken === undefined ? {} : { continuationToken }),
      },
      schema: commentsSchema,
    });
    all.push(...result.data.comments);
    continuationToken =
      result.headers.get("x-ms-continuationtoken") ??
      result.data.continuationToken ??
      undefined;
  } while (continuationToken !== undefined);

  return all;
}

/** Atualiza só o bloco do Refina, sem tocar no texto da US do PO. */
export async function publishStorySpec(
  options: AdoClientOptions,
  spec: StorySpecToPublish,
): Promise<void> {
  const rest = createAdoRest(options);
  const story = await rest.request({
    operation: "a descrição atual da US",
    path: `_apis/wit/workitems/${spec.storyId}`,
    schema: storySchema,
    notFound: `O Azure DevOps não encontrou a US #${spec.storyId} no projeto configurado — nada foi publicado.`,
  });
  const currentDescription = story.fields["System.Description"] ?? "";
  // Retry: o marcador deste dump já prova a Spec escrita — reescrever descartaria
  // uma edição feita no ADO entre a falha parcial e o retry.
  if (currentDescription.includes(dumpMarker(spec.dumpId, "spec"))) return;

  const description = replaceManagedSpec(currentDescription, spec.markdown, spec.dumpId);
  const estimateField = await resolveEstimateField(rest, story.fields["System.WorkItemType"]);

  await rest.request({
    operation: "a Spec da US",
    path: `_apis/wit/workitems/${spec.storyId}`,
    schema: updatedStorySchema,
    method: "PATCH",
    contentType: "application/json-patch+json",
    write: true,
    conflict:
      "A US mudou enquanto o despejo era preparado. Recarregue o Dossiê e confirme de novo; a Spec não foi gravada.",
    body: [
      { op: "test", path: "/rev", value: story.rev },
      { op: "add", path: "/fields/System.Description", value: description },
      { op: "add", path: `/fields/${estimateField}`, value: spec.estimate },
    ],
  });
}

/** Confere a fonte de verdade antes de repetir uma sequência de escritas. */
export async function readDumpCompletion(
  options: AdoClientOptions,
  storyId: number,
): Promise<readonly string[]> {
  const rest = createAdoRest(options);
  const story = await rest.request({
    operation: "a conclusão do despejo na US",
    path: `_apis/wit/workitems/${storyId}`,
    schema: storySchema,
    notFound: `O Azure DevOps não encontrou a US #${storyId} no projeto configurado.`,
  });
  return completedDumpIds([story.fields["System.Description"] ?? ""]);
}

/**
 * Dump IDs que deixaram artefatos na US sem o marcador de conclusão — um novo
 * despejo com outro fingerprint criaria Tasks duplicadas.
 */
export async function readIncompleteDumps(
  options: AdoClientOptions,
  storyId: number,
): Promise<readonly string[]> {
  const rest = createAdoRest(options);
  const story = await rest.request({
    operation: "os marcadores de despejo incompleto na US",
    path: `_apis/wit/workitems/${storyId}`,
    schema: storySchema,
    notFound: `O Azure DevOps não encontrou a US #${storyId} no projeto configurado.`,
  });
  const comments = await listDecisionRecordComments(rest, storyId);
  const texts = [story.fields["System.Description"] ?? "", ...comments.map((comment) => comment.text)];
  return incompleteDumpIds(texts);
}

/** Escreve a prova final somente depois de todos os artefatos do dump existirem. */
export async function publishDumpCompletion(
  options: AdoClientOptions,
  input: {
    readonly storyId: number;
    readonly dumpId: string;
    /** Pendências que o gate mostrou ao Operador no instante do despejo. */
    readonly openQuestions: number;
  },
): Promise<void> {
  const rest = createAdoRest(options);
  const audit = dumpAuditMarker(input.dumpId, input.openQuestions);
  const comments = await listDecisionRecordComments(rest, input.storyId);
  if (!comments.some((comment) => comment.text.includes(audit))) {
    await rest.request({
      operation: "a auditoria do gate de despejo",
      path: `_apis/wit/workItems/${input.storyId}/comments`,
      apiVersion: COMMENTS_API_VERSION,
      query: { format: MARKDOWN_FORMAT },
      schema: commentSchema,
      write: true,
      body: { text: audit },
      notFound: `O Azure DevOps não encontrou a US #${input.storyId} no projeto configurado — nada foi publicado.`,
    });
  }

  const story = await rest.request({
    operation: "a US para concluir o despejo",
    path: `_apis/wit/workitems/${input.storyId}`,
    schema: storySchema,
    notFound: `O Azure DevOps não encontrou a US #${input.storyId} no projeto configurado.`,
  });
  const completion = dumpCompletionMarker(input.dumpId);
  if ((story.fields["System.Description"] ?? "").includes(completion)) return;

  await rest.request({
    operation: "a conclusão do despejo na US",
    path: `_apis/wit/workitems/${input.storyId}`,
    schema: updatedStorySchema,
    method: "PATCH",
    contentType: "application/json-patch+json",
    write: true,
    conflict: "A US mudou enquanto o despejo era concluído. Recarregue e tente de novo; os artefatos serão reconciliados.",
    body: [
      { op: "test", path: "/rev", value: story.rev },
      { op: "add", path: "/fields/System.Description", value: `${story.fields["System.Description"] ?? ""}\n${completion}` },
    ],
  });
}

const ESTIMATE_FIELDS = [
  "Microsoft.VSTS.Scheduling.StoryPoints",
  "Microsoft.VSTS.Scheduling.Effort",
  "Microsoft.VSTS.Scheduling.Size",
] as const;

async function resolveEstimateField(
  rest: ReturnType<typeof createAdoRest>,
  workItemType: string,
): Promise<(typeof ESTIMATE_FIELDS)[number]> {
  const { value } = await rest.request({
    operation: `o campo de estimativa de ${workItemType}`,
    path: `_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields`,
    schema: workItemTypeFieldsSchema,
  });
  const available = new Set(value.map((field) => field.referenceName));
  const field = ESTIMATE_FIELDS.find((candidate) => available.has(candidate));
  if (!field) {
    throw new AdoError(
      "unexpected",
      `O tipo ${workItemType} não expõe Story Points, Effort ou Size. Corrija o processo antes de despejar.`,
    );
  }
  return field;
}

/** Cria as Tasks filhas e só depois conecta as dependências nativas entre elas. */
export async function publishChildTasks(
  options: AdoClientOptions,
  input: ChildTasksToPublish,
): Promise<void> {
  const rest = createAdoRest(options);
  const { workItemTypes } = await rest.request({
    operation: "o tipo de Task do processo",
    path: "_apis/wit/workitemtypecategories/Microsoft.TaskCategory",
    schema: taskTypeCategorySchema,
  });
  const taskType = workItemTypes[0]?.name;
  if (!taskType) {
    throw new AdoError(
      "unexpected",
      "O processo do Azure DevOps não declara um tipo de Task. Corrija o processo antes de despejar.",
    );
  }

  const created = new Map<string, number>();
  const existing = await findPublishedTasks(rest, input);
  let completedWrites = 0;
  try {
    for (const [index, task] of input.tasks.entries()) {
      const taskNumber = index + 1;
      const prior = existing.get(taskNumber);
      if (prior !== undefined) {
        if (prior.fields["System.Title"] !== task.title) {
          throw new AdoError(
            "unexpected",
            `A Task marcada como ${taskNumber} não corresponde ao preview assinado. Confira a US antes de despejar.`,
          );
        }
        created.set(task.title, prior.id);
        continue;
      }
      const result = await rest.request({
        operation: `a Task filha ${taskNumber}`,
        path: `_apis/wit/workitems/$${encodeURIComponent(taskType)}`,
        schema: updatedStorySchema,
        method: "POST",
        contentType: "application/json-patch+json",
        write: true,
        body: [
          { op: "add", path: "/fields/System.Title", value: task.title },
          {
            op: "add",
            path: "/fields/System.Description",
            value: renderChildTaskDescription(task, dumpMarker(input.dumpId, `task:${taskNumber}`)),
          },
          {
            op: "add",
            path: "/relations/-",
            value: {
              rel: "System.LinkTypes.Hierarchy-Reverse",
              url: rest.workItemApiUrl(input.storyId),
            },
          },
        ],
      });
      completedWrites += 1;
      created.set(task.title, result.id);
    }

    for (const [index, task] of input.tasks.entries()) {
      const taskNumber = index + 1;
      const taskId = created.get(task.title);
      if (!taskId) throw new AdoError("unexpected", `A Task filha ${taskNumber} não recebeu id no Azure DevOps.`);

      for (const blocker of task.blockedBy) {
        const blockerId = created.get(blocker);
        if (!blockerId) {
          throw new AdoError("unexpected", `A Task filha ${taskNumber} referencia um bloqueio ausente.`);
        }
        const existingRelation = existing.get(taskNumber)?.relations.some(
          (relation) =>
            relation.rel === "System.LinkTypes.Dependency-Reverse" &&
            relation.targetWorkItemId === blockerId,
        );
        if (existingRelation) continue;
        await rest.request({
          operation: `a dependência da Task filha ${taskNumber}`,
          path: `_apis/wit/workitems/${taskId}`,
          schema: updatedStorySchema,
          method: "PATCH",
          contentType: "application/json-patch+json",
          write: true,
          body: [{
            op: "add",
            path: "/relations/-",
            value: { rel: "System.LinkTypes.Dependency-Reverse", url: rest.workItemApiUrl(blockerId) },
          }],
        });
        completedWrites += 1;
      }
    }
  } catch (error) {
    if (error instanceof AdoError && (completedWrites > 0 || error.writeMayHaveSucceeded)) {
      throw new AdoError(error.kind, error.message, { cause: error, writeMayHaveSucceeded: true });
    }
    throw error;
  }
}

function workItemIdFromUrl(url: string): number | undefined {
  const match = /\/_apis\/wit\/workitems\/(\d+)\/?$/i.exec(new URL(url).pathname);
  if (!match?.[1]) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function renderChildTaskDescription(task: ChildTaskToPublish, marker: string): string {
  return `${marker}\n${markdownToAdoHtml(task.bodyMarkdown)}`;
}

/** Exportado para cobrir o contrato de preservação do texto já escrito na US. */
export function replaceManagedSpec(description: string, markdown: string, dumpId = "legacy"): string {
  const block = `${SPEC_MARKER}\n${dumpMarker(dumpId, "spec")}\n${SPEC_BLOCK_START}\n${markdownToAdoHtml(markdown)}\n${SPEC_BLOCK_END}`;
  const start = description.indexOf(SPEC_BLOCK_START);
  if (start === -1) return description === "" ? block : `${description}\n\n${block}`;

  const end = description.indexOf(SPEC_BLOCK_END, start);
  if (end === -1) {
    throw new AdoError(
      "unexpected",
      "A Spec anterior do Refina está sem o marcador de fechamento. " +
        "Corrija a descrição da US antes de despejar; a Spec não foi gravada.",
    );
  }

  const markerStart = description.lastIndexOf(SPEC_MARKER, start);
  const replaceStart = markerStart === -1 ? start : markerStart;
  return `${description.slice(0, replaceStart)}${block}${description.slice(end + SPEC_BLOCK_END.length)}`;
}

/**
 * `System.Description` é HTML no Azure DevOps. Sem esta conversão, headings,
 * listas e links da Spec/Tasks aparecem como Markdown cru na tela do work item.
 */
export function markdownToAdoHtml(markdown: string): string {
  return adoMarkdown.render(markdown).trimEnd();
}

function isAllowedDestination(
  destination: string,
  protocols: readonly string[],
): boolean {
  try {
    return protocols.includes(new URL(destination).protocol);
  } catch {
    return false;
  }
}

async function findPublishedTasks(
  rest: ReturnType<typeof createAdoRest>,
  input: ChildTasksToPublish,
): Promise<ReadonlyMap<number, z.infer<typeof taskBatchSchema>["value"][number]>> {
  const { workItems } = await rest.request({
    operation: "as Tasks filhas existentes da US",
    path: "_apis/wit/wiql",
    schema: wiqlIdsSchema,
    body: {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.Parent] = ${input.storyId}`,
    },
  });
  if (workItems.length === 0) return new Map();
  const { value } = await rest.request({
    operation: "os detalhes das Tasks filhas existentes",
    path: "_apis/wit/workitemsbatch",
    schema: taskBatchSchema,
    body: {
      ids: workItems.map((item) => item.id),
      $expand: "Relations",
    },
  });

  const found = new Map<number, z.infer<typeof taskBatchSchema>["value"][number]>();
  for (const task of value) {
    for (const [index] of input.tasks.entries()) {
      const taskNumber = index + 1;
      if (!(task.fields["System.Description"] ?? "").includes(dumpMarker(input.dumpId, `task:${taskNumber}`))) continue;
      if (found.has(taskNumber)) {
        throw new AdoError("unexpected", `Há mais de uma Task marcada como ${taskNumber}. Confira a US antes de despejar.`);
      }
      found.set(taskNumber, task);
    }
  }
  return found;
}
