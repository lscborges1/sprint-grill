# Agent-originated Agenda Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the main Refina agent persist a newly discovered gap as an open Agenda item and immediately use its server-owned identity in the existing question or resolution flow.

**Architecture:** Add one Zod-validated dynamic tool to `agent-runtime`, one atomic `CeremonyStore` operation that owns `agente-N` allocation and late-doubt reopening, and one ceremony event handler that connects them. Keep the existing SQLite schema, SSE projection, question flow, and resolution flow unchanged.

**Tech Stack:** TypeScript 5.9, Zod, Drizzle ORM, SQLite/better-sqlite3, Vitest, Codex app-server JSON-RPC.

**Spec:** `docs/superpowers/specs/2026-08-14-agent-originated-agenda-items-design.md`

## Global Constraints

- The tool is named exactly `add_refinement_item` and accepts `{ question: string }`.
- Runtime and store trim `question` and reject blank text.
- The store allocates `agente-N` per session from the maximum exact `agente-N` suffix plus one.
- A late item reopens `refinando`, clears the completion proposal, and invalidates artifact approvals in the same transaction.
- Published or otherwise non-active sessions reject creation.
- Success says `Item agente-N criado na Agenda. Use esse ID para perguntar ou resolver o furo.`
- Unexpected persistence failure says `Não foi possível adicionar o item à Agenda. Tente novamente.` and propagates to monitored ceremony failure handling.
- Do not add a dependency, database migration, source column, UI control, or retry token.
- Preserve the existing uncommitted review fixes in `ceremony.ts`, `ceremony.test.ts`, `palco.ts`, and the Palco component tests; do not overwrite or discard them.

---

### Task 1: Expose the agent tool as a typed runtime event

**Files:**
- Modify: `packages/agent-runtime/src/codex/protocol.ts`
- Modify: `packages/agent-runtime/src/types.ts`
- Modify: `packages/agent-runtime/src/runtime.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/src/runtime.test.ts`

**Interfaces:**
- Produces: `ADD_REFINEMENT_ITEM_TOOL_NAME = "add_refinement_item"`
- Produces: `addRefinementItemArgumentsSchema`
- Produces: `AddRefinementItemSubmission = { readonly question: string }`
- Produces: `AgentEvent` variant `{ type: "agenda-item-submission"; item: PendingAgentSubmission<AddRefinementItemSubmission> }`
- Produces: `AGENT_TOOL_NAMES` containing `add_refinement_item`

- [ ] **Step 1: Write the failing runtime event test**

Add this public `AgentRuntime` contract beside the existing structured-submission tests:

```ts
it("should expose an agent-originated Agenda item submission", async () => {
  const transcript = transcriptPath();
  const { runtime } = await runtimeWith(
    scriptWith([
      serverRequest("item/tool/call", {
        callId: "call-1",
        tool: "add_refinement_item",
        arguments: { question: "A política de expiração cobre o cache distribuído?" },
      }),
      turnCompleted,
    ]),
    transcript,
  );
  const session = await runtime.startSession({ tools: ["add_refinement_item"] });

  let item: Extract<AgentEvent, { readonly type: "agenda-item-submission" }> | undefined;
  for await (const event of session.send("registre o novo furo")) {
    if (event.type !== "agenda-item-submission") continue;
    item = event;
    await event.item.respond({
      accepted: true,
      message: "Item agente-1 criado na Agenda. Use esse ID para perguntar ou resolver o furo.",
    });
  }
  if (!item) throw new Error("expected Agenda item");

  expect(item.item.submission).toEqual({
    question: "A política de expiração cobre o cache distribuído?",
  });
  expect(responsesIn(transcript)).toContainEqual({
    success: true,
    contentItems: [{
      type: "inputText",
      text: "Item agente-1 criado na Agenda. Use esse ID para perguntar ou resolver o furo.",
    }],
  });
  await runtime.close();
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
rtk pnpm exec vitest run packages/agent-runtime/src/runtime.test.ts -t "should expose an agent-originated Agenda item submission"
```

Expected: FAIL because `add_refinement_item` is not an `AgentToolName` and no event is emitted.

- [ ] **Step 3: Add the minimum protocol and type contracts**

In `protocol.ts`, add the constant to `AGENT_TOOL_NAMES`, the boundary schema, and its tool spec:

