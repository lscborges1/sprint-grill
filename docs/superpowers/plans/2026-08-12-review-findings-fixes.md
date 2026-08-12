# Review Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six accepted review findings while preserving the existing signed dump, retry, and estimate contracts.

**Architecture:** Keep validation at the domain/store boundary, coordinate ceremony startup and dumping through the existing process-local story registries, and represent safety-sensitive states with discriminated unions. Each change stays in its current module and receives a focused RED/GREEN cycle before the full workspace check.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16, Zod 4, Vitest 4, SQLite/Drizzle, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-12-review-findings-fixes-design.md`

## Global Constraints

- New estimates remain exactly `1, 2, 3, 5, 8, 13, 21, 34, 55, 89`; frozen legacy estimates remain retryable unchanged.
- `SignedDumpInputs` remains the immutable retry contract.
- Invalid traceability must fail before `beginDump`, credentials loading, or any Azure DevOps request.
- Story startup and dumping remain process-local, matching the existing registries.
- Do not add dependencies, extract a Markdown module, redesign persistence, or change the action-state protocol.
- Every behavior change starts with a failing test that is observed before production code changes.

---

## File Map

- `packages/ceremony/src/spec.ts`: validate the signed traceability appendix and share its matching rules with publication.
- `packages/ceremony/src/spec.test.ts`: unit contract for appendix cardinality, ordering, repeated entries, and fenced headings.
- `packages/ceremony/src/store.ts`: pass persisted decisions into Spec validation at save and dump boundaries.
- `packages/ceremony/src/store.test.ts`: prove invalid traceability cannot be saved or frozen.
- `apps/web/src/lib/ceremonies.ts`: validate before remote work and serialize startup against dumping by story.
- `apps/web/src/lib/ceremonies.test.ts`: prove zero ADO calls for invalid traces and both startup/dump concurrency orderings.
- `packages/ado-client/src/rest/ado-rest.ts`: discriminate read requests from audited writes.
- `packages/ado-client/src/rest/ado-rest.test.ts`: compile-time assignability contract for request variants.
- `apps/web/src/app/cerimonia/[sessionId]/dossie/use-dump-gate.ts`: expose one discriminated dump-gate view.
- `apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.tsx`: render by the discriminated view.
- `apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx`: reset mock state and cover each valid view.
- `packages/ceremony/src/prompt.ts`: state the full agent-ready Task contract.
- `packages/ceremony/src/prompt.test.ts`: lock the self-contained, one-session wording.

---

### Task 1: Reject unsigned traceability before publication

**Files:**
- Modify: `packages/ceremony/src/spec.test.ts:158-281`
- Modify: `packages/ceremony/src/spec.ts:5-241`
- Modify: `packages/ceremony/src/store.test.ts:54-76`
- Modify: `packages/ceremony/src/store.ts:510-526,797-806`
- Modify: `apps/web/src/lib/ceremonies.test.ts:444-1335`
- Modify: `apps/web/src/lib/ceremonies.ts:1-12,295-359`

**Interfaces:**
- Produces: `assertValidSpecMarkdown(markdown: string, decisions?: readonly CeremonyDecision[]): void`.
- Preserves: `appendDecisionTraceability(markdown, decisions)` inserts only generated record links.
- Consumes: persisted `CeremonyDecision[]` from the current session.

- [ ] **Step 1: Write failing unit tests for the signed appendix**

Add cases under `describe("assertValidSpecMarkdown")` that call the validator with `REFINED.decisions`:

```ts
it("should reject a signed Spec that removes decision traceability", () => {
  const markdown = renderSpecMarkdown(REFINED).replace(
    /\n\n## Rastreabilidade de decisões[\s\S]*$/,
    "\n",
  );

  expect(() => assertValidSpecMarkdown(markdown, REFINED.decisions)).toThrow(
    /rastreabilidade.*ausente/i,
  );
});

