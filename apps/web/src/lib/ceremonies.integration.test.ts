import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentQuestion, AgentSession } from "@sprint-griller/agent-runtime";
import type { CeremonyStore } from "@sprint-griller/ceremony";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const createAgentRuntime = vi.hoisted(() => vi.fn());
const getInvestigation = vi.hoisted(() => vi.fn());
const loadAdoCredentials = vi.hoisted(() => vi.fn());

vi.mock("@sprint-griller/agent-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/agent-runtime")>()),
  createAgentRuntime,
}));
vi.mock("@sprint-griller/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/core")>()),
  loadAdoCredentials,
}));
vi.mock("./investigations", () => ({ getInvestigation }));
vi.mock("./squad-config", () => ({
  getSquadConfig: () => ({
    azureDevOps: { organization: "acme", project: "Plataforma" },
    repos: { primary: { name: "core-api", path: "/dev/core-api" }, related: [] },
  }),
}));

vi.stubEnv(
  "SPRINT_GRILLER_DB",
  path.join(mkdtempSync(path.join(tmpdir(), "sprint-griller-integration-")), "cerimonias.db"),
);

const { dumpCeremony, getDossie, getPalco, saveSpecDraft, startCeremony, submitDecision } =
  await import("./ceremonies");

const STORY_ID = 4242;
const STORY_URL = `https://dev.azure.com/acme/Plataforma/_workitems/edit/${STORY_ID}`;
const QUESTION = {
  id: "q1",
  header: "Arredondamento",
  question: "A comissão usa a regra bancária?",
  recommendation: "Use a regra bancária.",
  evidence: ["core-api · src/payroll/rounding.ts"],
  options: [],
  allowFreeText: true,
} as const satisfies AgentQuestion;
const TASKS_MARKDOWN = `## Preparar cálculo

Entrega o cálculo de comissão como um slice executável.

[Spec da US](${STORY_URL})

### Critérios de aceite

- O cálculo usa a regra bancária.

## Publicar relatório

Entrega o CSV conforme discutido em [Spec atual](${STORY_URL}).

### Contexto técnico

Preservar o cabeçalho legado do relatório.

### Critérios de aceite

- O CSV contém o total calculado.

### Bloqueada por

- Preparar cálculo`;

interface StoredComment {
  readonly commentId: number;
  readonly text: string;
}

interface StoredTask {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly relations: Array<{ readonly rel: string; readonly url: string }>;
}

interface AzureState {
  description: string;
  rev: number;
  estimate: number | undefined;
  readonly comments: StoredComment[];
  readonly tasks: StoredTask[];
  specWrites: number;
  taskWrites: number;
  dependencyWrites: number;
  completionAttempts: number;
}

let azure: AzureState;

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") return undefined;
  return JSON.parse(init.body) as unknown;
}

function patches(body: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(body)) throw new Error("expected JSON Patch body");
  return body.filter((entry): entry is Record<string, unknown> =>
    typeof entry === "object" && entry !== null,
  );
}

function patchValue(body: unknown, pathName: string): unknown {
  return patches(body).find((entry) => entry.path === pathName)?.value;
}

function fakeAgentSession(): AgentSession {
  return {
    id: "integration-thread",
    send() {
      return (async function* () {
        let finishQuestion: () => void = () => undefined;
        const answered = new Promise<void>((resolve) => {
          finishQuestion = resolve;
        });
        yield {
          type: "question",
          question: {
            questions: [QUESTION],
            answer: async () => finishQuestion(),
          },
        } as const;
        await answered;
        yield {
          type: "turn-completed",
          turn: { id: "turn-integration", status: "completed", durationMs: 1 },
        } as const;
      })() as ReturnType<AgentSession["send"]>;
    },
    interrupt: async () => undefined,
  };
}

