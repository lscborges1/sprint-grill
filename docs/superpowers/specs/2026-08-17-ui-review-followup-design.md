# UI Review Follow-up Design

## Goal

Resolve four review regressions without changing the persisted workflow, Azure DevOps writes, or the visible Picker action model.

## Scope

This change restores investigation redispatch after a failed or rejected run, keeps Dossiê reopen failures inside their confirmation dialog, gives Picker actions story-specific accessible names, and rejects duplicate ticket identifiers at the agent-output boundary.

It does not redesign the Picker, change investigation persistence, add dependencies, change ceremony phases, or alter successful publication and refinement paths.

## Investigation redispatch

`derivePickerAction` remains open-only whenever a local run exists so the Operator can inspect the current failure or rejected report. The production investigation controller will inject `startInvestigationAction` into `InvestigationView` as an optional retry capability. Failed and rejected outcomes render a redispatch form only when that capability is present.

The optional capability preserves the development fixture contract: the rejected Investigação fixture omits the retry action and continues to expose no mutation control. Production always supplies it. Redispatch submits only the current `storyId` through the existing server action, so the existing in-memory guard still prevents a duplicate run while one is active and preserves the previous report during a new attempt.

## Dossiê confirmation errors

`ConfirmAction` will accept optional `pending` and `error` presentation state from its owner. While pending, the destructive confirmation button is disabled and marked busy. When the action returns an expected error such as a stale refinement revision, the open modal renders that error with `role="alert"`; the Operator can read it before cancelling or retrying.

`ReopenForm` remains the owner of `useActionState` and passes its state into the reusable confirmation primitive. The server action and revision check remain unchanged.

Cancelling and reopening the dialog keeps the last failure visible so the Operator does not lose its context. Starting another attempt temporarily hides that previous failure while the confirmation is pending; a new failure replaces it, and a successful phase transition unmounts the reopen control.

## Picker accessible names

The visible action labels remain unchanged. Both start buttons and detail links receive an accessible name containing the action label plus the User Story ID and title. A sprint with several stories in the same state therefore has distinguishable controls without adding visual noise.

## Ticket identifier boundary

`refinementTicketsSubmissionSchema` will reject a submission containing the same exact, non-empty ticket `id` more than once. Validation happens before the submission reaches ceremony persistence or the Dossiê, preserving `ticket.id` as a safe React identity. The inferred public ticket type and the JSON tool shape remain unchanged.

## Error and compatibility behavior

- Expected reopen failures remain recoverable UI state and do not throw a route error.
- Investigation retry uses the existing action and observability path.
- Duplicate ticket IDs are rejected as invalid agent output; no partial artifact is persisted.
- Existing successful, in-progress, publication-failure, and uncertain-publication behavior is unchanged.
- Development fixtures remain inert and production components gain no fixture-specific branch.

## TDD seams

Work proceeds as four vertical red-green slices through confirmed public seams:

1. `InvestigationView`: failed and rejected production-like models expose redispatch when the retry capability is supplied, while the fixture without it remains inert.
2. `DossieView`: a failed reopen action leaves the dialog open with an accessible error and a non-pending confirmation control.
3. `Picker`: rendered start and open actions have story-specific accessible names.
4. `refinementTicketsSubmissionSchema`: duplicate ticket IDs fail boundary parsing.

Each slice starts with one failing behavior test, adds the minimum implementation, and reruns its focused suite before the next slice. Final verification runs `pnpm check` and a production build with a valid local review configuration.

## Acceptance criteria

- The Operator can redispatch after both `falhou` and `reprovado` outcomes without restarting the server.
- The rejected development fixture still exposes no mutation form.
- A stale Dossiê reopen error is announced inside the still-open modal, and the confirmation button cannot be submitted while pending.
- Picker actions are distinguishable by User Story to assistive technology.
- Duplicate ticket IDs are rejected by the exported runtime schema before persistence.
- Existing tests, typecheck, lint, and production build remain green.
