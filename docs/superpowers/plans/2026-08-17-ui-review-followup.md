# UI Review Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four reviewed UI and validation regressions through public behavior tests without changing the persisted Refina workflow.

**Architecture:** Keep existing controllers and presentation seams. Inject the existing investigation start action as an optional view capability, pass Dossiê action state into the reusable confirmation dialog, enrich Picker accessible names at render time, and enforce ticket identity at the exported Zod boundary.

**Tech Stack:** TypeScript, React 19, Next.js 16, Zod 4, Vitest, happy-dom, `react-dom/server`

**Spec:** `docs/superpowers/specs/2026-08-17-ui-review-followup-design.md`

## Global Constraints

- Preserve the existing Picker action union and visible labels.
- Preserve investigation, ceremony, and Azure DevOps persistence behavior.
- Keep the rejected development fixture inert; it must not expose a retry form.
- Parse duplicate ticket identity at the exported runtime schema before persistence.
- Add no dependency and no fixture-specific production branch.
- Work one vertical red-green slice at a time; do not refactor outside the reviewed paths.

---

### Task 1: Restore investigation redispatch

**Files:**
- Modify: `apps/web/src/app/investigacao/[storyId]/investigation-view.test.tsx`
- Modify: `apps/web/src/app/investigacao/[storyId]/investigation-view.tsx:31-177`
- Modify: `apps/web/src/app/investigacao/[storyId]/page.tsx:1-34`

**Interfaces:**
- Consumes: existing `startInvestigationAction(formData: FormData): Promise<void>` and `InvestigationViewActions`.
- Produces: optional `InvestigationViewActions.retryInvestigation` capability and a failed/rejected redispatch form that submits `storyId`.

- [ ] **Step 1: Write the failing public-view test**

Add a failed run fixture and a table test beside the existing inert-fixture test:

```tsx
const failedRun = {
  storyId: 117,
  story: rejectedRun.story,
  startedAt: 1,
  finishedAt: 2,
  previous: undefined,
  publication: undefined,
  status: "falhou",
  message: "O agente caiu.",
} as const satisfies InvestigationRun;

it.each([
  ["falhou", failedRun],
  ["reprovado", rejectedRun],
] as const)("should expose redispatch after an investigation is %s", (_status, run) => {
  const html = renderToStaticMarkup(
    <InvestigationView
      model={{ storyId: 117, run, openCeremonyId: undefined }}
      actions={{
        startCeremony: inertAction,
        publishInvestigation: inertAction,
        retryInvestigation: inertAction,
      }}
    />,
  );

  expect({
    retry: html.includes("Investigar novamente"),
    storyId: html.includes('name="storyId" value="117"'),
  }).toEqual({ retry: true, storyId: true });
});
```

Extend the existing rejected fixture assertion with `hasNoRetry: !html.includes("Investigar novamente")` so omitting the optional capability continues to prove that the development-style view exposes no write control.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/investigacao/[storyId]/investigation-view.test.tsx'
```

Expected: FAIL at TypeScript transform or rendering because `retryInvestigation` is not part of `InvestigationViewActions` and no retry form exists.

- [ ] **Step 3: Add the minimum optional capability**

Extend the public action interface and pass the capability into `Outcome`:

```tsx
export interface InvestigationViewActions {
  readonly startCeremony: InvestigationFormAction;
  readonly publishInvestigation: InvestigationFormAction;
  readonly retryInvestigation?: InvestigationFormAction;
}

<Outcome
  run={run}
  publishAction={actions.publishInvestigation}
  retryAction={actions.retryInvestigation}
/>
```

Add one internal form and render it after failed and rejected results only when supplied:

```tsx
function RetryInvestigation({ storyId, action }: {
  readonly storyId: number;
  readonly action: InvestigationFormAction | undefined;
}) {
  if (action === undefined) return null;
  return (
    <form action={action}>
      <input type="hidden" name="storyId" value={storyId} />
      <Button type="submit" variant="secondary">Investigar novamente</Button>
    </form>
  );
}
```

For `falhou`, render it after the failure alert; for the report branch, render it only when `run.status === "reprovado"`. Import and inject the existing action in the production page:

```tsx
import { publishInvestigationAction, startInvestigationAction } from "../actions";