```ts
export const ADD_REFINEMENT_ITEM_TOOL_NAME = "add_refinement_item";

export const addRefinementItemArgumentsSchema = z.object({
  question: z.string().min(1),
});

export const addRefinementItemToolSpec = {
  type: "function",
  name: ADD_REFINEMENT_ITEM_TOOL_NAME,
  description:
    "Adiciona à Agenda um furo novo descoberto durante o Refinamento e devolve o ID persistido para perguntar ou resolver.",
  inputSchema: z.toJSONSchema(addRefinementItemArgumentsSchema, {
    io: "input",
    target: "draft-7",
  }),
} as const;
```

In `types.ts`, derive and expose the submission:

```ts
export type AddRefinementItemSubmission = z.infer<typeof addRefinementItemArgumentsSchema>;

// Add to AgentEvent:
| {
    readonly type: "agenda-item-submission";
    readonly item: PendingAgentSubmission<AddRefinementItemSubmission>;
  }
```

In `runtime.ts`, route the tool through `registerSubmission`, extend its `kind` union with `agenda-item-submission`, and return `addRefinementItemToolSpec` from `dynamicToolSpec`. Export the schema, type, tool name, and `AGENT_TOOL_NAMES` from `index.ts` so `ceremony` can consume the canonical registry.

- [ ] **Step 4: Run the focused test and verify green**

Run the command from Step 2.

Expected: PASS; the response transcript contains the accepted tool result.

- [ ] **Step 5: Write the failing whitespace-boundary test**

Add a second runtime test using `arguments: { question: "   " }`. Drain the turn and assert no `agenda-item-submission` event exists and the tool response has `success: false`.

- [ ] **Step 6: Run the whitespace test and verify red**

Run:

```bash
rtk pnpm exec vitest run packages/agent-runtime/src/runtime.test.ts -t "should reject a blank agent-originated Agenda item"
```

Expected: FAIL because `z.string().min(1)` accepts whitespace.

- [ ] **Step 7: Make boundary normalization minimal**

Change the schema field to:

```ts
question: z.string().trim().min(1),
```

- [ ] **Step 8: Run the agent-runtime suite**

Run:

```bash
rtk pnpm exec vitest run packages/agent-runtime/src/runtime.test.ts packages/agent-runtime/src/codex/protocol.test.ts
```

Expected: both files PASS.

- [ ] **Step 9: Commit the runtime contract**

```bash
git add packages/agent-runtime/src/codex/protocol.ts packages/agent-runtime/src/types.ts packages/agent-runtime/src/runtime.ts packages/agent-runtime/src/index.ts packages/agent-runtime/src/runtime.test.ts
git commit -m "feat(agent-runtime): add agenda item tool"
```

---

### Task 2: Persist agent items and reopen late refinement atomically

**Files:**
- Modify: `packages/ceremony/src/store.ts`
- Test: `packages/ceremony/src/store.test.ts`

**Interfaces:**
- Consumes: `RefinementItem` and existing `CeremonyError`
- Produces: `CeremonyStore.addAgentRefinementItem(sessionId: string, question: string): RefinementItem`
- Preserves: existing `refinement_items` schema and unique `(session_id, item_id)` index

- [ ] **Step 1: Write the failing first-item persistence test**

```ts
it("should create the first agent-originated Agenda item with a server-owned id", () => {
  const store = open(dbPath());
  newSession(store);

  const item = store.addAgentRefinementItem("thread-1", "  O cache distribuído expira junto?  ");

  expect(item).toMatchObject({
    id: "agente-1",
    question: "O cache distribuído expira junto?",
    status: "aberto",
  });
  expect(store.getSession("thread-1")?.refinement).toEqual({
    phase: "refinando",
    revision: 1,
  });
});
```

- [ ] **Step 2: Run the focused test and verify red**

```bash
rtk pnpm exec vitest run packages/ceremony/src/store.test.ts -t "should create the first agent-originated Agenda item with a server-owned id"
```

Expected: FAIL because `addAgentRefinementItem` does not exist.

- [ ] **Step 3: Add the store interface and transactional implementation**

Add this method signature to `CeremonyStore`:

```ts
addAgentRefinementItem(sessionId: string, question: string): RefinementItem;
```

Implement it as an `sqlite.transaction(...).immediate()` operation. Inside the transaction:

```ts
const session = requireSession(sessionId);
if (session.status !== "ativa" || session.refinement.phase === "publicado") {
  throw new CeremonyError("a cerimônia encerrada não aceita novos itens na Agenda.");
}
const normalizedQuestion = requiredText(
  question,
  "o item da agenda precisa descrever o furo.",
);
const itemId = "agente-1";
const now = Date.now();
const row = db.insert(refinementItems).values({
  sessionId,
  itemId,
  question: normalizedQuestion,
  status: "aberto",
  createdAt: now,
  updatedAt: now,
}).returning().get();

const update = db.update(sessions)
  .set({ refinementRevision: session.refinement.revision + 1 })
  .where(and(
    eq(sessions.id, sessionId),
    eq(sessions.refinementRevision, session.refinement.revision),
  ))
  .run();
if (update.changes !== 1) throw staleRevision(sessionId, session.refinement.revision);
return toRefinementItem(row);
```

Call `assertDossieMutable(sessionId)` before opening the transaction.

- [ ] **Step 4: Run the first-item test and verify green**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write the failing deterministic-allocation test**

Seed `investigacao-1`, `agente-2`, and `duvida-99`, then call the method twice. Assert the returned IDs are exactly `agente-3` and `agente-4`. This test must use `store.seedRefinementItems` for setup and `store.addAgentRefinementItem` as the behavior under test.

- [ ] **Step 6: Run the allocation test and verify red before correcting allocation**

```bash
rtk pnpm exec vitest run packages/ceremony/src/store.test.ts -t "should allocate agent ids from only the greatest agent suffix"
```

Expected: FAIL because the first implementation always proposes `agente-1`.

Replace the fixed ID with the exact per-session suffix scan:

```ts
const suffixes = db
  .select({ itemId: refinementItems.itemId })
  .from(refinementItems)
  .where(eq(refinementItems.sessionId, sessionId))
  .all()
  .flatMap(({ itemId }) => {
    const match = /^agente-(\d+)$/.exec(itemId);
    return match ? [Number.parseInt(match[1]!, 10)] : [];
  });
const itemId = `agente-${Math.max(0, ...suffixes) + 1}`;
```

Rerun the allocation test and expect PASS.

- [ ] **Step 7: Write the failing late-item reopening test**

Use the existing `advanceToReviewPhase(store, "pronto-para-publicar")` helper, then call `addAgentRefinementItem`. Assert one observable state object:

```ts
expect({
  item,
  refinement: store.getSession("thread-1")?.refinement,
  proposal: store.getRefinementCompletionProposal("thread-1"),
  approvals: store.getApprovedArtifacts("thread-1"),
}).toEqual({
  item: expect.objectContaining({ id: "agente-1", status: "aberto" }),
  refinement: { phase: "refinando", revision: 7 },
  proposal: null,
  approvals: undefined,
});
```

- [ ] **Step 8: Run the reopening test and verify red**

```bash
rtk pnpm exec vitest run packages/ceremony/src/store.test.ts -t "should atomically reopen refinement for a late agent item"
```

Expected: FAIL because the first implementation only bumps the revision and preserves phase/proposal/approvals.

- [ ] **Step 9: Implement late-doubt reopening inside the same transaction**

Before inserting the row, call `invalidateArtifactApprovals(sessionId)` when the phase is not `refinando`. Replace the session update with:

```ts
.set({
  refinementPhase: "refinando",
  refinementRevision: session.refinement.revision + 1,
  completionProposalSummary: null,
  completionProposedAt: null,
})
```

Keep invalidation, insertion, and the guarded session update inside the same immediate transaction.

- [ ] **Step 10: Verify transaction rollback at the database boundary**

Create a real SQLite trigger against the test database before calling the method:

```ts
const raw = new Database(file);
raw.exec(`
  CREATE TRIGGER fail_agent_item
  BEFORE INSERT ON refinement_items
  WHEN NEW.item_id LIKE 'agente-%'
  BEGIN
    SELECT RAISE(ABORT, 'forced agent item failure');
  END;
`);
raw.close();
```

Start from `pronto-para-publicar`, capture the approved artifacts, expect the method to throw, then assert the phase, completion proposal, and approvals are unchanged and no `agente-N` item exists. Temporarily move approval invalidation outside the transaction and run this test once to verify it fails; restore the transactional implementation and verify it passes.

- [ ] **Step 11: Cover terminal and blank inputs**

Add two public store tests:

```ts
it.each([
  { status: "encerrada" as const },
  { status: "falhou" as const },
])("should reject an agent item when the ceremony is $status", ({ status }) => {
  const store = open(dbPath());
  newSession(store);
  store.finishSession("thread-1", status === "falhou"
    ? { status, message: "runtime parou" }
    : { status });

  expect(() => store.addAgentRefinementItem("thread-1", "Novo furo"))
    .toThrow(/encerrada/i);
});

it("should reject a blank agent-originated Agenda item", () => {
  const store = open(dbPath());
  newSession(store);

  expect(() => store.addAgentRefinementItem("thread-1", "   "))
    .toThrow(/descrever o furo/i);
});
```

