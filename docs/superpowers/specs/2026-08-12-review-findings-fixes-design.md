# Review Findings Fix Design

## Goal

Resolve the six accepted review findings without changing the dump contract, the configured Fibonacci estimate scale, or the signed retry semantics.

## Design

### Validate traceability before publication

`assertValidSpecMarkdown(markdown, decisions)` will treat the decision-traceability appendix as part of the signed Spec contract. `CeremonyStore.saveSpecDraft` and `CeremonyStore.beginDump` will pass the session's persisted decisions into that validator.

The appendix must contain exactly one real `## Rastreabilidade de decisões` heading outside fenced code. For each persisted decision, its exact reviewed question-and-answer entry must occur after the preceding decision's entry, preserving decision order. Repeated identical question-and-answer pairs therefore require repeated sequential entries. The Operator may add text before, between, or after entries, but may not remove, reorder, or edit a reviewed entry. With no decisions, the single non-empty appendix and its generated empty-state text remain required. Publication remains limited to inserting generated record links into those reviewed entries.

This validation must run before any Azure DevOps write, so an invalid draft remains editable and cannot become a permanently locked retry.

### Close the session-start race

Story startup and dumping will share the existing process-local story reservations. `startCeremony` keeps its `startingByStory` reservation until `ceremony.start` has persisted the session. `dumpCeremony` will reject while that story is reserved for startup, and it will also reject an old session's dump while a different session for the story is open. Conversely, the existing initial incomplete-dump check rejects startup when a dump reserved first. Because dump reservation and the initial startup check are synchronous before their first awaits, either operation wins the story and the other rejects; no runtime session is allocated and then abandoned solely for this check.

No new persistence mechanism is introduced. The behavior remains intentionally process-local, matching the existing start and dump registries.

### Make the component test deterministic

The dump-gate test will construct a fresh controller state in `beforeEach`. Individual cases may override only the fields they exercise. Shuffled execution must produce the same result as declared execution order.

### Make ADO request safety compile-time explicit

`RequestSpec` will become a discriminated union:

- read requests permit `GET` and cannot claim write semantics;
- write requests require `write: true` and permit `POST`, `PATCH`, or `PUT`.

Existing request behavior, logging, error messages, and retry uncertainty remain unchanged. Call sites that already perform writes will continue to declare `write: true`.

### Preserve dump status as a discriminated state

The dump-gate controller will expose one `view` union instead of independent `dumpCompleted`, `dumpPublishing`, and `dumpLocked` booleans:

- `{ status: "editable", tasksMarkdown }` for a new dump;
- `{ status: "retryable", tasksMarkdown, estimate }` for frozen inputs that may be retried;
- `{ status: "publishing" }` for persisted publication in progress;
- `{ status: "completed" }` for persisted completion or transient server-action success before SSE catches up.

Rendering, locked-input selection, and estimate output will switch on this union. Only `editable` and `retryable` render the review form. Unrelated UI state such as whether the review panel is open and whether a form submission is pending remains separate.

### Complete the Task drafting contract

The ceremony prompt will explicitly require every generated Task to be self-contained and sized for one agent session, in addition to the existing vertical-slice, acceptance-criteria, dependency, and exact-Spec-link requirements. Human review remains responsible for semantic judgment; no speculative automated size classifier is added.

## Error handling and invariants

- Invalid traceability fails locally before `beginDump` and before ADO credentials are read.
- Story startup and dumping cannot overlap; the operation that reserves the story first proceeds and the other receives a validation error.
- Mutating ADO methods cannot be represented as read requests.
- Persisted `publishing`, `retryable`, and `completed` behavior remains unchanged.
- New estimates remain exactly `1, 2, 3, 5, 8, 13, 21, 34, 55, 89`; frozen legacy estimates remain retryable.

## Test strategy

Each behavior change follows RED/GREEN:

1. A Spec missing or altering reviewed traceability is rejected before any ADO publication.
2. Controlled concurrency tests cover both orderings: a reserved dump blocks startup, and an in-flight startup blocks a dump from an older closed session.
3. The component test passes with Vitest shuffling.
4. Type-level cases prove write methods require `write: true` and reads reject it.
5. Dump-gate component cases consume only the four valid discriminated view states, including transient action success.
6. The prompt test requires the self-contained and one-agent-session wording.

Focused suites run after each fix, followed by `pnpm check` and `git diff --check`.

## Out of scope

- Changing the estimate scale or making it configurable.
- Replacing the Markdown renderer or Task parser.
- Redesigning dump persistence, retry identity, or story-level serialization.
- Broader action-state or ceremony-start UI redesign.