actions={{
  startCeremony: startCeremonyAction,
  publishInvestigation: publishInvestigationAction,
  retryInvestigation: startInvestigationAction,
}}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: both redispatch cases and the inert fixture case PASS.

- [ ] **Step 5: Commit Task 1**

```bash
rtk git add 'apps/web/src/app/investigacao/[storyId]/investigation-view.test.tsx' 'apps/web/src/app/investigacao/[storyId]/investigation-view.tsx' 'apps/web/src/app/investigacao/[storyId]/page.tsx'
rtk git commit -m "fix(web): restore investigation redispatch"
```

### Task 2: Keep Dossiê confirmation state inside the modal

**Files:**
- Modify: `apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx`
- Modify: `apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.tsx:371-387`
- Modify: `apps/web/src/components/ui/confirm-action.tsx:6-59`

**Interfaces:**
- Consumes: `ReopenForm`'s existing `useActionState(reopenRefinementAction, null)` result.
- Produces: `ConfirmAction` props `pending?: boolean` and `error?: string | null`, with modal-local error presentation and pending prevention.

- [ ] **Step 1: Write the failing reopen-error test**

Add a Dossiê interaction test using the existing mocked boundary:

```tsx
it("should announce a failed reopen inside the open confirmation dialog", async () => {
  vi.mocked(reopenRefinementAction).mockResolvedValue("A revisão mudou; recarregue o Dossiê.");
  const state = {
    ...DOSSIE_STATE,
    refinement: { ...DOSSIE_STATE.refinement, phase: "revisando-tickets" as const },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(<DossieView state={state} connected />));
    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Reabrir Refinamento",
    );
    if (openButton === undefined) throw new Error("expected the reopen trigger");
    await act(async () => openButton.click());

    const dialog = container.querySelector("dialog");
    const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Confirmar reabertura",
    );
    if (!(dialog instanceof HTMLDialogElement) || confirmButton === undefined) {
      throw new Error("expected the reopen dialog");
    }
    await act(async () => confirmButton.click());

    expect({
      open: dialog.open,
      alert: dialog.querySelector('[role="alert"]')?.textContent,
    }).toEqual({ open: true, alert: "A revisão mudou; recarregue o Dossiê." });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.mocked(reopenRefinementAction).mockReset();
  }
});
```

