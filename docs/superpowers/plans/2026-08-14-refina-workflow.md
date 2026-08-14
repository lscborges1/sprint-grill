# Refina Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace implicit ceremony completion with Refina's persisted agenda and gated Refinar → Spec → Tickets → Publicar workflow.

**Architecture:** Keep `agent-runtime` as the Codex app-server boundary and deepen `ceremony` into the workflow owner. Persist the agenda, phase, drafts, approvals, and revisions in SQLite; expose complete Palco/Dossiê projections over the existing SSE seam; keep all Azure DevOps writes deterministic.

**Tech Stack:** TypeScript 5.9, Zod, Drizzle/SQLite, Next.js App Router, React 19, Vitest, Codex app-server.

**Spec:** `docs/superpowers/specs/2026-08-14-refina-workflow-design.md`

## Global Constraints

- Use the visible brand “Refina” and the terms “Refinamento coletivo”, “Refinar com a sala”, “Agenda do refinamento”, and “Resolução”.
- Keep package namespaces, routes, config/env names, database path, and `sprint-griller:*` markers unchanged.
- Remove `decidedBy` end-to-end; retain question, answer, recommendation, citations where applicable, and automatic timestamps.
- Exactly one room question may be active at a time.
- No open agenda item may advance to Spec review or publication; no operator override exists.
- A late doubt reopens refinement and invalidates downstream approvals while preserving history.
- Do not add dependencies. Use Zod at external boundaries and discriminated unions for workflow state.
- Every production behavior starts with a failing public-contract test. Run focused tests after each cycle and `rtk pnpm check && rtk pnpm build` at the end.

---

### Task 1: Persist the Refina domain model and remove decision attribution

**Files:**
- Modify: `CONTEXT.md`, `docs/adr/`, `packages/ceremony/src/types.ts`, `packages/ceremony/src/schema.ts`, `packages/ceremony/src/store.ts`
- Modify: `packages/ado-client/src/refinement/publish-refinement.ts`
- Test: existing store, schema, spec, dump, and ADO publication test suites

**Interfaces:**
- Produces persisted `RefinementPhase` and discriminated `RefinementItem`/resolution types.
- Produces store operations to seed/list/transition agenda items and update the session phase/revision.
- Removes `decidedBy` from decision inputs, transcript events, persisted rows, SSE schemas, and ADO decision records.

- [x] Write failing store and publication tests for phase/agenda persistence and authorless resolutions.
- [x] Run the focused tests and confirm failures are caused by missing contracts.
- [x] Add the minimum schema/types/store/ADO changes, bump `SCHEMA_VERSION`, and update domain docs/ADR.
- [x] Run focused tests and refactor while green.

### Task 2: Make agent completion explicit and generalize room doubts

**Files:**
- Modify: `packages/agent-runtime/src/codex/protocol.ts`, `packages/agent-runtime/src/runtime.ts`, `packages/agent-runtime/src/types.ts`
- Modify: `packages/ceremony/src/ceremony.ts`, `packages/ceremony/src/consulta.ts`, `packages/ceremony/src/prompt.ts`
- Test: agent-runtime and ceremony public-contract suites

**Interfaces:**
- Produces typed agent events for an explicit completion proposal and structured refinement submissions.
- Extends `ask_operator` with agenda identity while enforcing one active question.
- Replaces factual-only consultation with a classified doubt outcome: verified fact, room choice, unverified answer, or failure.

- [x] Write failing tests proving a normal `turn-completed` cannot close refinement and that a completion proposal is rejected with open items.
- [x] Write failing tests for automatic continuation, one-question enforcement, and generalized doubt classification.
- [x] Implement the minimum protocol schemas, runtime events, prompt contracts, lifecycle loop, and recovery behavior.
- [x] Run focused tests and refactor while green.

### Task 3: Add versioned Spec/Ticket gates and server-owned publication

**Files:**
- Modify: `packages/ceremony/src/spec.ts`, `packages/ceremony/src/task-draft.ts`, `packages/ceremony/src/dossie.ts`, `packages/ceremony/src/despejo.ts`
- Modify: lifecycle/store modules and their tests as required by the approved revision contracts
- Test: spec, task draft, lifecycle, Dossiê, dump, and publication suites

**Interfaces:**
- Produces structured Spec and Ticket submissions, deterministic Markdown renderers, revisions, and approval operations.
- Publication consumes only `sessionId` and `estimate`, loading and revalidating approved artifacts from the store.
- Reopening refinement invalidates approved Spec/Tickets and returns the phase to `refinando`.

- [x] Write failing renderer and lifecycle tests for required Spec sections, ticket links/DAG, approvals, and invalidation.
- [x] Write failing dump tests for agenda/approval gates and server-owned inputs.
- [x] Implement structured rendering, revisioned persistence, lifecycle transitions, and strict publication gates.
- [x] Run focused tests and refactor while green.

### Task 4: Update the Palco, Dossiê, actions, and visible brand

**Files:**
- Modify: `apps/web/src/app/cerimonia/`, `apps/web/src/lib/ceremonies.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`
- Modify: visible copy in investigation entrypoints and `README.md`
- Test: web action, live-state, component, and dump-gate suites

**Interfaces:**
- Palco consumes phase/agenda/proposal SSE state and exposes answer, add-doubt, continue, confirm, and resume actions.
- Dossiê exposes separate Spec and Ticket review/approval gates plus reopen and publish actions.
- No browser form accepts authored decision data or publication Markdown supplied as trusted state.

- [x] Write failing UI/action tests for authorless answers, agenda labels, phase gates, stale revisions, and accessible error/loading states.
- [x] Implement server actions, Zod boundaries, Palco/Dossiê phases, and Refina copy.
- [x] Run focused tests and refactor while green.

### Task 5: Cross-package verification and final review

**Files:**
- Modify only defects exposed by verification or review.
- Test: repository-wide checks

- [x] Run `rtk pnpm check` and fix failures with a regression test for each behavioral defect.
- [x] Run `rtk pnpm build` and fix integration/bundling defects.
- [x] Review `git diff origin/master...HEAD` against every requirement and remove stale visible Grill/grelhar and `decidedBy` references, excluding compatibility identifiers and historical ADR text.
- [x] Run the full checks again and record final evidence.