const azureFetch = vi.fn(async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const pathName = decodeURIComponent(url.pathname);
  const method = init?.method ?? "GET";
  const body = requestBody(init);

  if (/\/workItems\/4242\/comments$/i.test(pathName)) {
    if (method === "POST") {
      const text = typeof body === "object" && body !== null && "text" in body
        ? (body as { readonly text?: unknown }).text
        : undefined;
      if (typeof text !== "string") throw new Error("comment text missing");
      const comment = { commentId: 91, text };
      azure.comments.push(comment);
      return json({ commentId: comment.commentId });
    }
    return json({ comments: azure.comments });
  }

  if (/\/workitems\/4242$/i.test(pathName)) {
    if (method === "GET") {
      return json({
        id: STORY_ID,
        rev: azure.rev,
        fields: {
          "System.Description": azure.description,
          "System.WorkItemType": "User Story",
        },
      });
    }

    const nextDescription = patchValue(body, "/fields/System.Description");
    if (typeof nextDescription !== "string") throw new Error("story description missing");
    if (nextDescription.includes(":complete -->")) {
      azure.completionAttempts += 1;
      expect(azure.dependencyWrites).toBe(1);
      if (azure.completionAttempts === 1) return json({ message: "transient" }, { status: 500 });
    } else {
      azure.specWrites += 1;
      const estimate = patchValue(body, "/fields/Microsoft.VSTS.Scheduling.StoryPoints");
      if (typeof estimate !== "number") throw new Error("estimate missing");
      azure.estimate = estimate;
    }
    azure.description = nextDescription;
    azure.rev += 1;
    return json({ id: STORY_ID });
  }

  if (/\/workitemtypes\/User Story\/fields$/i.test(pathName)) {
    return json({ value: [{ referenceName: "Microsoft.VSTS.Scheduling.StoryPoints" }] });
  }
  if (/\/workitemtypecategories\/Microsoft.TaskCategory$/i.test(pathName)) {
    return json({ workItemTypes: [{ name: "Task" }] });
  }
  if (/\/wiql$/i.test(pathName)) {
    return json({ workItems: azure.tasks.map(({ id }) => ({ id })) });
  }
  if (/\/workitemsbatch$/i.test(pathName)) {
    return json({
      value: azure.tasks.map((task) => ({
        id: task.id,
        fields: {
          "System.Title": task.title,
          "System.Description": task.description,
        },
        relations: task.relations,
      })),
    });
  }
  if (/\/workitems\/\$Task$/i.test(pathName)) {
    if (method !== "POST") {
      throw new Error(`task creation requires POST, received ${method}`);
    }
    const title = patchValue(body, "/fields/System.Title");
    const description = patchValue(body, "/fields/System.Description");
    if (typeof title !== "string" || typeof description !== "string") {
      throw new Error("task fields missing");
    }
    const task = { id: 900 + azure.tasks.length, title, description, relations: [] };
    azure.tasks.push(task);
    azure.taskWrites += 1;
    return json({ id: task.id });
  }

  const taskMatch = /\/workitems\/(\d+)$/i.exec(pathName);
  if (taskMatch?.[1] && method === "PATCH") {
    const task = azure.tasks.find(({ id }) => id === Number(taskMatch[1]));
    if (!task) return json({ message: "not found" }, { status: 404 });
    const relation = patchValue(body, "/relations/-");
    if (typeof relation !== "object" || relation === null || !("rel" in relation) || !("url" in relation)) {
      throw new Error("dependency relation missing");
    }
    const rel = (relation as { readonly rel?: unknown }).rel;
    const target = (relation as { readonly url?: unknown }).url;
    if (typeof rel !== "string" || typeof target !== "string") throw new Error("invalid relation");
    const targetId = target.match(/\/(\d+)$/)?.[1];
    task.relations.push({
      rel,
      url: `https://dev.azure.com/acme/_apis/wit/workitems/${targetId}`,
    });
    azure.dependencyWrites += 1;
    return json({ id: task.id });
  }

  throw new Error(`unexpected Azure request: ${method} ${url.toString()}`);
});