- [ ] **Step 2: Run the focused Dossiê test and verify RED**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
```

Expected: FAIL because the dialog contains no alert; the error is rendered outside it.

- [ ] **Step 3: Render the action error inside `ConfirmAction`**

Add props and modal-local state rendering:

```tsx
export function ConfirmAction({
  triggerLabel,
  title,
  description,
  confirmLabel,
  action,
  triggerProps,
  children,
  error,
}: {
  readonly triggerLabel: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly action: (formData: FormData) => void | Promise<void>;
  readonly triggerProps?: Omit<ButtonProps, "children" | "type">;
  readonly children?: ReactNode;
  readonly error?: string | null;
}) {
```

Inside the dialog, before the button row:

```tsx
{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
```

Pass the state from `ReopenForm`, and remove the now-inaccessible external alert:

```tsx
<ConfirmAction
  triggerLabel="Reabrir Refinamento"
  title="Reabrir Refinamento"
  description="As aprovações atuais serão invalidadas. O histórico e os rascunhos permanecem preservados."
  confirmLabel={pending ? "Reabrindo…" : "Confirmar reabertura"}
  action={reopen}
  triggerProps={{ variant: "quiet", disabled: pending }}
  error={error}
>
```

- [ ] **Step 4: Re-run the focused Dossiê test and verify GREEN**

Run the same focused command. Expected: the failure is inside the open dialog and all Dossiê tests PASS.

- [ ] **Step 5: Write the failing Dossiê pending-state test**

Add a second interaction test through `DossieView`:

```tsx
it("should disable destructive confirmation while reopen is pending", async () => {
  let finish: ((result: string | null) => void) | undefined;
  vi.mocked(reopenRefinementAction).mockImplementation(
    () => new Promise((resolve) => { finish = resolve; }),
  );
  const state = {
    ...DOSSIE_STATE,
    refinement: { ...DOSSIE_STATE.refinement, phase: "revisando-tickets" as const },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(<DossieView state={state} connected />));
    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Reabrir Refinamento",
    );
    if (openButton === undefined) throw new Error("expected the reopen trigger");
    await act(async () => openButton.click());

    const dialog = container.querySelector("dialog");
    const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Confirmar reabertura",
    );
    if (confirmButton === undefined) throw new Error("expected the confirm button");
    act(() => confirmButton.click());

    await vi.waitFor(() => expect({
      disabled: confirmButton.disabled,
      busy: confirmButton.getAttribute("aria-busy"),
    }).toEqual({ disabled: true, busy: "true" }));
  } finally {
    await act(async () => finish?.(null));
    await act(async () => root.unmount());
    container.remove();
    vi.mocked(reopenRefinementAction).mockReset();
  }
});
```

- [ ] **Step 6: Run the pending-state test and verify RED**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
```

Expected: FAIL because `pending` is unsupported and the confirm button is enabled.

- [ ] **Step 7: Add the minimum pending behavior**

Add `pending = false` and `readonly pending?: boolean` to `ConfirmAction`, hide the previous error while pending, and disable and mark the destructive submit button:

```tsx
{!pending && error && <p role="alert" className="text-sm text-red-600">{error}</p>}

<Button type="submit" variant="danger" disabled={pending} aria-busy={pending}>
  {confirmLabel}
</Button>
```

Pass `pending={pending}` from `ReopenForm`.

- [ ] **Step 8: Verify the Task 2 suite GREEN**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
```

Expected: the full Dossiê suite PASS.

- [ ] **Step 9: Commit Task 2**

```bash
rtk git add 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx' 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.tsx' apps/web/src/components/ui/confirm-action.tsx
rtk git commit -m "fix(web): surface confirmation errors"
```

### Task 3: Give Picker actions story-specific accessible names

**Files:**
- Modify: `apps/web/src/components/picker.test.tsx`
- Modify: `apps/web/src/components/picker.tsx:194-210`

**Interfaces:**
- Consumes: existing `PickerStory` and visible `PickerAction.label`.
- Produces: accessible names in the form `<action> — US #<id>: <title>` for both start and open actions.

- [ ] **Step 1: Write the failing rendered-accessibility test**

Add:

```tsx
it("should distinguish action targets by User Story", () => {
  const html = renderToStaticMarkup(
    <Picker
      iterationName="Sprint 42"
      stories={stories}
      project="Plataforma"
      repos={{ primary: { name: "api", path: "/tmp/api" }, related: [] }}
      startAction={() => undefined}
    />,
  );

  expect({
    start: html.includes('aria-label="Investigar — US #101: Exportar relatório"'),
    open: html.includes('aria-label="Acompanhar execução — US #102: Calcular parcelas"'),
  }).toEqual({ start: true, open: true });
});
```

- [ ] **Step 2: Run the focused Picker test and verify RED**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/picker.test.tsx
```

Expected: FAIL because neither action has an `aria-label`.

- [ ] **Step 3: Add one shared accessible-name derivation**

Inside `StoryAction`, derive the label once:

```tsx
const accessibleLabel = `${story.action.label} — US #${story.id}: ${story.title}`;
```

Pass `aria-label={accessibleLabel}` to both the `Button` and `Link`. Do not change visible labels or the action union.

- [ ] **Step 4: Re-run the focused Picker test and verify GREEN**

Run the same command. Expected: all Picker tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
rtk git add apps/web/src/components/picker.test.tsx apps/web/src/components/picker.tsx
rtk git commit -m "fix(web): label picker actions by story"
```

