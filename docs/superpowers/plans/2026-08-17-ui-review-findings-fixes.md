# UI Review Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four review findings without changing Refina's workflow beyond correcting stale Dossiê presentation, rejecting duplicate ticket list entries, and removing speculative Picker memoization.

**Architecture:** Keep Dossiê behavior observable through the existing pure `DossieView` rendering seam. Enforce ticket-entry identity at the exported Zod submission boundary before data reaches React. Preserve the Picker's public filtering behavior while deriving its cheap filtered list directly during render.

**Tech Stack:** TypeScript, React 19, Next.js 16, Zod 4, Vitest, `react-dom/server`

**Spec:** `docs/superpowers/specs/2026-08-14-refina-workflow-design.md`; `docs/superpowers/specs/2026-08-15-ui-boundary-cleanup-design.md`

## Global Constraints

- Keep the existing refinement phases and persisted state model unchanged.
- The Dossiê remains the Operator surface with separate, explicit gates for Spec and Tickets.
- The default Spec view remains read-only; editing still preserves draft CAS and conflict recovery.
- Parse agent-produced ticket data at the exported Zod boundary before trusting it in the UI.
- Do not add dependencies or fixture-specific production branches.
- Tests exercise the agreed public seams: rendered `DossieView`, exported refinement-ticket validation, and existing Picker rendering/filter behavior.
- Use one vertical red-green slice at a time. Do not add implementation-coupled source-code assertions.
- The Picker memo removal is a behavior-preserving standards refactor: use the existing public behavior tests as regression coverage because manufacturing a red test for the absence of `useMemo` would violate the agreed seam.

---

### Task 1: Make Dossiê gate state explicit

**Files:**
- Modify: `apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.tsx:118-289`
- Test: `apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx`

**Interfaces:**
- Consumes: `DossieView({ state, connected })`, `DossieState["completionProposal"]`, and `SpecEditorController`.
- Produces: rendered current-gate copy derived from the active refinement phase, plus visible reconciliation status/actions whenever Spec approval is blocked by stale or conflicting editor state.

- [ ] **Step 1: Write the failing current-gate test**

Add a rendering test that uses a realistic retained completion proposal after confirmation:

```tsx
it("should describe the active Spec gate when the completion proposal is retained", () => {
  const proposal = "A Agenda foi resolvida e a sala confirmou o avanço.";
  const state = {
    ...DOSSIE_STATE,
    refinement: { ...DOSSIE_STATE.refinement, phase: "revisando-spec" as const },
    completionProposal: { summary: proposal, proposedAt: 7 },
  };

  const html = renderToStaticMarkup(<DossieView state={state} connected />);

  expect(html).toContain("A Spec está disponível para leitura e aprovação.");
  expect(html).toContain(`Proposta de conclusão: ${proposal}`);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
```

Expected: FAIL because `PhaseGate` renders the retained proposal instead of the active Spec-gate description.

- [ ] **Step 3: Make phase copy authoritative after confirmation**

Restrict the proposal summary to `aguardando-confirmacao`; every later phase uses `gateDescription`:

```tsx
const description = state.refinement.phase === "aguardando-confirmacao"
  ? state.completionProposal?.summary ?? gateDescription(state.refinement.phase)
  : gateDescription(state.refinement.phase);
```

Render `description` in `PhaseGate`. Keep the separately labelled proposal in `Agenda` unchanged.

- [ ] **Step 4: Re-run the focused test and verify GREEN**

Run the same focused Vitest command. Expected: all tests in `dossie.test.tsx` PASS.

- [ ] **Step 5: Write the failing reconciliation-visibility test**

Add a rendering test whose saved draft is stale against the latest generated Spec:

```tsx
it("should expose Spec reconciliation while read mode blocks approval", () => {
  const state = {
    ...DOSSIE_STATE,
    refinement: { ...DOSSIE_STATE.refinement, phase: "revisando-spec" as const },
    spec: {
      generated: "# Spec atualizada",
      draft: { markdown: "# Rascunho anterior", base: "# Spec anterior", savedAt: 7 },
    },
  };

  const html = renderToStaticMarkup(<DossieView state={state} connected />);

  expect(html).toContain("A Spec precisa ser reconciliada");
  expect(html).toContain("Regenerar da versão atual");
});
```

- [ ] **Step 6: Run the focused test and verify RED**

Run the focused Dossiê test command. Expected: FAIL because read mode does not render the reconciliation alert or action.

- [ ] **Step 7: Render reconciliation independently of edit mode**

Extract the existing alert and recovery action into a focused internal component:

```tsx
function SpecReconciliation({ state, editor }: {
  readonly state: DossieState;
  readonly editor: SpecEditorController;
}) {
  if (editor.conflict === null && !editor.stale) return null;
  return (
    <Alert heading="A Spec precisa ser reconciliada" tone="warning">
      {/* Preserve the existing explanation and adopt/regenerate controls verbatim. */}
    </Alert>
  );
}
```

Render it in `SubmittedSpecReview` before the read/edit branch and remove the duplicate alert from `SpecEditor`. Keep the textarea and save form edit-only.

