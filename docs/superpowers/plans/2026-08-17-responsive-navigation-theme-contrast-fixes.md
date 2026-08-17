# Responsive Navigation and Theme Contrast Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Palco and Dossiê navigation available across responsive viewport changes and make Picker status badges honor the explicitly selected theme.

**Architecture:** Add one client-side `ResponsiveDetails` primitive that leaves the server-rendered disclosure open, remembers the native mobile state, and forces it open at Tailwind's existing `lg` breakpoint. Reuse the existing explicit-theme semantic colors for warning and success badge text instead of OS-media-driven `dark:` variants.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16 App Router, Happy DOM 20, Vitest 4, Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-08-17-responsive-navigation-theme-contrast-fixes-design.md`

## Global Constraints

- Do not change ceremony state, persistence, server actions, or Azure DevOps behavior.
- Do not add dependencies or duplicate the mobile and desktop navigation trees.
- Preserve native keyboard interaction and an open server-rendered default.
- Keep the explicit Light, Dark, and System theme contract intact.
- Work in vertical TDD slices: one failing public behavior test, the minimum implementation, then a focused green run.

---

### Task 1: Responsive Palco decision rail

**Files:**
- Create: `apps/web/src/components/ui/responsive-details.tsx`
- Modify: `apps/web/src/components/ui/index.ts`
- Modify: `apps/web/src/app/cerimonia/[sessionId]/palco-rail.tsx:44-103`
- Test: `apps/web/src/app/cerimonia/[sessionId]/palco.test.tsx`

**Interfaces:**
- Consumes: native `<details>`/`<summary>` behavior and Tailwind's `lg` breakpoint at `(min-width: 64rem)`.
- Produces: `ResponsiveDetails({ summary, children, className?, summaryClassName? }): ReactElement`, with open SSR markup, remembered mobile state, and forced-open desktop state.

- [ ] **Step 1: Write the failing Palco behavior test**

Make `palco.test.tsx` a Happy DOM test and add the client-rendering imports:

```tsx
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
```

Set React's test environment once after imports:

```tsx
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
```

Add this test through the public `PalcoView` seam:

```tsx
it("should reopen the decision rail on desktop and restore its collapsed mobile state", async () => {
  const serverHtml = renderToStaticMarkup(<PalcoView state={stoppedSpecReview} connected />);
  expect(serverHtml).toMatch(/<details[^>]*open/);

  window.happyDOM.setViewport({ width: 768, height: 1024 });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(<PalcoView state={stoppedSpecReview} connected />));
    const details = container.querySelector("details");
    const summary = details?.querySelector("summary");
    if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) {
      throw new Error("expected the Palco decision rail disclosure");
    }

    await act(async () => summary.click());
    expect(details.open).toBe(false);

    await act(async () => window.happyDOM.setViewport({ width: 1280, height: 800 }));
    expect(details.open).toBe(true);

    await act(async () => window.happyDOM.setViewport({ width: 768, height: 1024 }));
    expect(details.open).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.happyDOM.setViewport({ width: 1024, height: 768 });
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/palco.test.tsx'
```

Expected: FAIL after the mobile disclosure is collapsed because changing to the desktop viewport does not reopen it.

- [ ] **Step 3: Add the minimum shared responsive disclosure**

Create `apps/web/src/components/ui/responsive-details.tsx`:

```tsx
"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

const DESKTOP_NAVIGATION_QUERY = "(min-width: 64rem)";

export function ResponsiveDetails({
  summary,
  children,
  className,
  summaryClassName,
}: {
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly summaryClassName?: string;
}): ReactElement {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (details === null) return;

    const desktop = window.matchMedia(DESKTOP_NAVIGATION_QUERY);
    let mobileOpen = details.open;

    function rememberMobileState(): void {
      if (!desktop.matches) mobileOpen = details.open;
    }

    function synchronizeViewport(): void {
      details.open = desktop.matches || mobileOpen;
    }

    details.addEventListener("toggle", rememberMobileState);
    desktop.addEventListener("change", synchronizeViewport);
    synchronizeViewport();

    return () => {
      details.removeEventListener("toggle", rememberMobileState);
      desktop.removeEventListener("change", synchronizeViewport);
    };
  }, []);

  return (
    <details ref={detailsRef} open className={className}>
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
}
```

Export it from `apps/web/src/components/ui/index.ts`:

```ts
export { ResponsiveDetails } from "./responsive-details";
```

In `palco-rail.tsx`, import the primitive:

```tsx
import { ResponsiveDetails } from "../../../components/ui";
```

Replace only the existing `<details>` and `<summary>` wrapper. Apply this exact structural diff so the existing rail `<div>` and all of its children remain unchanged:

```diff
-      <details className="group lg:contents" open>
-        <summary className="cursor-pointer list-none px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted marker:hidden lg:hidden">Trilho e histórico · {state.decisions.length} resoluções</summary>
+      <ResponsiveDetails
+        className="group lg:contents"
+        summary={`Trilho e histórico · ${state.decisions.length} resoluções`}
+        summaryClassName="cursor-pointer list-none px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted marker:hidden lg:hidden"
+      >
         <div className="flex min-h-0 flex-col gap-5 px-4 pb-6 sm:px-6 sm:pb-7 lg:sticky lg:top-0 lg:min-h-dvh lg:px-6 lg:py-7">
@@
         </div>
-      </details>
+      </ResponsiveDetails>
```

- [ ] **Step 4: Re-run the Palco test and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/palco.test.tsx'
```

Expected: all Palco tests PASS; the new test observes open SSR markup, desktop reopening, and restoration of the collapsed mobile state.

- [ ] **Step 5: Commit the Palco slice**

```bash
rtk git add apps/web/src/components/ui/responsive-details.tsx apps/web/src/components/ui/index.ts 'apps/web/src/app/cerimonia/[sessionId]/palco-rail.tsx' 'apps/web/src/app/cerimonia/[sessionId]/palco.test.tsx'
rtk git commit -m "fix(web): preserve responsive palco rail"
```

---

### Task 2: Responsive Dossiê navigation

**Files:**
- Modify: `apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.tsx:75-86`
- Test: `apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx`

**Interfaces:**
- Consumes: `ResponsiveDetails` from Task 1 and the existing `DossieView({ state, connected })` public seam.
- Produces: Dossiê navigation with the same open SSR and bidirectional responsive-state contract as Palco.

- [ ] **Step 1: Write the failing Dossiê behavior test**

Add this test to the existing Happy DOM `dossie.test.tsx` suite:

```tsx
it("should reopen navigation on desktop and restore its collapsed mobile state", async () => {
  const serverHtml = renderToStaticMarkup(<DossieView state={DOSSIE_STATE} connected />);
  expect(serverHtml).toMatch(/<details[^>]*open/);

  window.happyDOM.setViewport({ width: 768, height: 1024 });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(<DossieView state={DOSSIE_STATE} connected />));
    const details = container.querySelector("details");
    const summary = details?.querySelector("summary");
    if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) {
      throw new Error("expected the Dossiê navigation disclosure");
    }

    await act(async () => summary.click());
    expect(details.open).toBe(false);

    await act(async () => window.happyDOM.setViewport({ width: 1280, height: 800 }));
    expect(details.open).toBe(true);

    await act(async () => window.happyDOM.setViewport({ width: 768, height: 1024 }));
    expect(details.open).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.happyDOM.setViewport({ width: 1024, height: 768 });
  }
});
```

- [ ] **Step 2: Run the focused Dossiê test and verify RED**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
```

Expected: FAIL after the disclosure is collapsed because the current Dossiê `<details>` has no viewport synchronization.

- [ ] **Step 3: Move Dossiê to the shared primitive**

Add `ResponsiveDetails` to the existing UI import in `dossie.tsx`, then replace the native wrapper while leaving the `<nav>` unchanged:

```tsx
<ResponsiveDetails
  className="lg:contents"
  summary="Navegação do Dossiê"
  summaryClassName="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.18em] text-muted lg:hidden"
>
  <nav aria-label="Navegação do Dossiê" className="mt-4 flex flex-col gap-2 lg:mt-0">
    {navigation.map((item) => (
      <a key={item.href} href={item.href} className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">{item.label}</a>
    ))}
  </nav>
</ResponsiveDetails>
```