it("should require repeated reviewed entries in decision order", () => {
  const repeated = { ...REFINED.decisions[0]!, question: "A integração fica síncrona?", answer: "Sim" };
  const decisions = [
    repeated,
    { ...repeated, questionSeq: 2, questionId: "q2" },
  ];
  const markdown = renderSpecMarkdown({ ...REFINED, decisions }).replace(
    "- **A integração fica síncrona?** — Sim\n- **A integração fica síncrona?** — Sim",
    "- **A integração fica síncrona?** — Sim",
  );

  expect(() => assertValidSpecMarkdown(markdown, decisions)).toThrow(/decisão 2/i);
});
```

Also add a fenced-code case proving `## Rastreabilidade de decisões` inside a fence does not count.

- [ ] **Step 2: Run the unit tests and observe RED**

Run:

```bash
rtk pnpm vitest run packages/ceremony/src/spec.test.ts
```

Expected: FAIL because `assertValidSpecMarkdown` does not accept decisions and does not require the appendix.

- [ ] **Step 3: Implement shared appendix parsing and validation**

In `spec.ts`, add the appendix heading to the section scan and validate exact reviewed entries sequentially:

```ts
export function assertValidSpecMarkdown(
  markdown: string,
  decisions: readonly CeremonyDecision[] = [],
): void {
  const requiredHeadings = [
    ...Object.values(SPEC_SECTIONS).map((section) => section.heading),
    DECISION_TRACEABILITY_HEADING,
  ];
  const occurrences = findCanonicalSections(markdown, requiredHeadings);
  // Keep the existing missing/duplicate/empty checks for every required heading.
  // Then locate the one appendix and search for each reviewed entry from the
  // previous match's end, using traceabilityEntry without record metadata.
}
```

Extract a small internal helper that returns the appendix bounds and sequential match positions. Reuse it from `appendDecisionTraceability` so validation and link insertion cannot disagree. The helper must ignore fenced headings, allow Operator text around entries, and require one occurrence for each repeated decision.

- [ ] **Step 4: Run the unit tests and observe GREEN**

Run:

```bash
rtk pnpm vitest run packages/ceremony/src/spec.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing store and workflow boundary tests**

Update the `validSpec` fixture to append the real traceability heading and empty-state text. Add a store test that records a decision, removes its reviewed trace entry, and expects both `saveSpecDraft` and `beginDump` to reject while `dump.status` remains `not-started`.

Add a web workflow test that edits out the reviewed entry, submits the dump, and asserts:

```ts
await expect(dumpCeremony(input)).rejects.toThrow(/rastreabilidade/i);
expect(readDumpCompletion).not.toHaveBeenCalled();
expect(publishDecisionRecord).not.toHaveBeenCalled();
expect(getDossie(session.id)?.dump.status).toBe("not-started");
```

- [ ] **Step 6: Run the boundary tests and observe RED**

Run:

```bash
rtk pnpm vitest run packages/ceremony/src/store.test.ts apps/web/src/lib/ceremonies.test.ts
```

Expected: FAIL because store validation lacks persisted decisions and the workflow does not validate before preflight.

- [ ] **Step 7: Pass decisions at every validation boundary**

In `store.saveSpecDraft` and `store.beginDump`, call:

```ts
assertValidSpecMarkdown(markdown, store.listDecisions(sessionId));
```

In `dumpCeremonyNow`, before `store.beginDump`, call:

```ts
assertValidSpecMarkdown(signed, initial.decisions);
```

Import `assertValidSpecMarkdown` from `@sprint-griller/ceremony`. Keep the store check even though the workflow checks first; the store is independently safe.

- [ ] **Step 8: Run focused tests and observe GREEN**

Run:

```bash
rtk pnpm vitest run packages/ceremony/src/spec.test.ts packages/ceremony/src/store.test.ts apps/web/src/lib/ceremonies.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the traceability fix**

```bash
rtk git add packages/ceremony/src/spec.ts packages/ceremony/src/spec.test.ts packages/ceremony/src/store.ts packages/ceremony/src/store.test.ts apps/web/src/lib/ceremonies.ts apps/web/src/lib/ceremonies.test.ts
rtk git commit -m "fix: validate signed decision traceability"
```