- [ ] **Step 8: Verify Task 1**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
rtk pnpm check
```

Expected: focused tests and the full check PASS with no new warnings.

- [ ] **Step 9: Commit Task 1**

```bash
git add 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.tsx' 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
git commit -m "fix(web): clarify blocked dossie gates"
```

### Task 2: Reject duplicate ticket list entries at the boundary

**Files:**
- Create: `packages/agent-runtime/src/codex/protocol.test.ts`
- Modify: `packages/agent-runtime/src/codex/protocol.ts:300-340`

**Interfaces:**
- Consumes: exported `refinementTicketsSubmissionSchema` and `refinementTicketsSubmissionToolSpec`.
- Produces: the same inferred ticket submission type, with duplicate acceptance criteria and duplicate dependency IDs rejected before the event reaches ceremony persistence or React.

- [ ] **Step 1: Write the failing exported-boundary test**

Create a focused schema test through the exported protocol contract:

```ts
import { describe, expect, it } from "vitest";
import { refinementTicketsSubmissionSchema } from "./protocol";

const ticket = {
  id: "ticket-1",
  title: "Implementar exportação",
  description: "Entrega o CSV da US.",
  acceptanceCriteria: ["Retorna CSV em UTF-8."],
  specUrl: "https://dev.azure.com/org/project/_workitems/edit/117",
  blockedBy: [],
} as const;

describe("refinementTicketsSubmissionSchema", () => {
  it.each([
    ["critérios de aceite", { ...ticket, acceptanceCriteria: ["Duplicado", "Duplicado"] }],
    ["dependências", { ...ticket, blockedBy: ["ticket-0", "ticket-0"] }],
  ] as const)("should reject duplicate %s", (_label, candidate) => {
    expect(refinementTicketsSubmissionSchema.safeParse({ tickets: [candidate] }).success)
      .toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk pnpm exec vitest run packages/agent-runtime/src/codex/protocol.test.ts
```

Expected: both cases FAIL because the current arrays allow duplicates.

- [ ] **Step 3: Add minimum boundary validation**

Keep an unrefined input schema for JSON Schema generation and refine the exported runtime schema:

```ts
const ticketListEntrySchema = z.string().min(1);
const acceptanceCriteriaInputSchema = z.array(ticketListEntrySchema).min(1).describe(
  "Critérios de aceite sem entradas repetidas.",
);
const blockedByInputSchema = z.array(ticketListEntrySchema).describe(
  "IDs de Tickets bloqueadores sem entradas repetidas.",
);

const refinementTicketSubmissionInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: acceptanceCriteriaInputSchema,
  specUrl: z.string().url(),
  blockedBy: blockedByInputSchema,
});

export const refinementTicketSubmissionSchema = refinementTicketSubmissionInputSchema.extend({
  acceptanceCriteria: acceptanceCriteriaInputSchema.refine(
    (entries) => new Set(entries).size === entries.length,
    { message: "os critérios de aceite não podem se repetir" },
  ),
  blockedBy: blockedByInputSchema.refine(
    (entries) => new Set(entries).size === entries.length,
    { message: "as dependências não podem se repetir" },
  ),
});

const refinementTicketsSubmissionInputSchema = z.object({
  tickets: z.array(refinementTicketSubmissionInputSchema).min(1),
});

export const refinementTicketsSubmissionSchema = z.object({
  tickets: z.array(refinementTicketSubmissionSchema).min(1),
});
```

Build `refinementTicketsSubmissionToolSpec.inputSchema` from `refinementTicketsSubmissionInputSchema` so Zod can still generate JSON Schema. Preserve the exported refined schema for runtime parsing and inferred public types.

- [ ] **Step 4: Verify Task 2**

Run:

```bash
rtk pnpm exec vitest run packages/agent-runtime/src/codex/protocol.test.ts packages/agent-runtime/src/runtime.test.ts
rtk pnpm check
```

Expected: focused tests, runtime transport tests, and the full check PASS with no new warnings.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/agent-runtime/src/codex/protocol.ts packages/agent-runtime/src/codex/protocol.test.ts
git commit -m "fix(agent-runtime): reject duplicate ticket entries"
```

### Task 3: Derive Picker filtering directly

**Files:**
- Modify: `apps/web/src/components/picker.tsx:5-63`
- Test: `apps/web/src/components/picker.test.tsx`

**Interfaces:**
- Consumes: existing `filterPickerStories(stories, query, filter)` public function.
- Produces: unchanged Picker rendering and filtering behavior without speculative memoization.

- [ ] **Step 1: Confirm existing public regression coverage**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/picker.test.tsx
```

Expected: PASS, covering title/status filtering, rendered next actions, and the empty filtered state.

- [ ] **Step 2: Remove speculative memoization**

Remove `useMemo` from the React import and derive the list directly:

```tsx
import { useState } from "react";

const visibleStories = filterPickerStories(stories, query, filter);
```

Do not add a source-inspection test; that would couple the test to implementation rather than Picker behavior.

- [ ] **Step 3: Verify Task 3**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/picker.test.tsx
rtk pnpm check
```

Expected: Picker tests and the full check PASS with no new warnings.

- [ ] **Step 4: Commit Task 3**

```bash
git add apps/web/src/components/picker.tsx
git commit -m "refactor(web): derive picker filtering directly"
```