- [ ] **Step 4: Re-run the Dossiê test and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
```

Expected: every Dossiê test PASS, including open SSR markup and both viewport transitions.

- [ ] **Step 5: Commit the Dossiê slice**

```bash
rtk git add 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.tsx' 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
rtk git commit -m "fix(web): preserve responsive dossie navigation"
```

---

### Task 3: Explicit-theme status badge colors

**Files:**
- Modify: `apps/web/src/components/ui/accent-foreground.test.tsx`
- Modify: `apps/web/src/components/ui/status-badge.tsx:4-11`

**Interfaces:**
- Consumes: `StatusBadge({ tone, children })`, explicit light/dark declarations in `globals.css`, and the existing `text-investigated`/`text-refined` Tailwind semantic utilities.
- Produces: warning and success badge text whose colors track `data-theme` independently of the OS preference.

- [ ] **Step 1: Write the failing explicit-theme contract**

Add `StatusBadge` to the existing imports in `accent-foreground.test.tsx`:

```tsx
import { Button } from "./button";
import { StatusBadge } from "./status-badge";
import { StepProgress } from "./step-progress";
```

Add this behavior test, reusing the file's existing `css`, `blockAfter`, and `declarationsIn` helpers:

```tsx
it("should bind status badge text to explicit-theme semantic colors", () => {
  const lightPalette = declarationsIn(blockAfter(css, ':root[data-theme="light"]'));
  const darkPalette = declarationsIn(blockAfter(css, ':root[data-theme="dark"]'));
  const warning = renderToStaticMarkup(<StatusBadge tone="warning">Investigada</StatusBadge>);
  const success = renderToStaticMarkup(<StatusBadge tone="success">Refinada</StatusBadge>);

  expect({
    lightInvestigated: lightPalette["--investigated"],
    darkInvestigated: darkPalette["--investigated"],
    lightRefined: lightPalette["--refined"],
    darkRefined: darkPalette["--refined"],
    warningUsesSemanticColor: warning.includes("text-investigated"),
    successUsesSemanticColor: success.includes("text-refined"),
    statusColorsIgnoreOsDarkVariant: !warning.includes("dark:") && !success.includes("dark:"),
  }).toEqual({
    lightInvestigated: "#8A5A00",
    darkInvestigated: "#E5B55E",
    lightRefined: "#177245",
    darkRefined: "#79D09D",
    warningUsesSemanticColor: true,
    successUsesSemanticColor: true,
    statusColorsIgnoreOsDarkVariant: true,
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/ui/accent-foreground.test.tsx
```

Expected: FAIL because warning and success currently render `dark:` classes and do not use the explicit-theme semantic utilities.

- [ ] **Step 3: Reuse the existing semantic color utilities**

Change only the two production tones in `status-badge.tsx`:

```ts
const TONE_CLASSES = {
  neutral: "border-line bg-foreground/[0.04] text-muted",
  info: "border-accent/40 bg-accent/10 text-accent",
  success: "border-emerald-700/40 bg-emerald-700/10 text-refined",
  warning: "border-amber-700/40 bg-amber-700/10 text-investigated",
  danger: "border-red-700/40 bg-red-700/10 text-red-700 dark:text-red-300",
} as const satisfies Record<StatusBadgeTone, string>;
```

Do not add new color variables or alter the unused danger tone.

- [ ] **Step 4: Re-run the focused test and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/ui/accent-foreground.test.tsx
```

Expected: all accent/theme tests PASS.

- [ ] **Step 5: Commit the badge slice**

```bash
rtk git add apps/web/src/components/ui/accent-foreground.test.tsx apps/web/src/components/ui/status-badge.tsx
rtk git commit -m "fix(web): honor explicit theme in status badges"
```

---

### Task 4: Full verification

**Files:**
- Verify all files changed in Tasks 1–3.
- Temporarily create and then delete: `.context/review-build-config.json`.

**Interfaces:**
- Consumes: the completed responsive-disclosure and semantic-color slices.
- Produces: a clean branch whose focused tests, repository checks, production build, and diff hygiene all pass.

- [ ] **Step 1: Run the focused behavior suites together**

```bash
rtk pnpm exec vitest run \
  'apps/web/src/app/cerimonia/[sessionId]/palco.test.tsx' \
  'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx' \
  apps/web/src/components/ui/accent-foreground.test.tsx
```

Expected: all focused suites PASS.

- [ ] **Step 2: Run the complete repository check**

```bash
rtk pnpm check
```

Expected: typecheck, lint, and every Vitest suite PASS.

- [ ] **Step 3: Create a temporary valid local build configuration**

Use `apply_patch` to create `.context/review-build-config.json` with this exact content:

```json
{
  "azureDevOps": {
    "organization": "review",
    "project": "review"
  },
  "repos": {
    "primary": {
      "name": "sprint-griller",
      "path": "/Users/lucasborges/conductor/workspaces/sprint-griller/belgrade"
    },
    "related": []
  }
}
```

- [ ] **Step 4: Run the production build and diff check**

```bash
SPRINT_GRILLER_CONFIG=/Users/lucasborges/conductor/workspaces/sprint-griller/belgrade/.context/review-build-config.json \
AZURE_DEVOPS_PAT=review-placeholder \
rtk pnpm build
rtk git diff --check origin/master...HEAD
```

Expected: the Next.js production build and whitespace check PASS.

- [ ] **Step 5: Remove the temporary configuration and inspect scope**

Use `apply_patch` to delete `.context/review-build-config.json`, then run:

```bash
rtk git status --short --branch
rtk git diff --stat origin/master...HEAD
rtk git log --oneline origin/master..HEAD
```

Expected: the temporary file is gone; only the approved design, plan, tests, and implementation files differ from `origin/master`; the worktree is clean.