---

### Task 2: Serialize ceremony startup against dumping

**Files:**
- Modify: `apps/web/src/lib/ceremonies.test.ts:302-443,1185-1335`
- Modify: `apps/web/src/lib/ceremonies.ts:168-223,255-293`

**Interfaces:**
- Consumes: `registry.startingByStory`, `findOpenSessionByStory`, and `dumpsInFlightByStory`.
- Produces: one story-level invariant: startup and dumping cannot overlap, and an old session cannot dump while another session for its story is open.

- [ ] **Step 1: Write failing controlled concurrency tests**

Add one test where an old ceremony is closed, a second `startCeremony(storyId)` is held in `readIncompleteDumps`, and `dumpCeremony` for the old session rejects before any publish mock runs. Release the held read and prove startup completes.

Add the opposite ordering by holding `readDumpCompletion` after the old dump synchronously reserves its inputs, then call `startCeremony(storyId)` and expect the existing incomplete-dump error. The second ordering should align with the existing local-incomplete regression rather than duplicate its assertions.

- [ ] **Step 2: Run the concurrency cases and observe RED**

Run:

```bash
rtk pnpm vitest run apps/web/src/lib/ceremonies.test.ts -t "startup|starting|incomplete locally"
```

Expected: the startup-first test fails because the old dump currently starts while `startingByStory` is populated.

- [ ] **Step 3: Add the minimum registry guards**

At the start of `dumpCeremony`, after resolving `initial`, reject when either condition holds:

```ts
if (registry.startingByStory.has(initial.story.id)) {
  return Promise.reject(new CeremonyError(
    `a US #${initial.story.id} já está abrindo outra cerimônia. Aguarde antes de despejar.`,
  ));
}
const open = getStore().findOpenSessionByStory(initial.story.id);
if (open && open.id !== input.sessionId) {
  return Promise.reject(new CeremonyError(
    `a US #${initial.story.id} já tem outra cerimônia aberta. Encerre-a antes de despejar esta.`,
  ));
}
```

Keep the existing synchronous incomplete-dump check in `startCeremony`. Do not add another persistence table or mutex.

- [ ] **Step 4: Run the ceremony workflow suite and observe GREEN**

Run:

```bash
rtk pnpm vitest run apps/web/src/lib/ceremonies.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the concurrency fix**

```bash
rtk git add apps/web/src/lib/ceremonies.ts apps/web/src/lib/ceremonies.test.ts
rtk git commit -m "fix: serialize ceremony startup and dumps"
```

---

### Task 3: Make ADO write safety a discriminated union

**Files:**
- Create: `packages/ado-client/src/rest/ado-rest.test.ts`
- Modify: `packages/ado-client/src/rest/ado-rest.ts:17-48`

**Interfaces:**
- Produces: exported `RequestSpec<TSchema>` with `write` as the discriminant.
- Read variant: `write?: false`, `method?: "GET" | "POST"`.
- Write variant: `write: true`, `method?: "POST" | "PATCH" | "PUT"`.
- Preserves POST-based read APIs such as WIQL and work-item batches.

- [ ] **Step 1: Write failing compile-time assignability tests**

Create `ado-rest.test.ts`:

```ts
import { expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { RequestSpec } from "./ado-rest";

const schema = z.object({ id: z.number() });
type Spec = RequestSpec<typeof schema>;

it("should require write auditing for mutating HTTP methods", () => {
  expectTypeOf<{ operation: string; path: string; schema: typeof schema; method: "PATCH" }>()
    .not.toMatchTypeOf<Spec>();
  expectTypeOf<{
    operation: string;
    path: string;
    schema: typeof schema;
    method: "PATCH";
    write: true;
  }>().toMatchTypeOf<Spec>();
});

it("should keep POST available for read APIs with request bodies", () => {
  expectTypeOf<{
    operation: string;
    path: string;
    schema: typeof schema;
    method: "POST";
    body: { query: string };
  }>().toMatchTypeOf<Spec>();
});
```

