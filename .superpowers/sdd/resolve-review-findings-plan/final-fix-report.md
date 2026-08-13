# Final Fix Report

Fix base: `9b76930dd25a12a122ad7daebba7bbc5635af07c`

## Outcome

The final ceremony dump review wave is implemented as one store/workflow integrity fix. The durable dump state is now the immutable retry contract; the Dossiê is frozen before any Azure DevOps await; dump work is serialized per story; concurrent same-session sharing requires identical signed values; reviewed traceability exists before signature; and a persisted publishing state is non-interactive in the gate.

## Finding 1 — retries could replace signed Tasks

Implementation evidence:

- `dumpCeremonyNow` compares retry `tasksMarkdown` with `SignedDumpInputs.tasksMarkdown`, parses the frozen Markdown, and passes that frozen value back to the store.
- `CeremonyStore.beginDump` compares all four `SignedDumpInputs` fields (`dumpId`, `markdown`, `tasksMarkdown`, `estimate`) at the store boundary.
- A valid retry updates only `dump_started_at`; it does not rewrite any signed field.
- Store and web regressions prove a Task-only change is rejected and the persisted Task Markdown is unchanged.

RED:

```text
$ pnpm test packages/ceremony/src/store.test.ts
Test Files  1 failed (1)
Tests  4 failed | 62 passed (66)
FAIL should refuse a retry that changes only the signed Tasks without overwriting them
AssertionError: expected [Function] to throw an error
```

GREEN:

```text
$ pnpm test packages/ceremony/src/store.test.ts
Test Files  1 passed (1)
Tests  66 passed (66)
```

The web-level Task-only retry regression also passes in `apps/web/src/lib/ceremonies.test.ts` and proves no second Task publication is attempted.

## Finding 2 — trace question/answer content was added after signature

Implementation evidence:

- `renderSpecMarkdown` now includes one deterministic `## Rastreabilidade de decisões` appendix with every decision question and answer before review/signature.
- `appendDecisionTraceability` requires that signed appendix and its reviewed entries to exist, scopes matching to that appendix, and inserts only each publication-generated deep link.
- Operator-authored Markdown and following headings remain byte-for-byte unchanged; the appendix is never duplicated.
- `stripDecisionRecordLinks` recognizes the new generated link-only lines.
- Repeated identical question/answer entries are handled sequentially, with one record link per entry.

RED:

```text
$ pnpm test packages/ceremony/src/spec.test.ts
Test Files  1 failed (1)
Tests  3 failed | 20 passed (23)
FAIL should include every decision question and answer in traceability before signature
FAIL should insert only the generated deep link into an Operator-edited signed trace
FAIL should reject publication when the signed Spec has no reviewed trace
```

GREEN:

```text
$ pnpm test packages/ceremony/src/spec.test.ts packages/ceremony/src/dossie.test.ts
Test Files  2 passed (2)
Tests  46 passed (46)
```

Self-review exposed a repeated-entry edge, which received its own cycle:

```text
RED  $ pnpm test packages/ceremony/src/spec.test.ts
     1 failed | 24 passed — both links were attached to the first repeated entry
GREEN $ pnpm test packages/ceremony/src/spec.test.ts
      25 passed (25)
```

## Finding 3 — snapshot freeze happened after asynchronous preflight

Implementation evidence:

- Local validation, Task parsing, dump fingerprinting, and `store.beginDump` now complete before `readDumpCompletion` or `readIncompleteDumps` is awaited.
- `beginDump` is the durable reservation: once it succeeds, all Dossiê-affecting store mutations reject.
- A controlled regression holds `readDumpCompletion`, attempts a decision during the hold, and proves the reserved snapshot remains unchanged.

RED:

```text
$ pnpm test apps/web/src/lib/ceremonies.test.ts
Test Files  1 failed (1)
Tests  3 failed | 41 passed (44)
FAIL should reserve the signed snapshot before an asynchronous ADO preflight
AssertionError: promise resolved "undefined" instead of rejecting
```

GREEN:

```text
$ pnpm test apps/web/src/lib/ceremonies.test.ts
Test Files  1 passed (1)
Tests  44 passed (44)
```

## Finding 4 — retryable/completed ceremonies remained mutable

Implementation evidence:

- One store-boundary predicate rejects `publishing`, `retryable`, and `completed` for questions, pending-question abandonment, session completion/failure, decisions, consultation opens/completions, transcript events, and Spec draft save/discard.
- Restart recovery still converts an interrupted `publishing` attempt to `retryable`, but no longer reopens the Dossiê.
- `attachDecisionRecord` remains deliberately available because it records publication-generated metadata only.

RED:

```text
$ pnpm test packages/ceremony/src/store.test.ts
Test Files  1 failed (1)
Tests  4 failed | 62 passed (66)
FAIL should keep Dossiê mutations frozen when an interrupted dump is recovered
FAIL should reject every Dossiê mutation after an aborted dump
FAIL should reject Dossiê mutations after a completed dump while allowing record metadata
```

An additional mutation audit caught `finishSession`:

```text
RED  $ pnpm test packages/ceremony/src/store.test.ts
     1 failed | 65 passed — finishSession did not reject retryable state
GREEN $ pnpm test packages/ceremony/src/store.test.ts
      66 passed (66)
```

## Finding 5 — serialization was session-scoped

Implementation evidence:

- The in-flight registry is keyed by story ID and records the owning session.
- A second session for the same story receives an in-progress validation error while the first is held in preflight; only the first reaches publication.
- Completed sessions still derive distinct dump IDs from their session IDs and remain independently publishable.

RED:

```text
$ pnpm test apps/web/src/lib/ceremonies.test.ts
FAIL should serialize concurrent dumps from separate sessions of one story
AssertionError: promise resolved "undefined" instead of rejecting
```

GREEN:

```text
$ pnpm test apps/web/src/lib/ceremonies.test.ts
Test Files  1 passed (1)
Tests  44 passed (44)
```

## Finding 6 — differing same-session requests shared success

Implementation evidence:

- Each in-flight entry stores a SHA-256 signature of the complete submission-derived signed values: Spec Markdown, Task Markdown, and estimate. Session/story identity is supplied by the owning in-flight entry and the story-keyed map; the dump ID is deterministically derived from those values plus those identities.
- Identical requests return the same promise. Different valid values reject immediately with a ceremony validation error and cannot observe the first request's success.

RED:

```text
$ pnpm test apps/web/src/lib/ceremonies.test.ts
FAIL should reject differing signed inputs while the same session dump is in flight
AssertionError: promise resolved "undefined" instead of rejecting
```

GREEN:

```text
$ pnpm test apps/web/src/lib/ceremonies.test.ts
Test Files  1 passed (1)
Tests  44 passed (44)
```

## Minor findings

### Persisted publishing gate

- `DumpGateController` exposes the persisted publishing projection.
- `DumpGate` renders a non-interactive `role="status"` with no button or form while publishing.

```text
RED  $ pnpm test 'apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx' packages/ceremony/src/task-draft.test.ts
     1 failed | 25 passed — publishing rendered the interactive review button
GREEN same command
      26 passed (26)
```

### Frozen time in cross-session regression

- The identical-Markdown/distinct-session-ID regression now explicitly freezes `Date.now` and restores it in `finally`, removing clock dependence from the equality assertion.

### Every Task validates its own exact Spec URL

- Added a two-Task case where only the first Task contains the exact current Spec URL.
- Existing production validation was already per Task; a mutation check proved the new test detects a first-Task-only implementation.

```text
RED  $ pnpm test packages/ceremony/src/task-draft.test.ts -t 'should validate the exact current Spec link independently for every Task'
     1 failed | 21 skipped — mutation returned valid when only Task 1 was checked
GREEN same command after restoring production behavior
      1 passed | 21 skipped
```

## Focused verification

```text
$ pnpm test packages/ceremony/src/store.test.ts packages/ceremony/src/spec.test.ts packages/ceremony/src/dossie.test.ts packages/ceremony/src/task-draft.test.ts 'apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx' apps/web/src/lib/ceremonies.test.ts apps/web/src/lib/ceremonies.integration.test.ts
Test Files  7 passed (7)
Tests  184 passed (184)
```

Package checks during development:

```text
packages/ceremony: TypeScript no errors; ESLint clean
apps/web: TypeScript no errors; ESLint clean
```

## Full verification

The required full command was run once after implementation and self-review:

```text
$ pnpm check
typecheck: 6 workspace projects passed
lint: 6 workspace projects passed
Test Files  39 passed (39)
Tests  511 passed (511)
exit code 0
```

The error/fatal log entries in the test output are expected assertions from negative configuration and Azure DevOps error-path tests; the suite exited successfully.

## Files changed

- `README.md`
- `apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.test.tsx`
- `apps/web/src/app/cerimonia/[sessionId]/dossie/dump-gate.tsx`
- `apps/web/src/app/cerimonia/[sessionId]/dossie/use-dump-gate.ts`
- `apps/web/src/lib/ceremonies.test.ts`
- `apps/web/src/lib/ceremonies.ts`
- `packages/ceremony/src/spec.test.ts`
- `packages/ceremony/src/spec.ts`
- `packages/ceremony/src/store.test.ts`
- `packages/ceremony/src/store.ts`
- `packages/ceremony/src/task-draft.test.ts`
- `.superpowers/sdd/resolve-review-findings-plan/final-fix-report.md`

## Self-review

Spec axis:

- All six important findings and all three minor findings are covered by behavior tests and implementation evidence above.
- New estimates remain exactly the existing Fibonacci set; exact frozen legacy estimates remain retryable; no schema or migration changed.
- `SignedDumpInputs` remains the single immutable retry contract.
- Exact per-Task Spec-link validation and no publisher injection remain intact.
- The excluded ceremony-start action-state redesign, broad switch centralization, and Markdown renderer extraction were not introduced.

Standards axis:

- External form input remains zod-validated; public APIs remain explicitly typed; no `any`, ignored TypeScript error, empty catch, or swallowed error was added.
- Concurrency and recovery behaviors are covered through controlled promises and persistent SQLite integration rather than mock-call-only assertions.
- The root invariants live at the store/workflow boundary rather than being duplicated across UI callers.
- The complete diff has no whitespace errors.

The requested code-review skill normally launches parallel standards/spec reviewers. That launch was unavailable because the parent thread had already consumed the agent-thread limit, so both axes were audited locally against the same sources. The local audit found the repeated trace-entry issue described above; it was fixed with its own RED/GREEN cycle. No further finding remained.

## Concerns

No known functional concern remains. Story serialization is intentionally process-local, matching the existing in-flight registry model; durable retry/recovery remains in SQLite and remote incomplete-dump markers.
