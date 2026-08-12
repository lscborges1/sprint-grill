# Review Findings Fix Design

## Goal

Resolve the six accepted review findings without changing the dump contract, the configured Fibonacci estimate scale, or the signed retry semantics.

## Design

### Validate traceability before publication

`assertValidSpecMarkdown` will treat the decision-traceability appendix as part of the signed Spec contract. When decisions exist, the appendix must occur exactly once and contain every reviewed question-and-answer entry before `beginDump` freezes the inputs. Publication remains limited to inserting generated record links into those reviewed entries.

This validation must run before any Azure DevOps write, so an invalid draft remains editable and cannot become a permanently locked retry.

### Close the session-start race

`startCeremony` will repeat the local incomplete-dump check after its asynchronous Azure DevOps/runtime preflight and immediately before creating the session. If another tab reserved a dump during an await, the new ceremony will be rejected with the existing recovery guidance.

The existing initial check stays as the fast path. No new lock or persistence mechanism is introduced.

### Make the component test deterministic

The dump-gate test will construct a fresh controller state in `beforeEach`. Individual cases may override only the fields they exercise. Shuffled execution must produce the same result as declared execution order.

### Make ADO request safety compile-time explicit

`RequestSpec` will become a discriminated union:

- read requests permit `GET` and cannot claim write semantics;
- write requests require `write: true` and permit `POST`, `PATCH`, or `PUT`.

Existing request behavior, logging, error messages, and retry uncertainty remain unchanged. Call sites that already perform writes will continue to declare `write: true`.

### Preserve dump status as a discriminated state

The dump-gate controller will expose one view state instead of independent `dumpCompleted`, `dumpPublishing`, and `dumpLocked` booleans. Rendering and locked-input selection will switch on that state, so contradictory combinations cannot compile. Unrelated UI state such as form submission progress remains separate.

### Complete the Task drafting contract

The ceremony prompt will explicitly require every generated Task to be self-contained and sized for one agent session, in addition to the existing vertical-slice, acceptance-criteria, dependency, and exact-Spec-link requirements. Human review remains responsible for semantic judgment; no speculative automated size classifier is added.

## Error handling and invariants

- Invalid traceability fails locally before `beginDump` and before ADO credentials are read.
- A dump that appears during session-start preflight blocks the new session.
- Mutating ADO methods cannot be represented as read requests.
- Persisted `publishing`, `retryable`, and `completed` behavior remains unchanged.
- New estimates remain exactly `1, 2, 3, 5, 8, 13, 21, 34, 55, 89`; frozen legacy estimates remain retryable.

## Test strategy

Each behavior change follows RED/GREEN:

1. A Spec missing or altering reviewed traceability is rejected before any ADO publication.
2. A controlled concurrent test starts a dump while session startup is held in asynchronous preflight and proves no new session is created.
3. The component test passes with Vitest shuffling.
4. Type-level cases prove write methods require `write: true` and reads reject it.
5. Dump-gate component cases consume only valid discriminated view states.
6. The prompt test requires the self-contained and one-agent-session wording.

Focused suites run after each fix, followed by `pnpm check` and `git diff --check`.

## Out of scope

- Changing the estimate scale or making it configurable.
- Replacing the Markdown renderer or Task parser.
- Redesigning dump persistence, retry identity, or story-level serialization.
- Broader action-state or ceremony-start UI redesign.