- [ ] **Step 2: Run typecheck and observe RED**

Run:

```bash
rtk pnpm --filter @sprint-griller/ado-client typecheck
```

Expected: FAIL because a PATCH without `write: true` still matches `RequestSpec`.

- [ ] **Step 3: Implement the discriminated request variants**

Keep common fields in `RequestSpecBase<TSchema>` and define:

```ts
interface ReadRequestSpec<TSchema extends z.ZodType> extends RequestSpecBase<TSchema> {
  readonly write?: false;
  readonly method?: "GET" | "POST";
}

interface WriteRequestSpec<TSchema extends z.ZodType> extends RequestSpecBase<TSchema> {
  readonly write: true;
  readonly method?: "POST" | "PATCH" | "PUT";
}

export type RequestSpec<TSchema extends z.ZodType> =
  | ReadRequestSpec<TSchema>
  | WriteRequestSpec<TSchema>;
```

Leave runtime `send`, logging, and error handling unchanged. Existing write call sites already declare `write: true`.

- [ ] **Step 4: Run typecheck, unit tests, and lint; observe GREEN**

Run:

```bash
rtk pnpm --filter @sprint-griller/ado-client typecheck
rtk pnpm vitest run packages/ado-client/src/rest/ado-rest.test.ts packages/ado-client/src/refinement/publish-refinement.test.ts packages/ado-client/src/investigation/publish-investigation.test.ts
rtk pnpm --filter @sprint-griller/ado-client lint
```

Expected: PASS.

- [ ] **Step 5: Commit the request type fix**

```bash
rtk git add packages/ado-client/src/rest/ado-rest.ts packages/ado-client/src/rest/ado-rest.test.ts
rtk git commit -m "refactor: make ado writes explicit"
```

---

### Task 4: Replace dump-gate booleans with a discriminated view

**Files:**
- Modify: `apps/web/src/app/cerimonia/[sessionId]/dossie/use-dump-gate.ts:9-76`
- Modify: `apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.tsx:20-208`
- Modify: `apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx:1-83`

**Interfaces:**
- Produces: `DumpGateView = EditableDumpGateView | RetryableDumpGateView | PublishingDumpGateView | CompletedDumpGateView`.
- `editable` carries `tasksMarkdown`; `retryable` carries `tasksMarkdown` and `estimate`; terminal views carry no form inputs.
- `DumpGateController.view` replaces `dumpCompleted`, `dumpPublishing`, `dumpLocked`, and `estimateDefault`.

- [ ] **Step 1: Reproduce and then fix the order-dependent test setup**

Run the existing shuffled test first:

```bash
rtk pnpm vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx' --sequence.shuffle --sequence.seed=1
```

Expected RED: the legacy-estimate case inherits `dumpPublishing: true`.

Import `beforeEach`, keep an immutable `DEFAULT_CONTROLLER`, and reset:

```ts
beforeEach(() => {
  controller.current = { ...DEFAULT_CONTROLLER };
});
```

Run the shuffled command again and expect GREEN before beginning the production refactor.

- [ ] **Step 2: Change component tests to the wished-for union API and observe RED**

Replace boolean overrides with only valid states:

```ts
controller.current = {
  ...DEFAULT_CONTROLLER,
  view: { status: "retryable", tasksMarkdown: DEFAULT_TASKS, estimate: 4 },
};
```

Use `{ status: "publishing" }` and `{ status: "completed" }` for terminal cases. Add one test proving a transient successful action maps to the completed view through the pure `dumpGateView` projection.

Run the component test and web typecheck. Expected RED: `DumpGateController` has no `view` and still requires parallel booleans.

- [ ] **Step 3: Implement the four-state view projection**

In `use-dump-gate.ts`, export:

```ts
export type DumpGateView =
  | { readonly status: "editable"; readonly tasksMarkdown: string }
  | { readonly status: "retryable"; readonly tasksMarkdown: string; readonly estimate: number }
  | { readonly status: "publishing" }
  | { readonly status: "completed" };
```

