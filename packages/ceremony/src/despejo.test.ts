import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdoClientOptions } from "@sprint-griller/ado-client";
import { dumpCompletionMarker, dumpMarker } from "@sprint-griller/ado-client";
import { createLogger } from "@sprint-griller/core";
import Database from "better-sqlite3";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createCeremonyDump } from "./despejo";
import type { CeremonyDumpInput } from "./despejo";
import { readDossie } from "./dossie";
import { openCeremonyStore } from "./store";
import type { CeremonyStore } from "./store";

const STORY_ID = 4242;
const STORY_URL = `https://dev.azure.com/acme/Plataforma/_workitems/edit/${STORY_ID}`;
const TASKS_MARKDOWN = `## Preparar cálculo

Entrega o cálculo de comissão como um slice executável.

[Spec da US](${STORY_URL})

### Critérios de aceite

- O cálculo usa a regra bancária.`;

interface AzureState {
  description: string;
  rev: number;
  estimate: number | undefined;
  readonly comments: Array<{ readonly commentId: number; readonly text: string }>;
  readonly tasks: Array<{
    readonly id: number;
    readonly title: string;
    readonly description: string;
    readonly relations: readonly { readonly rel: string; readonly url: string }[];
  }>;
  readonly operations: string[];
  readonly artifactWrites: string[];
}

const stores: CeremonyStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
}

function patchValue(body: unknown, pathName: string): unknown {
  if (!Array.isArray(body)) return undefined;
  return body.find(
    (entry): entry is { readonly path: string; readonly value: unknown } =>
      typeof entry === "object" && entry !== null && "path" in entry && entry.path === pathName,
  )?.value;
}

