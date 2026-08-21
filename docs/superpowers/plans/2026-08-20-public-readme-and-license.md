# Public README and MIT License Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a visual, sanitized Portuguese README for Refina with real demo screenshots and an MIT license.

**Architecture:** Keep production behavior unchanged. Improve only deterministic development fixtures, capture them from the existing `/dev-ui` route, store documentation assets under `docs/assets/readme/`, and preserve the current technical README below a new visual overview.

**Tech Stack:** Markdown, SVG, Next.js development gallery, Vitest, Browser screenshot tooling, macOS `sips`, `xmllint`.

**Spec:** `docs/superpowers/specs/2026-08-20-public-readme-and-license-design.md`

## Global Constraints

- All visible demo data must be fictitious: project `Projeto Exemplo`, `example.com` URLs, generic repository names, and no identifiable person.
- Screenshots use the light theme, a fixed 1440×1000 viewport, and full-page capture.
- Do not access ignored local configuration or credentials and do not rewrite Git history.
- Preserve Azure DevOps and Codex references that explain the product.
- Add no dependency, do not publish to npm, and keep `package.json` private.
- The MIT attribution is exactly `Copyright (c) 2026 Refina contributors`.

---

### Task 1: Sanitize the tracked repository

**Files:**
- Modify: `CONTEXT.md`
- Modify: tracked Markdown under `.scratch/`
- Modify: `docs/superpowers/plans/2026-08-17-responsive-navigation-theme-contrast-fixes.md`
- Move locally: `.superpowers/brainstorm/` to an ignored archive under `.context/`

- [ ] Record the current tracked and untracked status.
- [ ] Run a tracked-only scan for personal names, personal home paths, e-mail addresses, domains, and organization-like values; do not inspect ignored configuration.
- [ ] Replace personal names with `Operador`, references to a personal squad with `squad piloto`, and absolute home/workspace paths with explicit generic placeholders such as `/path/to/...`.
- [ ] Preserve generic fixtures, technical vendors, and conceptual uses of “cliente”.
- [ ] Repeat the tracked-only scan and manually inspect remaining matches.
- [ ] Verify with `git diff --check`.
- [ ] Commit as `chore: sanitize public repository content`.

### Task 2: Make the development gallery representative

**Files:**
- Modify: `apps/web/src/app/__dev/ui/gallery.test.tsx`
- Modify: `apps/web/src/app/__dev/ui/fixtures.ts`
- Modify: `apps/web/src/app/__dev/ui/gallery.tsx`

- [ ] Update the gallery test first so it requires: three Picker stories spanning `sem-investigacao`, `investigada`, and `refinada`; an active Palco question with a recommendation and decision action; and a published Dossiê with a fixed 2026 resolution date.
- [ ] Run `pnpm test apps/web/src/app/__dev/ui/gallery.test.tsx` and confirm the new assertions fail for missing representative fixture content.
- [ ] Expand `PICKER_STORIES` with three generic stories and no assigned person, pass `Projeto Exemplo` to the Picker, make `PALCO_STATE.current` a live `perguntando` state with generic options/evidence, and set `DECISION.decidedAt` to a deterministic 2026 timestamp.
- [ ] Keep the exports checked with `as const satisfies` against their existing public types; do not change production components or schemas.
- [ ] Re-run the focused test and confirm it passes, then run the web typecheck.
- [ ] Commit as `test(web): improve public demo fixtures`.

### Task 3: Add documentation assets, visual README, and MIT license

**Files:**
- Create: `LICENSE`
- Create: `docs/assets/readme/workflow.svg`
- Create: `docs/assets/readme/picker.png`
- Create: `docs/assets/readme/palco.png`
- Create: `docs/assets/readme/dossie.png`
- Modify: `README.md`

- [ ] Add the standard MIT text with the exact approved attribution.
- [ ] Create a transparent, responsive SVG showing `Investigar → Refinar → Revisar → Publicar`, with a `<title>` and colors that remain readable under GitHub light and dark themes.
- [ ] Start the development gallery with a fictitious config in `.context/` and a placeholder PAT, without reading the ignored real config; use a dedicated local port.
- [ ] In Browser, select theme `Claro`, set viewport 1440×1000, and full-page capture `/dev-ui?view=picker`, `palco`, and `dossie` into the exact PNG paths above; reset the viewport and stop the server afterward.
- [ ] If Next changes `apps/web/next-env.d.ts`, restore only the exact generated `.next/dev/types` import change after confirming it was absent from the initial status.
- [ ] Rework the README top into title/badges, short pitch, “Por que existe”, “Como funciona”, and “O produto em três momentos”; give each image a descriptive Portuguese alt text and caption, then retain the existing setup, commands, architecture, and operational detail.
- [ ] Add a final `## Licença` section linking to `LICENSE`.
- [ ] Validate assets with `xmllint --noout`, `file`, and `sips`; inspect the three screenshots visually and scan PNG strings/metadata for identifying data.
- [ ] Confirm every README-local link and asset exists, then run `pnpm check`, tracked-only sanitization scans, `git diff --check`, `git status`, and `git diff origin/master...`.
- [ ] Commit as `docs: add visual project overview and MIT license`.