### Task 4: Reject duplicate ticket identifiers

**Files:**
- Modify: `packages/agent-runtime/src/codex/protocol.test.ts`
- Modify: `packages/agent-runtime/src/codex/protocol.ts:347-353`

**Interfaces:**
- Consumes: exported `refinementTicketsSubmissionSchema` and unchanged `RefinementTicketSubmission` shape.
- Produces: runtime rejection with an issue at the repeated ticket's `id`; inferred public types and JSON tool fields stay unchanged.

- [ ] **Step 1: Write the failing exported-boundary test**

Add:

```ts
it("should reject duplicate ticket ids", () => {
  const parsed = refinementTicketsSubmissionSchema.safeParse({
    tickets: [
      ticket,
      { ...ticket, title: "Validar exportação" },
    ],
  });

  expect(parsed.success).toBe(false);
});
```

The second title is intentionally unique so the test isolates duplicate identity.

- [ ] **Step 2: Run the focused protocol test and verify RED**

Run:

```bash
rtk pnpm exec vitest run packages/agent-runtime/src/codex/protocol.test.ts
```

Expected: FAIL because the current object schema accepts both tickets.

- [ ] **Step 3: Refine the runtime ticket array**

Extract the runtime array and report the repeated identifier at its boundary path:

```ts
const refinementTicketSubmissionsSchema = z
  .array(refinementTicketSubmissionSchema)
  .min(1)
  .superRefine((tickets, ctx) => {
    const ids = new Set<string>();
    for (const [index, ticket] of tickets.entries()) {
      if (ids.has(ticket.id)) {
        ctx.addIssue({
          code: "custom",
          message: `id de Ticket duplicado: ${ticket.id}`,
          path: [index, "id"],
        });
      }
      ids.add(ticket.id);
    }
  });

export const refinementTicketsSubmissionSchema = z.object({
  tickets: refinementTicketSubmissionsSchema,
});
```

Keep `refinementTicketsSubmissionInputSchema` unchanged for JSON Schema generation; runtime parsing remains the trust boundary.

- [ ] **Step 4: Re-run the focused protocol test and verify GREEN**

Run the same focused command. Expected: duplicate list entries and duplicate ticket IDs are all rejected.

- [ ] **Step 5: Commit Task 4**

```bash
rtk git add packages/agent-runtime/src/codex/protocol.test.ts packages/agent-runtime/src/codex/protocol.ts
rtk git commit -m "fix(agent-runtime): reject duplicate ticket ids"
```

### Task 5: Final verification

**Files:**
- Verify: all files changed by Tasks 1-4

**Interfaces:**
- Consumes: the four completed public contracts.
- Produces: evidence that focused behavior, repository checks, and production compilation all pass.

- [ ] **Step 1: Run all focused regression suites**

```bash
rtk pnpm exec vitest run 'apps/web/src/app/investigacao/[storyId]/investigation-view.test.tsx' 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx' apps/web/src/components/ui/ui.test.tsx apps/web/src/components/picker.test.tsx packages/agent-runtime/src/codex/protocol.test.ts
```

Expected: all focused test files PASS.

- [ ] **Step 2: Run the complete repository check**

```bash
rtk pnpm check
```

Expected: typecheck, lint, and the complete test suite PASS.

- [ ] **Step 3: Run the production build with a valid local review config**

```bash
SPRINT_GRILLER_CONFIG="$PWD/.context/review-config.json" rtk pnpm build
```

Expected: Next.js production build exits 0.

- [ ] **Step 4: Inspect the final diff**

```bash
rtk git diff --check origin/master...HEAD
rtk git status --short
```

Expected: no whitespace errors; only intentional plan or implementation files are present.