beforeEach(() => {
  azure = {
    description: "Descrição original da PO.",
    rev: 1,
    estimate: undefined,
    comments: [],
    tasks: [],
    specWrites: 0,
    taskWrites: 0,
    dependencyWrites: 0,
    completionAttempts: 0,
  };
  azureFetch.mockClear();
  vi.stubGlobal("fetch", azureFetch);
  loadAdoCredentials.mockReturnValue({ pat: "pat-de-teste" });
  createAgentRuntime.mockResolvedValue({
    startSession: async () => fakeAgentSession(),
    resumeSession: async () => fakeAgentSession(),
    close: async () => undefined,
  });
  getInvestigation.mockReturnValue({
    storyId: STORY_ID,
    story: {
      id: STORY_ID,
      title: "Exportar relatório de comissões",
      type: "User Story",
      state: "New",
      description: "O gerente precisa baixar o CSV.",
      url: STORY_URL,
    },
    status: "aprovado",
    markdown: "## Furos da US\n\n- Sem regra de arredondamento.",
  });
});

afterAll(() => {
  const registry = (globalThis as {
    __sprintGrillerCeremonies?: {
      store?: CeremonyStore | undefined;
      ceremony?: unknown | undefined;
    };
  }).__sprintGrillerCeremonies;
  registry?.store?.close();
  if (registry) {
    registry.store = undefined;
    registry.ceremony = undefined;
  }
  vi.unstubAllGlobals();
});

describe("ceremony dump integration", () => {
  it("should reconcile persisted records, signed artifacts, and canonical dependencies on retry", async () => {
    const session = await startCeremony(STORY_ID);
    await vi.waitFor(() => expect(getPalco(session.id)?.current.phase).toBe("perguntando"));
    await submitDecision({
      sessionId: session.id,
      questionId: QUESTION.id,
      answer: "Regra bancária",
      decidedBy: "PO + squad",
    });
    await vi.waitFor(() => expect(getDossie(session.id)?.status).toBe("encerrada"));

    const generated = getDossie(session.id)!.spec.generated;
    const edited = generated.replace(/^# .+$/m, "# Spec editada e assinada");
    const draft = saveSpecDraft({
      sessionId: session.id,
      markdown: edited,
      base: generated,
      expectedSavedAt: null,
    });
    const input = {
      sessionId: session.id,
      markdown: draft.markdown,
      base: draft.base,
      confirmPending: true,
      tasksMarkdown: TASKS_MARKDOWN,
      estimate: 8,
    } as const;

    await expect(dumpCeremony(input)).rejects.toThrow(/pode ter acontecido/i);
    expect(getDossie(session.id)?.dump.status).toBe("retryable");
    await expect(dumpCeremony(input)).resolves.toBeUndefined();

    expect(azure.comments).toHaveLength(2);
    expect(azure.comments.map(({ text }) => text)).toEqual(expect.arrayContaining([
      expect.stringContaining(":audit:pending:0 -->"),
    ]));
    expect(azure.taskWrites).toBe(2);
    expect(azure.dependencyWrites).toBe(1);
    expect(azure.specWrites).toBe(1);
    expect(azure.completionAttempts).toBe(2);
    expect(azure.estimate).toBe(8);
    expect(azure.description).toContain("Spec editada e assinada");
    expect(azure.description).toContain(":complete -->");
    expect(azure.tasks[1]?.description).toContain("<h3>Contexto técnico</h3>");
    expect(azure.tasks[1]?.description).toContain("Preservar o cabeçalho legado");
    expect(azure.tasks[1]?.description).toContain(`<a href="${STORY_URL}">Spec atual</a>`);
    expect(azure.tasks[1]?.description).toContain("<h3>Critérios de aceite</h3>");
    expect(azure.tasks[1]?.description).toContain("<h3>Bloqueada por</h3>");
    expect(azure.tasks[1]?.relations).toEqual([{
      rel: "System.LinkTypes.Dependency-Reverse",
      url: "https://dev.azure.com/acme/_apis/wit/workitems/900",
    }]);
    expect(getDossie(session.id)?.dump.status).toBe("completed");
  });
});