Add a third test that moves an active session to `publicado` with
`updateRefinementPhase`, calls `addAgentRefinementItem`, and expects the same
terminal-session rejection. This distinguishes persisted workflow closure from
the `SessionStatus` guard.

- [ ] **Step 12: Run the complete store suite**

```bash
rtk pnpm exec vitest run packages/ceremony/src/store.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit the store contract**

```bash
git add packages/ceremony/src/store.ts packages/ceremony/src/store.test.ts
git commit -m "feat(ceremony): persist agent agenda items"
```

---

### Task 3: Connect the runtime event to Refina and teach the agent the flow

**Files:**
- Modify: `packages/ceremony/src/ceremony.ts`
- Modify: `packages/ceremony/src/ceremony.test.ts`
- Modify: `packages/ceremony/src/prompt.ts`
- Modify: `packages/ceremony/src/prompt.test.ts`

**Interfaces:**
- Consumes: canonical `AGENT_TOOL_NAMES` and the `agenda-item-submission` event from Task 1
- Consumes: `CeremonyStore.addAgentRefinementItem` from Task 2
- Produces: accepted tool verdict containing the generated ID
- Produces: Palco/Dossiê refresh through the existing `changed(sessionId)` hook

- [ ] **Step 1: Extend the external fake runtime and write the failing ceremony test**

Add a `Step` variant `{ type: "add-item"; question: string }` to `ceremony.test.ts`. Make `fakeRuntime` yield:

```ts
{
  type: "agenda-item-submission",
  item: {
    submission: { question: step.question },
    respond: async (verdict: AgentSubmissionVerdict) => {
      submissionVerdicts.push(verdict);
    },
  },
}
```

Then test through the public `Ceremony` seam:

```ts
it("should persist a gap discovered by the main agent", async () => {
  const { ceremony, submissionVerdicts } = ceremonyWith([[
    { type: "add-item", question: "O cache distribuído expira junto?" },
  ]]);

  await start(ceremony);
  await vi.waitFor(() =>
    expect(ceremony.palco(SESSION_ID)).toMatchObject({
      agenda: [
        expect.objectContaining({ id: "investigacao-1" }),
        expect.objectContaining({
          id: "agente-1",
          question: "O cache distribuído expira junto?",
          status: "aberto",
        }),
      ],
    }),
  );
  expect(submissionVerdicts).toContainEqual({
    accepted: true,
    message:
      "Item agente-1 criado na Agenda. Use esse ID para perguntar ou resolver o furo.",
  });
});
```

- [ ] **Step 2: Run the ceremony test and verify red**

```bash
rtk pnpm exec vitest run packages/ceremony/src/ceremony.test.ts -t "should persist a gap discovered by the main agent"
```

Expected: FAIL because `consume` ignores the new event and no Agenda item appears.

- [ ] **Step 3: Implement the ceremony handler and canonical tool registry**

Import `AGENT_TOOL_NAMES` from `@sprint-griller/agent-runtime` and replace the duplicated `CEREMONY_AGENT_TOOLS` array with:

```ts
const CEREMONY_AGENT_TOOLS = AGENT_TOOL_NAMES;
```

Add a handler whose expected and unexpected error paths mirror the hardened Spec/Ticket handlers already in this workspace:

```ts
async function receiveAgendaItemSubmission(
  sessionId: string,
  live: LiveTurn,
  pending: Extract<AgentEvent, { readonly type: "agenda-item-submission" }>["item"],
): Promise<void> {
  try {
    const item = store.addAgentRefinementItem(sessionId, pending.submission.question);
    await pending.respond({
      accepted: true,
      message: `Item ${item.id} criado na Agenda. Use esse ID para perguntar ou resolver o furo.`,
    });
    live.progressed = true;
    changed(sessionId);
  } catch (error) {
    if (error instanceof CeremonyError) {
      await pending.respond({ accepted: false, message: error.message });
      return;
    }
    await pending.respond({
      accepted: false,
      message: "Não foi possível adicionar o item à Agenda. Tente novamente.",
    });
    throw error;
  }
}
```

Route the new event from the `consume` switch with `await receiveAgendaItemSubmission(sessionId, live, event.item)`.

- [ ] **Step 4: Run the ceremony test and verify green**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Prove the returned ID works in the existing progression paths**

Add one fake turn containing `add-item` followed by the existing `resolve-item` step for `agendaItemId: "agente-1"`. Assert through `ceremony.palco` that the item is `resolvido` with the submitted fact and citations. No new production path should be needed; this locks down integration between the new identity and the existing resolver.

Add a separate fake turn containing `add-item` followed by `ask` with
`agendaItemId: "agente-1"`. Assert through `ceremony.palco` that the active
question carries that Agenda identity and the item is `aguardando-sala`.

- [ ] **Step 6: Write and run the unexpected-failure regression**

Override `store.addAgentRefinementItem` in the test to throw `new Error("detalhe interno do SQLite")`, supply the existing structured test logger, and submit `add-item`. Assert one object containing:

```ts
{
  verdict: {
    accepted: false,
    message: "Não foi possível adicionar o item à Agenda. Tente novamente.",
  },
  log: expect.objectContaining({
    sessionId: SESSION_ID,
    err: expect.any(Object),
    msg: "cerimônia morreu fora do fluxo de erro",
  }),
}
```

Before Step 3 this test fails by omission; after Step 3 it passes and proves internals are not leaked.

- [ ] **Step 7: Write the failing instruction contract**

Add to `prompt.test.ts`:

```ts
it("should tell the main agent to persist newly discovered gaps before progressing them", () => {
  const instructions = ceremonyInstructions(repos);

  expect(instructions).toContain("add_refinement_item");
  expect(instructions).toMatch(/ID devolvido para perguntar[\s\S]*resolver/i);
});
```

Run:

```bash
rtk pnpm exec vitest run packages/ceremony/src/prompt.test.ts -t "should tell the main agent to persist newly discovered gaps before progressing them"
```

Expected: FAIL because the current instructions assume every Agenda item came from Investigation or the room.

- [ ] **Step 8: Add the minimum instruction text**

Add this rule before the existing fact/decision rules in `ceremonyInstructions`:

```ts
"Se ao ler o código você descobrir um furo que não está na Agenda, chame",
"`add_refinement_item` primeiro. Use o ID devolvido para perguntar à sala com",
"`ask_operator` ou resolver o item com `resolve_refinement_item`.",
```

Renumber the following visible rules so the instructions remain coherent.

- [ ] **Step 9: Run the focused ceremony and prompt suites**

```bash
rtk pnpm exec vitest run packages/ceremony/src/ceremony.test.ts packages/ceremony/src/prompt.test.ts
```

Expected: both files PASS.

- [ ] **Step 10: Commit the ceremony integration**

Because `ceremony.ts` and `ceremony.test.ts` already contain the approved recovery/error fixes from the preceding review, inspect `git diff --cached` and include those changes intentionally in this commit rather than dropping them.

```bash
git add packages/ceremony/src/ceremony.ts packages/ceremony/src/ceremony.test.ts packages/ceremony/src/prompt.ts packages/ceremony/src/prompt.test.ts
git diff --cached --check
git commit -m "feat(ceremony): accept agent-discovered gaps"
```

---

### Task 4: Cross-package verification and review

**Files:**
- Modify only defects exposed by verification, with a failing regression test before each behavioral correction.

**Interfaces:**
- Verifies all interfaces produced by Tasks 1–3.
- Produces no new behavior.

- [ ] **Step 1: Run typecheck, lint, and all tests**

```bash
rtk pnpm check
```

Expected: typecheck, lint, and every Vitest file PASS.

- [ ] **Step 2: Run the production build**

```bash
rtk pnpm build
```

Expected: PASS with the workspace's required local Refina configuration present. If Conductor did not copy a gitignored config required by the build, report that environment prerequisite without changing production validation.

- [ ] **Step 3: Inspect the complete branch and working-tree diff**

```bash
rtk git diff --check
rtk git status --short
rtk git diff origin/master...HEAD --stat
rtk git diff HEAD --stat
```

Confirm the new tool has one canonical registry, the SQLite schema is unchanged, no dependency was added, and unrelated uncommitted Palco recovery changes remain present.

- [ ] **Step 4: Run the two-axis code review**

Invoke the repository `code-review` skill with fixed point `origin/master` and use both the parent Refina design and `docs/superpowers/specs/2026-08-14-agent-originated-agenda-items-design.md` as Spec sources. Address only concrete findings, each with a failing test where behavior changes.

- [ ] **Step 5: Commit verification fixes if any exist**

Stage only files changed for concrete review findings and use:

```bash
git commit -m "fix: address agent agenda review findings"
```

Skip this commit when verification and review require no changes.