function createAzure(): { readonly state: AzureState; readonly fetch: typeof globalThis.fetch } {
  const state: AzureState = {
    description: "Descrição original da PO.",
    rev: 1,
    estimate: undefined,
    comments: [],
    tasks: [],
    operations: [],
    artifactWrites: [],
  };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const pathName = decodeURIComponent(url.pathname);
    const method = init?.method ?? "GET";
    const body = requestBody(init);
    state.operations.push(`${method} ${pathName}`);

    if (/\/workItems\/4242\/comments$/i.test(pathName)) {
      if (method === "POST") {
        const text = typeof body === "object" && body !== null && "text" in body
          ? body.text
          : undefined;
        if (typeof text !== "string") throw new Error("comment text missing");
        state.artifactWrites.push(text.includes(":audit:") ? "audit" : "decision");
        const comment = { commentId: 90 + state.comments.length + 1, text };
        state.comments.push(comment);
        return json({ commentId: comment.commentId });
      }
      return json({ comments: state.comments });
    }

    if (/\/workitems\/4242$/i.test(pathName)) {
      if (method === "GET") {
        return json({
          id: STORY_ID,
          rev: state.rev,
          fields: {
            "System.Description": state.description,
            "System.WorkItemType": "User Story",
          },
        });
      }
      const description = patchValue(body, "/fields/System.Description");
      if (typeof description !== "string") throw new Error("story description missing");
      const estimate = patchValue(body, "/fields/Microsoft.VSTS.Scheduling.StoryPoints");
      state.artifactWrites.push(description.includes(":complete -->") ? "completion" : "spec");
      if (typeof estimate === "number") state.estimate = estimate;
      state.description = description;
      state.rev += 1;
      return json({ id: STORY_ID });
    }

    if (/\/workitemtypes\/User Story\/fields$/i.test(pathName)) {
      return json({ value: [{ referenceName: "Microsoft.VSTS.Scheduling.StoryPoints" }] });
    }
    if (/\/workitemtypecategories\/Microsoft.TaskCategory$/i.test(pathName)) {
      return json({ workItemTypes: [{ name: "Task" }] });
    }
    if (/\/wiql$/i.test(pathName)) {
      return json({ workItems: state.tasks.map(({ id }) => ({ id })) });
    }
    if (/\/workitemsbatch$/i.test(pathName)) {
      return json({
        value: state.tasks.map((task) => ({
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
      const title = patchValue(body, "/fields/System.Title");
      const description = patchValue(body, "/fields/System.Description");
      if (typeof title !== "string" || typeof description !== "string") {
        throw new Error("task fields missing");
      }
      const task = {
        id: 900 + state.tasks.length,
        title,
        description,
        relations: [],
      };
      state.tasks.push(task);
      state.artifactWrites.push("tasks");
      return json({ id: task.id });
    }

    throw new Error(`unexpected Azure request: ${method} ${url.toString()}`);
  };

  return { state, fetch };
}

function createFixture(options: {
  readonly active?: boolean;
  readonly fetch?: (base: typeof globalThis.fetch) => typeof globalThis.fetch;
  readonly onChange?: (sessionId: string) => void;
  readonly withDecision?: boolean;
  readonly withPending?: boolean;
} = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "sprint-griller-despejo-"));
  const store = openCeremonyStore(path.join(directory, "cerimonias.db"));
  stores.push(store);
  store.createSession({
    id: "session-1",
    storyId: STORY_ID,
    storyTitle: "Exportar relatório de comissões",
    storyUrl: STORY_URL,
    investigationMarkdown: "## Furos da US\n\n- Sem regra de arredondamento.",
    timeZone: "America/Bahia",
  });
  if (options.withDecision || options.withPending) {
    store.askQuestions("session-1", [{
      id: "q1",
      header: "Arredondamento",
      question: "A comissão usa a regra bancária?",
      recommendation: "Use a regra bancária.",
      evidence: ["core-api · src/payroll/rounding.ts"],
      options: [],
      allowFreeText: true,
    }]);
  }
  if (options.withDecision) {
    store.recordDecision({
      sessionId: "session-1",
      questionId: "q1",
      answer: "Regra bancária",
    });
  }
  if (!options.active) store.finishSession("session-1", { status: "encerrada" });
  const dossie = readDossie(store, "session-1");
  if (!dossie) throw new Error("expected fixture dossie");
  const azure = createAzure();
  const logLines: string[] = [];
  const logger = createLogger({
    destination: new Writable({
      write(chunk, _encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    }),
    level: "info",
  });
  const adoOptions = {
    azureDevOps: { organization: "acme", project: "Plataforma" },
    credentials: { pat: "pat-de-teste" },
    fetch: options.fetch?.(azure.fetch) ?? azure.fetch,
    logger,
  } satisfies AdoClientOptions;

  let adoOptionsCalls = 0;
  return {
    store,
    dossie,
    azure: azure.state,
    dbPath: path.join(directory, "cerimonias.db"),
    logLines,
    adoOptionsCalls: () => adoOptionsCalls,
    dump: createCeremonyDump({
      store,
      adoOptions: () => {
        adoOptionsCalls += 1;
        return adoOptions;
      },
      logger,
      ...(options.onChange === undefined ? {} : { onChange: options.onChange }),
    }),
  };
}

function inputFor(dossie: NonNullable<ReturnType<typeof readDossie>>): CeremonyDumpInput {
  if (!dossie) throw new Error("expected dossie");
  return {
    sessionId: dossie.sessionId,
    markdown: dossie.spec.generated,
    base: dossie.spec.generated,
    tasksMarkdown: TASKS_MARKDOWN,
    estimate: 5,
    confirmPending: true,
  };
}

describe("CeremonyDump", () => {
  it("should publish the signed artifacts in Azure DevOps and complete the local dump", async () => {
    const { azure, dossie, dump, store } = createFixture();

    await dump.publish({
      sessionId: dossie.sessionId,
      markdown: dossie.spec.generated,
      base: dossie.spec.generated,
      tasksMarkdown: TASKS_MARKDOWN,
      estimate: 5,
      confirmPending: true,
    });

    expect({
      description: azure.description,
      estimate: azure.estimate,
      tasks: azure.tasks.map(({ title }) => title),
      dumpStatus: store.getSession(dossie.sessionId)?.dump.status,
    }).toEqual({
      description: expect.stringContaining("sprint-griller:dump:"),
      estimate: 5,
      tasks: ["Preparar cálculo"],
      dumpStatus: "completed",
    });
  });

  it.each([
    ["Spec", (input: ReturnType<typeof inputFor>) => ({ ...input, markdown: `${input.markdown}\nOutra Spec` })],
    ["Tasks", (input: ReturnType<typeof inputFor>) => ({ ...input, tasksMarkdown: `${input.tasksMarkdown}\nOutra Task` })],
    ["estimativa", (input: ReturnType<typeof inputFor>) => ({ ...input, estimate: 8 })],
  ] as const)(
    "should reject completed dump calls with conflicting signed %s",
    async (_field, conflict) => {
      const fixture = createFixture();
      const input = inputFor(fixture.dossie);
      await fixture.dump.publish(input);

      await expect(fixture.dump.publish(conflict(input))).rejects.toThrow(
        /Spec assinada|Tasks assinadas|estimativa assinada/i,
      );
    },
  );

  it("should deduplicate concurrent publication of the same signed inputs", async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
    let heldOnce = false;
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        if (!heldOnce) {
          heldOnce = true;
          entered();
          await held;
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);

    const first = fixture.dump.publish(input);
    await requestStarted;
    const second = fixture.dump.publish(input);
    release();
    await Promise.all([first, second]);

    expect({ tasks: fixture.azure.tasks.length, adoOptionsCalls: fixture.adoOptionsCalls() })
      .toEqual({ tasks: 1, adoOptionsCalls: 1 });
  });

  it("should reject conflicting signed inputs while the story is publishing", async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
    let heldOnce = false;
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        if (!heldOnce) {
          heldOnce = true;
          entered();
          await held;
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);
    const publishing = fixture.dump.publish(input);
    await requestStarted;

    await expect(fixture.dump.publish({ ...input, estimate: 8 })).rejects.toThrow(
      /outros valores assinados/i,
    );
    release();
    await publishing;
  });

  it("should reject a different base while the same story is publishing", async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
    let heldOnce = false;
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        if (!heldOnce) {
          heldOnce = true;
          entered();
          await held;
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);
    const publishing = fixture.dump.publish(input);
    await requestStarted;

    try {
      await expect(fixture.dump.publish({ ...input, base: "# Outra base" })).rejects.toThrow(
        /outros valores assinados/i,
      );
    } finally {
      release();
      await publishing;
    }
  });

  it("should not let an unconfirmed pending caller join a confirmed publication", async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
    let heldOnce = false;
    const fixture = createFixture({
      withPending: true,
      fetch: (base) => async (request, init) => {
        if (!heldOnce) {
          heldOnce = true;
          entered();
          await held;
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);
    const publishing = fixture.dump.publish(input);
    await requestStarted;

    try {
      await expect(fixture.dump.publish({ ...input, confirmPending: false })).rejects.toThrow(
        /outros valores assinados/i,
      );
    } finally {
      release();
      await publishing;
    }
  });

  it("should serialize separate sessions of the same story", async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
    let heldOnce = false;
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        if (!heldOnce) {
          heldOnce = true;
          entered();
          await held;
        }
        return base(request, init);
      },
    });
    fixture.store.createSession({
      id: "session-2",
      storyId: STORY_ID,
      storyTitle: fixture.dossie.story.title,
      storyUrl: STORY_URL,
      investigationMarkdown: "## Furos da US\n\n- Sem regra de arredondamento.",
      timeZone: "America/Bahia",
    });
    fixture.store.finishSession("session-2", { status: "encerrada" });
    const secondDossie = readDossie(fixture.store, "session-2");
    if (!secondDossie) throw new Error("expected second dossie");
    const publishing = fixture.dump.publish(inputFor(fixture.dossie));
    await requestStarted;

    try {
      await expect(fixture.dump.publish(inputFor(secondDossie))).rejects.toThrow(
        /despejo em andamento em outra cerimônia/i,
      );
    } finally {
      release();
      await publishing;
    }
  });

  it("should preserve local, investigation, then remote start-blocker precedence", async () => {
    const fixture = createFixture();
    const input = inputFor(fixture.dossie);
    fixture.store.beginDump(input.sessionId, {
      dumpId: "local-incomplete",
      markdown: input.markdown,
      tasksMarkdown: input.tasksMarkdown,
      estimate: input.estimate,
    });
    fixture.azure.description = dumpMarker("remote-incomplete", "spec");

    await expect(fixture.dump.assertCanStartCeremony({
      storyId: STORY_ID,
      investigationApproved: false,
    })).rejects.toThrow(/cerimônia anterior/i);
    expect(fixture.adoOptionsCalls()).toBe(0);

    fixture.store.markDumpCompleted(input.sessionId);
    await expect(fixture.dump.assertCanStartCeremony({
      storyId: STORY_ID,
      investigationApproved: false,
    })).rejects.toThrow(/Investigação aprovada/i);
    expect(fixture.adoOptionsCalls()).toBe(0);

    await expect(fixture.dump.assertCanStartCeremony({
      storyId: STORY_ID,
      investigationApproved: true,
    })).rejects.toThrow(/Azure DevOps/i);
    expect(fixture.adoOptionsCalls()).toBe(1);
  });

  it("should reconcile a remotely completed dump without repeating artifact writes", async () => {
    const holder: { fixture?: ReturnType<typeof createFixture> } = {};
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        const current = holder.fixture;
        const local = current?.store.getSession("session-1")?.dump;
        if (current && local?.status === "publishing") {
          current.azure.description = dumpCompletionMarker(local.inputs.dumpId);
        }
        return base(request, init);
      },
    });
    holder.fixture = fixture;

    await fixture.dump.publish(inputFor(fixture.dossie));

    expect({
      artifactWrites: fixture.azure.artifactWrites,
      dumpStatus: fixture.store.getSession("session-1")?.dump.status,
      adoOptionsCalls: fixture.adoOptionsCalls(),
    }).toEqual({ artifactWrites: [], dumpStatus: "completed", adoOptionsCalls: 1 });
  });

  it("should reconcile a partial write on retry without duplicating signed artifacts", async () => {
    let failCompletion = true;
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        const body = requestBody(init);
        const description = patchValue(body, "/fields/System.Description");
        if (failCompletion && typeof description === "string" && description.includes(":complete -->")) {
          failCompletion = false;
          return json({ message: "transient" }, 500);
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);

    await expect(fixture.dump.publish(input)).rejects.toThrow(/pode ter acontecido/i);
    expect(fixture.store.getSession(input.sessionId)?.dump.status).toBe("retryable");
    await fixture.dump.publish(input);

    expect({
      tasks: fixture.azure.tasks.length,
      audits: fixture.azure.comments.filter(({ text }) => text.includes(":audit:")).length,
      dumpStatus: fixture.store.getSession(input.sessionId)?.dump.status,
    }).toEqual({ tasks: 1, audits: 1, dumpStatus: "completed" });
  });

  it("should isolate throwing change notifications from publication and retry checkpoints", async () => {
    let failCompletion = true;
    const fixture = createFixture({
      onChange: () => {
        throw new Error("subscriber broke");
      },
      fetch: (base) => async (request, init) => {
        const body = requestBody(init);
        const description = patchValue(body, "/fields/System.Description");
        if (failCompletion && typeof description === "string" && description.includes(":complete -->")) {
          failCompletion = false;
          return json({ message: "transient" }, 500);
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);

    await expect(fixture.dump.publish(input)).rejects.toThrow(/pode ter acontecido/i);
    expect(fixture.store.getSession(input.sessionId)?.dump.status).toBe("retryable");
    await expect(fixture.dump.publish(input)).resolves.toBeUndefined();

    const notificationFailure = fixture.logLines
      .map((line) => JSON.parse(line) as unknown)
      .find((entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && "msg" in entry &&
        entry.msg === "falha ao notificar mudança no despejo"
      );
    expect({
      dumpStatus: fixture.store.getSession(input.sessionId)?.dump.status,
      tasks: fixture.azure.tasks.length,
      notificationFailure,
    }).toEqual({
      dumpStatus: "completed",
      tasks: 1,
      notificationFailure: expect.objectContaining({
        sessionId: input.sessionId,
        err: expect.objectContaining({ message: "subscriber broke" }),
      }),
    });
  });

  it("should recover from a decision checkpoint without duplicating its remote record", async () => {
    let failSpec = true;
    const fixture = createFixture({
      withDecision: true,
      fetch: (base) => async (request, init) => {
        const body = requestBody(init);
        const description = patchValue(body, "/fields/System.Description");
        if (failSpec && typeof description === "string" && !description.includes(":complete -->")) {
          failSpec = false;
          return json({ message: "transient" }, 500);
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);

    await expect(fixture.dump.publish(input)).rejects.toThrow(/pode ter acontecido/i);
    expect(readDossie(fixture.store, input.sessionId)?.decisions[0]).toMatchObject({
      recordId: 91,
    });
    await fixture.dump.publish(input);

    expect(fixture.azure.comments.filter(({ text }) => text.includes("Registro de decisão")))
      .toHaveLength(1);
  });

  it("should reject a stale Spec before resolving Azure DevOps options", async () => {
    const stale = createFixture();
    const staleInput = inputFor(stale.dossie);
    await expect(stale.dump.publish({
      ...staleInput,
      markdown: `${staleInput.markdown}\ntexto não salvo`,
    })).rejects.toThrow(/salve a edição/i);
    expect(stale.adoOptionsCalls()).toBe(0);
  });

  it("should reject an unsigned Spec before resolving Azure DevOps options", async () => {
    const unsigned = createFixture({ withDecision: true });
    const generated = unsigned.dossie.spec.generated;
    const markdown = generated.replace(
      /- \*\*A comissão usa a regra bancária\?\*\* — Regra bancária\n(?=\s*$)/m,
      "",
    );
    const database = new Database(unsigned.dbPath);
    database.prepare(
      "INSERT INTO spec_drafts (session_id, markdown, base, saved_at) VALUES (?, ?, ?, ?)",
    ).run("session-1", markdown, generated, Date.now());
    database.close();

    await expect(unsigned.dump.publish({
      ...inputFor(unsigned.dossie),
      markdown,
    })).rejects.toThrow(/rastreabilidade/i);
    expect(unsigned.adoOptionsCalls()).toBe(0);
  });

  it("should reject invalid Tasks before ADO", async () => {
    const invalidTasks = createFixture();
    await expect(invalidTasks.dump.publish({
      ...inputFor(invalidTasks.dossie),
      tasksMarkdown: "## Task sem contrato",
    })).rejects.toThrow(/slice vertical|critérios de aceite/i);
    expect(invalidTasks.adoOptionsCalls()).toBe(0);
  });

  it("should reject an invalid estimate before ADO", async () => {
    const invalidEstimate = createFixture();
    await expect(invalidEstimate.dump.publish({
      ...inputFor(invalidEstimate.dossie),
      estimate: 4,
    })).rejects.toThrow(/Fibonacci/i);
    expect(invalidEstimate.adoOptionsCalls()).toBe(0);
  });

  it("should reject unconfirmed pending questions before ADO", async () => {
    const pending = createFixture({ withPending: true });
    await expect(pending.dump.publish({
      ...inputFor(pending.dossie),
      confirmPending: false,
    })).rejects.toThrow(/confirme/i);
    expect(pending.adoOptionsCalls()).toBe(0);
  });

  it("should reject publication before the ceremony ends", async () => {
    const fixture = createFixture({ active: true });

    await expect(fixture.dump.publish(inputFor(fixture.dossie))).rejects.toThrow(
      /encerre a cerimônia/i,
    );

    expect(fixture.adoOptionsCalls()).toBe(0);
  });

  it("should retry frozen legacy estimates only with their signed value", async () => {
    let failPreflight = true;
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        if (failPreflight) {
          failPreflight = false;
          return json({ message: "transient" }, 500);
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);

    await expect(fixture.dump.publish(input)).rejects.toThrow(/Azure DevOps/i);
    const database = new Database(fixture.dbPath);
    database.prepare("UPDATE sessions SET dump_id = ?, dump_estimate = ? WHERE id = ?").run(
      "legacy-non-fibonacci",
      4,
      input.sessionId,
    );
    database.close();

    await expect(fixture.dump.publish(input)).rejects.toThrow(/estimativa assinada/i);
    await expect(fixture.dump.publish({ ...input, estimate: 4 })).resolves.toBeUndefined();
  });

  it("should publish a revised ceremony after another dump completed remotely", async () => {
    const fixture = createFixture();
    fixture.azure.description = dumpCompletionMarker("prior-completed-dump");

    await fixture.dump.publish(inputFor(fixture.dossie));

    expect({
      wroteEveryArtifact: fixture.azure.artifactWrites.length === 4,
      description: fixture.azure.description,
      status: fixture.store.getSession(fixture.dossie.sessionId)?.dump.status,
    }).toEqual({
      wroteEveryArtifact: true,
      description: expect.stringContaining("Exportar relatório de comissões"),
      status: "completed",
    });
  });

  it("should ignore stale editor base while retrying frozen inputs", async () => {
    let failCompletion = true;
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        const description = patchValue(requestBody(init), "/fields/System.Description");
        if (failCompletion && typeof description === "string" && description.includes(":complete -->")) {
          failCompletion = false;
          return json({ message: "transient" }, 500);
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);

    await expect(fixture.dump.publish(input)).rejects.toThrow(/pode ter acontecido/i);

    await expect(fixture.dump.publish({
      ...input,
      base: "# base obsoleta de outra aba",
    })).resolves.toBeUndefined();
  });

  it("should freeze the signed snapshot before asynchronous ADO preflight", async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
    let heldOnce = false;
    const fixture = createFixture({
      withPending: true,
      fetch: (base) => async (request, init) => {
        if (!heldOnce) {
          heldOnce = true;
          entered();
          await held;
        }
        return base(request, init);
      },
    });
    const publishing = fixture.dump.publish(inputFor(fixture.dossie));
    await requestStarted;

    await expect(Promise.resolve().then(() => fixture.store.recordDecision({
      sessionId: fixture.dossie.sessionId,
      questionId: "q1",
      answer: "Regra bancária",
    }))).rejects.toThrow(/despejo/i);

    release();
    await publishing;
  });

  it("should assign distinct dump identities to separate ceremonies with identical output", async () => {
    const fixture = createFixture();
    const firstInput = inputFor(fixture.dossie);
    await fixture.dump.publish(firstInput);
    fixture.store.createSession({
      id: "session-2",
      storyId: STORY_ID,
      storyTitle: fixture.dossie.story.title,
      storyUrl: STORY_URL,
      investigationMarkdown: "## Furos da US\n\n- Sem regra de arredondamento.",
      timeZone: "America/Bahia",
    });
    fixture.store.finishSession("session-2", { status: "encerrada" });
    const secondDossie = readDossie(fixture.store, "session-2");
    if (!secondDossie) throw new Error("expected second dossie");

    await fixture.dump.publish(inputFor(secondDossie));

    const first = readDossie(fixture.store, firstInput.sessionId)?.dump;
    const second = readDossie(fixture.store, secondDossie.sessionId)?.dump;
    expect(first?.status === "completed" && second?.status === "completed"
      ? first.inputs.dumpId === second.inputs.dumpId
      : undefined).toBe(false);
  });

  it("should retry when a decision-record write has an uncertain outcome", async () => {
    let failDecision = true;
    const fixture = createFixture({
      withDecision: true,
      fetch: (base) => async (request, init) => {
        const url = new URL(typeof request === "string" || request instanceof URL
          ? request
          : request.url);
        if (
          failDecision &&
          init?.method === "POST" &&
          /\/workItems\/4242\/comments$/i.test(decodeURIComponent(url.pathname))
        ) {
          failDecision = false;
          return json({ message: "transient" }, 500);
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);

    await expect(fixture.dump.publish(input)).rejects.toMatchObject({
      writeMayHaveSucceeded: true,
    });
    await fixture.dump.publish(input);

    expect(fixture.azure.comments.filter(({ text }) => text.includes("Registro de decisão")))
      .toHaveLength(1);
  });

  it("should retry when a child-Task write has an uncertain outcome", async () => {
    let failTask = true;
    const fixture = createFixture({
      fetch: (base) => async (request, init) => {
        const url = new URL(typeof request === "string" || request instanceof URL
          ? request
          : request.url);
        if (
          failTask &&
          init?.method === "POST" &&
          /\/workitems\/\$Task$/i.test(decodeURIComponent(url.pathname))
        ) {
          failTask = false;
          return json({ message: "transient" }, 500);
        }
        return base(request, init);
      },
    });
    const input = inputFor(fixture.dossie);

    await expect(fixture.dump.publish(input)).rejects.toMatchObject({
      writeMayHaveSucceeded: true,
    });
    await fixture.dump.publish(input);

    expect(fixture.azure.tasks).toHaveLength(1);
  });

  it("should notify every local checkpoint and log the ordered final publication", async () => {
    const changes: string[] = [];
    const fixture = createFixture({
      withDecision: true,
      onChange: (sessionId) => changes.push(sessionId),
    });

    await fixture.dump.publish(inputFor(fixture.dossie));

    expect({
      writes: fixture.azure.artifactWrites,
      changes,
      completionLog: fixture.logLines.map((line) => JSON.parse(line) as unknown).find(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && "msg" in entry &&
          entry.msg === "despejo da cerimônia concluído",
      ),
    }).toEqual({
      writes: ["decision", "spec", "tasks", "audit", "completion"],
      changes: ["session-1", "session-1", "session-1"],
      completionLog: expect.objectContaining({
        sessionId: "session-1",
        storyId: STORY_ID,
        decisions: 1,
        tasks: 1,
        estimate: 5,
      }),
    });
  });
});