Implement `dumpGateView(dump, actionResult, tasksMarkdown)` with `actionResult.status === "success"` taking precedence until SSE reports completion. In `DumpGate`, switch on `gate.view.status`; return terminal components immediately and pass the narrowed editable/retryable view into `DumpReviewForm`. Use `view.status === "retryable"` for read-only Task Markdown and frozen estimate output.

- [ ] **Step 4: Run shuffled tests, typecheck, and lint; observe GREEN**

Run:

```bash
rtk pnpm vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx' --sequence.shuffle --sequence.seed=1
rtk pnpm --filter @sprint-griller/web typecheck
rtk pnpm --filter @sprint-griller/web lint
```

Expected: PASS.

- [ ] **Step 5: Commit the dump-gate refactor**

```bash
rtk git add 'apps/web/src/app/cerimonia/[sessionId]/dossie/use-dump-gate.ts' 'apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.tsx' 'apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx'
rtk git commit -m "refactor: model dump gate states explicitly"
```

---

### Task 5: Complete the Task drafting prompt

**Files:**
- Modify: `packages/ceremony/src/prompt.test.ts:55-59`
- Modify: `packages/ceremony/src/prompt.ts:68-74`

**Interfaces:**
- Preserves: `ceremonyInstructions(repos): string`.
- Adds: explicit natural-language constraints that every Task is self-contained and sized for one agent session.

- [ ] **Step 1: Write the failing prompt contract test**

Extend the existing Task preview test:

```ts
const instructions = ceremonyInstructions(repos);
expect(instructions).toMatch(/autocontid/i);
expect(instructions).toMatch(/uma sessão de agente/i);
```

- [ ] **Step 2: Run the prompt test and observe RED**

Run:

```bash
rtk pnpm vitest run packages/ceremony/src/prompt.test.ts
```

Expected: FAIL because the instructions currently mention only a vertical slice and short description.

- [ ] **Step 3: Add the minimum prompt wording**

Change the Task instruction sentence to require “uma slice vertical autocontida, dimensionada para uma sessão de agente” while preserving headings, acceptance criteria, blockers, and exact Spec-link instructions.

- [ ] **Step 4: Run the prompt and ceremony suites; observe GREEN**

Run:

```bash
rtk pnpm vitest run packages/ceremony/src/prompt.test.ts packages/ceremony/src/ceremony.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the prompt fix**

```bash
rtk git add packages/ceremony/src/prompt.ts packages/ceremony/src/prompt.test.ts
rtk git commit -m "fix: require agent-sized task drafts"
```

---

### Task 6: Final verification

**Files:**
- Verify all files changed by Tasks 1-5.

**Interfaces:**
- Consumes: every focused deliverable above.
- Produces: one verified workspace diff with no unrelated changes.

- [ ] **Step 1: Run the focused regression set together**

```bash
rtk pnpm vitest run packages/ceremony/src/spec.test.ts packages/ceremony/src/store.test.ts packages/ceremony/src/prompt.test.ts packages/ado-client/src/rest/ado-rest.test.ts apps/web/src/lib/ceremonies.test.ts 'apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Prove test-order independence again**

```bash
rtk pnpm vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx' --sequence.shuffle --sequence.seed=1
```

Expected: PASS.

- [ ] **Step 3: Run the full repository check**

```bash
rtk pnpm check
```

Expected: all workspace typechecks, linters, and tests pass.

- [ ] **Step 4: Inspect the final diff**

```bash
rtk git diff origin/master...HEAD --stat
rtk git diff --check origin/master...HEAD
rtk git status --short
```

Expected: no whitespace errors, no untracked implementation artifacts, and only the approved design/plan plus the six fixes.

- [ ] **Step 5: Record any verification-only adjustment**

If verification requires a narrowly scoped correction, repeat its focused RED/GREEN command and commit only that correction with a brief conventional message. If no correction is required, do not create an empty commit.
