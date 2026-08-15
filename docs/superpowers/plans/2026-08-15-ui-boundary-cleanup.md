# UI Boundary Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the four reviewed UI-boundary regressions while preserving Refina's workflow and Azure DevOps behavior.

**Architecture:** Keep domain and persistence models canonical on the server, derive only the presentation data each client view consumes, and render development fixtures through the same pure production views. Replace the local Markdown dialect with a configured standards parser and represent workflow completion explicitly instead of encoding it as a clamped index.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16 App Router, Vitest 4, `markdown-it` 14, Zod 4, Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-08-15-ui-boundary-cleanup-design.md`

## Global Constraints

- Do not change ceremony persistence, Azure DevOps writes, or refinement workflow transitions.
- Raw HTML in Markdown stays inert; only exact `<!-- sprint-griller:* -->` structural comments disappear.
- Only `http:` and `https:` Markdown links are active, with `target="_blank"` and `rel="noreferrer"`.
- Markdown images never emit `<img>` and therefore never create browser requests.
- Development fixtures remain unavailable outside `NODE_ENV=development` and perform no external work.
- Use the domain vocabulary in `CONTEXT.md`: Picker, Investigação, Palco, Dossiê, Fase do refinamento, and Refinamento coletivo.
- Follow red → green vertically: one public behavior test, observed failure, minimum implementation, observed pass, then commit.

---

### Task 1: Standards-based safe Markdown preview

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/components/ui/markdown-preview.tsx`
- Test: `apps/web/src/components/ui/markdown-preview.test.tsx`

**Interfaces:**
- Consumes: `MarkdownPreview({ markdown: string }): ReactElement` as used by Investigação and Dossiê.
- Produces: the same React component interface, now backed by `markdown-it` and the security policy from the spec.

- [ ] **Step 1: Replace the subset-only test with a canonical safe-document contract**

Add a single worked example whose expected values come from Markdown semantics and the security policy, not from the parser implementation:

```tsx
it("should render canonical markdown without exposing structural or active unsafe content", () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview
      markdown={`<!-- sprint-griller:report-section:impacts -->

> Relatório reprovado

- Impacto
  - \`core-api:src/cache.ts\`

\`\`\`ts
const ttl = 300;
\`\`\`

[Spec](https://example.com/spec)

[perigoso](javascript:alert(1))

![pixel](https://tracker.example/pixel.gif)

<em>HTML arbitrário</em>`}
    />,
  );

  expect({
    hidesStructuralComment: !html.includes("sprint-griller:report-section"),
    rendersBlockquote: html.includes("<blockquote>"),
    rendersNestedList: (html.match(/<ul>/g) ?? []).length === 2,
    rendersFence: html.includes('<code class="language-ts">'),
    securesExternalLink:
      html.includes('href="https://example.com/spec"') &&
      html.includes('target="_blank"') &&
      html.includes('rel="noreferrer"'),
    disablesUnsafeLink: html.includes("perigoso") && !html.includes("javascript:"),
    disablesImage: html.includes("pixel") && !html.includes("<img"),
    escapesArbitraryHtml: html.includes("&lt;em&gt;HTML arbitrário&lt;/em&gt;"),
  }).toEqual({
    hidesStructuralComment: true,
    rendersBlockquote: true,
    rendersNestedList: true,
    rendersFence: true,
    securesExternalLink: true,
    disablesUnsafeLink: true,
    disablesImage: true,
    escapesArbitraryHtml: true,
  });
});
```

Keep the existing basic heading/emphasis test only if it covers behavior not present in this canonical document. Add a second boundary test for the reviewer's advisory distinction:

```tsx
it("should hide only canonical structural comments", () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview markdown={'<!-- sprint-griller:report-section:gaps -->\n\n<!-- comentário comum -->'} />,
  );

  expect(html).toContain("&lt;!-- comentário comum --&gt;");
  expect(html).not.toContain("sprint-griller:report-section:gaps");
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/ui/markdown-preview.test.tsx
```

Expected: FAIL because the handwritten parser exposes the structural comment, flattens nested lists/blockquotes/fences, and leaves unsupported image/link syntax visible.

- [ ] **Step 3: Declare the parser at the importing package boundary**

Run:

```bash
rtk pnpm --filter @sprint-griller/web add markdown-it@^14.3.0
rtk pnpm --filter @sprint-griller/web add --save-dev @types/markdown-it@^14.1.2
```

Expected: `apps/web/package.json` gains direct runtime and type dependencies; the existing locked versions are reused.

- [ ] **Step 4: Replace the handwritten parser with the minimum configured renderer**

Replace `Block`, `parseBlocks`, `INLINE_TOKEN`, and `renderInline` with this structure:

```tsx
import MarkdownIt from "markdown-it";

const STRUCTURAL_COMMENT = /^<!-- sprint-griller:[A-Za-z0-9:._-]+ -->[\t ]*$/gm;
const previewMarkdown = new MarkdownIt({ html: false, linkify: false });

previewMarkdown.validateLink = () => true;
previewMarkdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index];
  const href = token?.attrGet("href");
  if (token !== undefined && href !== null && href !== undefined && isWebUrl(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noreferrer");
    return renderer.renderToken(tokens, index, options);
  }

  const closing = tokens.slice(index + 1).find((candidate) => candidate.type === "link_close");
  if (closing !== undefined) closing.hidden = true;
  return "";
};

previewMarkdown.renderer.rules.image = (tokens, index, options, env, renderer) =>
  previewMarkdown.utils.escapeHtml(
    renderer.renderInlineAsText(tokens[index]?.children ?? [], options, env),
  );

export function MarkdownPreview({ markdown }: { readonly markdown: string }) {
  const html = previewMarkdown.render(markdown.replace(STRUCTURAL_COMMENT, ""));
  return (
    <div
      className="flex flex-col gap-4 text-sm leading-7"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function isWebUrl(candidate: string): boolean {
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
```

Do not add HTML sanitizers or another Markdown abstraction: `html: false`, the link renderer, the image renderer, and React's single controlled insertion point are the complete boundary.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/ui/markdown-preview.test.tsx
rtk pnpm --filter @sprint-griller/web typecheck
rtk pnpm --filter @sprint-griller/web lint
```

Expected: all commands PASS.

Commit:

```bash
rtk git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/ui/markdown-preview.tsx apps/web/src/components/ui/markdown-preview.test.tsx
rtk git commit -m "fix(web): render markdown safely"
```

---

### Task 2: Minimal Picker action projection

**Files:**
- Create: `apps/web/src/lib/picker-action.ts`
- Create: `apps/web/src/lib/picker-action.test.ts`
- Delete: `apps/web/src/lib/investigation-ui-status.ts`
- Delete: `apps/web/src/lib/investigation-ui-status.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/picker.tsx`
- Modify: `apps/web/src/components/picker.test.tsx`

**Interfaces:**
- Consumes: `derivePickerAction(persisted: RefinementStatus, run: InvestigationRun | undefined)`.
- Produces:

```ts
export type PickerAction =
  | { readonly kind: "start"; readonly label: "Investigar" | "Investigar novamente" }
  | {
      readonly kind: "open";
      readonly label:
        | "Acompanhar execução"
        | "Revisar falha"
        | "Revisar reprovação"
        | "Tentar publicação"
        | "Conferir publicação"
        | "Revisar relatório";
    };
```

- [ ] **Step 1: Write the failing projection contract**

Create `picker-action.test.ts` with realistic `InvestigationRun` factories and this table:

```ts
const baseRun = {
  storyId: 42,
  story: undefined,
  startedAt: 1,
  previous: undefined,
  publication: undefined,
} as const;

function run(status: InvestigationRun["status"]): InvestigationRun {
  if (status === "em-andamento") return { ...baseRun, status };
  if (status === "falhou") {
    return { ...baseRun, status, finishedAt: 2, message: "A Investigação falhou." };
  }
  if (status === "reprovado") {
    return {
      ...baseRun,
      status,
      finishedAt: 2,
      report: { summary: "Resumo", gaps: [], impacts: [], externalRepos: [], unverified: [] },
      markdown: "# Investigação",
      violations: [],
    };
  }
  return {
    ...baseRun,
    status,
    finishedAt: 2,
    report: { summary: "Resumo", gaps: [], impacts: [], externalRepos: [], unverified: [] },
    markdown: "# Investigação",
  };
}

it.each([
  ["sem-investigacao", undefined, { kind: "start", label: "Investigar" }],
  ["investigada", undefined, { kind: "start", label: "Investigar novamente" }],
  ["sem-investigacao", run("em-andamento"), { kind: "open", label: "Acompanhar execução" }],
  ["investigada", run("falhou"), { kind: "open", label: "Revisar falha" }],
  ["investigada", run("reprovado"), { kind: "open", label: "Revisar reprovação" }],
  ["investigada", run("aprovado"), { kind: "open", label: "Revisar relatório" }],
] as const)("should derive the Picker action from %s and the local run", (persisted, local, expected) => {
  expect(derivePickerAction(persisted, local)).toEqual(expected);
});
```

Add the publication cases with an independently specified expected label:

```ts
it.each([
  [{ status: "publicada", commentId: 9, url: "https://example.com/117" }, "Revisar relatório"],
  [{ status: "falhou", message: "Nada foi publicado." }, "Tentar publicação"],
  [{ status: "incerta", message: "Confira o Azure DevOps." }, "Conferir publicação"],
] as const)("should derive %s from the publication outcome", (publication, label) => {
  const approved = run("aprovado");
  if (approved.status !== "aprovado") throw new Error("Fixture aprovada inválida.");

  expect(derivePickerAction("investigada", { ...approved, publication })).toEqual({
    kind: "open",
    label,
  });
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/lib/picker-action.test.ts
```

Expected: FAIL because `picker-action.ts` does not exist.

- [ ] **Step 3: Implement the pure mapper**

Create `picker-action.ts` with early returns mirroring the public labels, returning no timestamps, messages, comment IDs, or repeated persisted status:

```ts
export function derivePickerAction(
  persisted: RefinementStatus,
  run: InvestigationRun | undefined,
): PickerAction {
  if (run === undefined) {
    return {
      kind: "start",
      label: persisted === "sem-investigacao" ? "Investigar" : "Investigar novamente",
    };
  }
  if (run.status === "em-andamento") return { kind: "open", label: "Acompanhar execução" };
  if (run.status === "falhou") return { kind: "open", label: "Revisar falha" };
  if (run.status === "reprovado") return { kind: "open", label: "Revisar reprovação" };
  if (run.publication?.status === "falhou") return { kind: "open", label: "Tentar publicação" };
  if (run.publication?.status === "incerta") return { kind: "open", label: "Conferir publicação" };
  return { kind: "open", label: "Revisar relatório" };
}
```

- [ ] **Step 4: Move consumers to the reduced contract**

In `page.tsx`, replace `deriveInvestigationUiStatus` with `derivePickerAction` and emit `action: derivePickerAction(...)`.

In `picker.tsx`, change `PickerStory` to:

```ts
export type PickerStory = IterationStory & {
  readonly action: PickerAction;
};
```

Replace the nested label ternary in `StoryAction` with the discriminant:

```tsx
if (story.action.kind === "start") {
  return (
    <form action={startAction}>
      <input type="hidden" name="storyId" value={story.id} />
      <Button type="submit" size="sm" variant="secondary">{story.action.label}</Button>
    </form>
  );
}
return (
  <Link
    href={`/investigacao/${story.id}`}
    className="inline-flex min-h-8 items-center justify-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-accent underline-offset-4 hover:underline"
  >
    {story.action.label}
  </Link>
);
```

Update Picker fixtures to use `action`, then remove the old status module and test.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/lib/picker-action.test.ts apps/web/src/components/picker.test.tsx
rtk pnpm --filter @sprint-griller/web typecheck
rtk pnpm --filter @sprint-griller/web lint
```

Expected: all commands PASS and `rg 'InvestigationUiStatus|uiStatus' apps/web/src` returns no matches.

Commit:

```bash
rtk git add apps/web/src/app/page.tsx apps/web/src/components/picker.tsx apps/web/src/components/picker.test.tsx apps/web/src/lib/picker-action.ts apps/web/src/lib/picker-action.test.ts apps/web/src/lib/investigation-ui-status.ts apps/web/src/lib/investigation-ui-status.test.ts
rtk git commit -m "refactor(web): simplify picker actions"
```

---

### Task 3: Pure Investigation view boundary

**Files:**
- Create: `apps/web/src/app/investigacao/[storyId]/investigation-view.tsx`
- Create: `apps/web/src/app/investigacao/[storyId]/investigation-view.test.tsx`
- Modify: `apps/web/src/app/investigacao/[storyId]/page.tsx`

**Interfaces:**
- Consumes the existing `InvestigationRun`, `ReportRun`, UI primitives, and form-action signatures.
- Produces:

```ts
export interface InvestigationViewModel {
  readonly storyId: number;
  readonly run: InvestigationRun | undefined;
  readonly openCeremonyId: string | undefined;
}

export type InvestigationFormAction = (formData: FormData) => void | Promise<void>;

export interface InvestigationViewActions {
  readonly startCeremony: InvestigationFormAction;
  readonly publishInvestigation: InvestigationFormAction;
}

export function InvestigationView({
  model,
  actions,
}: {
  readonly model: InvestigationViewModel;
  readonly actions: InvestigationViewActions;
}): ReactElement;
```

- [ ] **Step 1: Write the failing pure-view contract**

Create a rejected `InvestigationRun` fixture with one citation violation and inert actions, then assert through the rendered view:

```tsx
const rejectedRun = {
  storyId: 117,
  story: {
    id: 117,
    title: "Exportar relatório",
    type: "User Story",
    state: "New",
    description: "Exportar o relatório em CSV.",
    url: "https://example.com/117",
  },
  startedAt: 1,
  finishedAt: 2,
  previous: undefined,
  publication: undefined,
  status: "reprovado",
  report: {
    summary: "A regra ainda não está ancorada no código.",
    gaps: [],
    impacts: [],
    externalRepos: [],
    unverified: ["Formato final do CSV."],
  },
  markdown: "# Investigação — US #117\n",
  violations: [{
    claim: "O endpoint já existe.",
    citation: { repo: "core-api", path: "src/export.ts" },
    reason: "caminho-inexistente",
    detail: "core-api: o arquivo src/export.ts não existe.",
  }],
} as const satisfies InvestigationRun;

function inertAction(_formData: FormData): void {
  return undefined;
}

it("should render a rejected investigation without reading runtime state or exposing writes", () => {
  const html = renderToStaticMarkup(
    <InvestigationView
      model={{ storyId: 117, run: rejectedRun, openCeremonyId: undefined }}
      actions={{ startCeremony: inertAction, publishInvestigation: inertAction }}
    />,
  );

  expect({
    identifiesStory: html.includes("Investigação · US #117"),
    showsRejection: html.includes("Relatório reprovado na checagem de citações"),
    hasNoPublish: !html.includes(">Publicar<"),
    hasNoCeremonyStart: !html.includes("Refinar com a sala"),
  }).toEqual({
    identifiesStory: true,
    showsRejection: true,
    hasNoPublish: true,
    hasNoCeremonyStart: true,
  });
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/investigacao/[storyId]/investigation-view.test.tsx'
```

Expected: FAIL because `InvestigationView` does not exist.

- [ ] **Step 3: Extract the view without changing rendered behavior**

Move the current rendered tree and private presentation helpers from `page.tsx` into `investigation-view.tsx`. Make these dependency changes while moving:

```tsx
function RefinementCallToAction({
  storyId,
  publication,
  openCeremonyId,
  action,
}: {
  readonly storyId: number;
  readonly publication: ReportRun["publication"];
  readonly openCeremonyId: string | undefined;
  readonly action: InvestigationFormAction;
}) {
  if (openCeremonyId !== undefined) {
    return (
      <Section id="refinar" heading="Próxima ação">
        <Link href={`/cerimonia/${openCeremonyId}`}>Voltar ao Palco</Link>
        <p className="mt-2 text-sm text-muted">O Refinamento desta US já está aberto.</p>
      </Section>
    );
  }

  if (publication?.status !== "publicada") {
    return (
      <Section id="refinar" heading="Próxima ação">
        <p className="text-sm text-muted">
          Publique a Investigação antes de abrir o Refinamento para levar um insumo rastreável à sala.
        </p>
        <ConfirmAction
          triggerLabel="Refinar sem publicar"
          title="Abrir Refinamento sem publicar?"
          description="A sala receberá a Investigação aprovada, mas ela ainda não será registrada no Azure DevOps. Confirme somente se isso for intencional."
          confirmLabel="Abrir sem publicar"
          action={action}
          triggerProps={{ variant: "secondary" }}
        >
          <input type="hidden" name="storyId" value={storyId} />
        </ConfirmAction>
      </Section>
    );
  }

  return (
    <Section id="refinar" heading="Próxima ação">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="storyId" value={storyId} />
        <Button type="submit" variant="primary">Refinar com a sala</Button>
        <span className="text-sm text-muted">
          A Investigação publicada será o insumo do Refinamento coletivo.
        </span>
      </form>
    </Section>
  );
}

```

Apply this exact dependency diff to the moved `Publish` function and leave its three publication-status branches otherwise unchanged:

```diff
-function Publish({ run }: { run: ReportRun }) {
+function Publish({ run, action }: { readonly run: ReportRun; readonly action: InvestigationFormAction }) {
   const publication = run.publication;
@@
-      <form action={publishInvestigationAction} className="flex">
+      <form action={action} className="flex">
```

`investigation-view.tsx` must not import `findOpenCeremony`, `startCeremonyAction`, or `publishInvestigationAction`.

- [ ] **Step 4: Reduce the route to a controller**

Keep validation and dynamic rendering in `page.tsx`, and construct the view model before rendering:

```tsx
const run = getInvestigation(storyId);
const openCeremonyId = run?.status === "aprovado"
  ? findOpenCeremony(storyId)?.id
  : undefined;

return (
  <InvestigationView
    model={{ storyId, run, openCeremonyId }}
    actions={{
      startCeremony: startCeremonyAction,
      publishInvestigation: publishInvestigationAction,
    }}
  />
);
```

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
rtk pnpm exec vitest run 'apps/web/src/app/investigacao/[storyId]/investigation-view.test.tsx'
rtk pnpm --filter @sprint-griller/web typecheck
rtk pnpm --filter @sprint-griller/web lint
```

Expected: all commands PASS; `page.tsx` contains controller work only.

Commit:

```bash
rtk git add 'apps/web/src/app/investigacao/[storyId]/page.tsx' 'apps/web/src/app/investigacao/[storyId]/investigation-view.tsx' 'apps/web/src/app/investigacao/[storyId]/investigation-view.test.tsx'
rtk git commit -m "refactor(web): isolate investigation view"
```

---

### Task 4: Development gallery backed by production views

**Files:**
- Modify: `apps/web/src/app/__dev/ui/fixtures.ts`
- Modify: `apps/web/src/app/__dev/ui/fixtures.test.ts`
- Create: `apps/web/src/app/__dev/ui/gallery.tsx`
- Create: `apps/web/src/app/__dev/ui/gallery.test.tsx`
- Modify: `apps/web/src/app/dev-ui/page.tsx`

**Interfaces:**
- Consumes: `Picker`, `InvestigationView`, `PalcoView`, and `DossieView` with inert `InvestigationFormAction` dependencies.
- Produces:

```ts
export type UiView = "picker" | "investigacao" | "palco" | "dossie";
export function parseUiQuery(input: unknown): { readonly view: UiView };
export function UiGalleryView({
  view,
  action,
}: {
  readonly view: UiView;
  readonly action: InvestigationFormAction;
}): ReactElement;
```

- [ ] **Step 1: Tighten the query seam and write the failing gallery contract**

Change `fixtures.test.ts` to prove the query has no parallel state dimension:

```ts
it("should parse one supported production view", () => {
  expect(parseUiQuery({ view: "palco" })).toEqual({ view: "palco" });
});

it("should reject unknown or legacy fixture dimensions", () => {
  expect(() => parseUiQuery({ view: "picker", state: "empty" })).toThrow();
});
```

Create `gallery.test.tsx`:

```tsx
function inertAction(_formData: FormData): void {
  return undefined;
}

it.each([
  ["picker", "#117 · Exportar relatório"],
  ["investigacao", "Relatório reprovado na checagem de citações"],
  ["palco", "Refinamento publicado"],
  ["dossie", "Dossiê — US #117"],
] as const)("should render the production %s view", (view, marker) => {
  const html = renderToStaticMarkup(<UiGalleryView view={view} action={inertAction} />);
  expect(html).toContain(marker);
});
```

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/app/__dev/ui/fixtures.test.ts apps/web/src/app/__dev/ui/gallery.test.tsx
```

Expected: FAIL because the old schema accepts `state` and no gallery component exists.

- [ ] **Step 3: Replace nominal fixture metadata with typed production data**

In `fixtures.ts`:

```ts
export const UI_VIEWS = ["picker", "investigacao", "palco", "dossie"] as const;
export const uiQuerySchema = z.object({ view: z.enum(UI_VIEWS).default("picker") }).strict();
export type UiQuery = z.infer<typeof uiQuerySchema>;
export type UiView = UiQuery["view"];
```

Export four constants using `as const satisfies` against their production types. Use this deterministic data, splitting the literals across small private constants in `fixtures.ts`:

```ts
const STORY = {
  id: 117,
  title: "Exportar relatório",
  url: "https://example.com/117",
} as const;

const DECISION = {
  questionSeq: 1,
  questionId: "question-1",
  question: "Qual formato será exportado?",
  recommendation: "CSV em UTF-8.",
  answer: "CSV em UTF-8.",
  decidedAt: 1,
} as const;

const SPEC_MARKDOWN = "# Spec da US #117 — Exportar relatório\n";
const TICKETS_MARKDOWN = "## Implementar exportação\n";

export const PICKER_STORIES = [{
  ...STORY,
  type: "User Story",
  state: "Active",
  assignedTo: "Ana",
  refinement: "investigada",
  action: { kind: "open", label: "Revisar relatório" },
}] as const satisfies readonly PickerStory[];

export const INVESTIGATION_MODEL = {
  storyId: STORY.id,
  openCeremonyId: undefined,
  run: {
    storyId: STORY.id,
    story: {
      ...STORY,
      type: "User Story",
      state: "Active",
      description: "Exportar o relatório em CSV.",
    },
    startedAt: 1,
    finishedAt: 2,
    previous: undefined,
    publication: undefined,
    status: "reprovado",
    report: {
      summary: "A regra ainda não está ancorada no código.",
      gaps: [],
      impacts: [],
      externalRepos: [],
      unverified: ["Formato final do CSV."],
    },
    markdown: "# Investigação — US #117\n",
    violations: [{
      claim: "O endpoint já existe.",
      citation: { repo: "core-api", path: "src/export.ts" },
      reason: "caminho-inexistente",
      detail: "core-api: o arquivo src/export.ts não existe.",
    }],
  },
} as const satisfies InvestigationViewModel;

export const PALCO_STATE = {
  sessionId: "fixture-session",
  story: STORY,
  refinement: { phase: "publicado", revision: 6 },
  completionProposal: null,
  agenda: [],
  decisionCount: 1,
  decisions: [DECISION],
  pendingQuestions: [],
  lastDecision: DECISION,
  consultation: null,
  pending: [],
  live: false,
  current: { phase: "encerrada" },
} as const satisfies PalcoState;

export const DOSSIE_STATE = {
  sessionId: "fixture-session",
  status: "encerrada",
  timeZone: "UTC",
  refinement: { phase: "publicado", revision: 6 },
  completionProposal: null,
  agenda: [],
  story: STORY,
  decisions: [DECISION],
  pending: [],
  investigation: { impact: "Impacto confirmado.", unverified: "Nenhuma hipótese." },
  spec: { generated: SPEC_MARKDOWN, draft: null },
  taskPreview: TICKETS_MARKDOWN,
  artifacts: {
    spec: {
      revision: 3,
      submission: {
        problem: "Exportação indisponível.",
        solution: "Gerar CSV.",
        expectedBehaviors: ["Entrega CSV em UTF-8."],
        implementationDecisions: ["Processamento síncrono."],
        testStrategy: ["Teste de integração do endpoint."],
        outOfScope: [],
        traceability: ["question-1"],
      },
      markdown: SPEC_MARKDOWN,
      submittedAt: 2,
      approval: {
        revision: 3,
        hash: "spec-hash",
        markdown: SPEC_MARKDOWN,
        approvedAt: 3,
      },
    },
    tickets: {
      revision: 4,
      submission: { tickets: [{
        id: "task-1",
        title: "Implementar exportação",
        description: "Entrega o CSV da US.",
        acceptanceCriteria: ["Retorna CSV em UTF-8."],
        specUrl: STORY.url,
        blockedBy: [],
      }] },
      markdown: TICKETS_MARKDOWN,
      submittedAt: 4,
      specRevision: 3,
      specHash: "spec-hash",
      approval: {
        revision: 4,
        hash: "tickets-hash",
        markdown: TICKETS_MARKDOWN,
        approvedAt: 5,
        specRevision: 3,
        specHash: "spec-hash",
      },
    },
  },
  dump: {
    status: "completed",
    inputs: {
      dumpId: "dump-fixture",
      markdown: SPEC_MARKDOWN,
      tasksMarkdown: TICKETS_MARKDOWN,
      estimate: 3,
    },
    completedAt: 6,
  },
} as const satisfies DossieState;
```

- [ ] **Step 4: Render the production components and remove the generic state component**

Create `gallery.tsx` as an exhaustive switch:

```tsx
export function UiGalleryView({ view, action }: UiGalleryViewProps) {
  switch (view) {
    case "picker":
      return (
        <OperationalFrame>
          <Picker
            iterationName="Sprint fixture"
            stories={PICKER_STORIES}
            project="Plataforma"
            repos={{ primary: { name: "core-api", path: "/fixture/core-api" }, related: [] }}
            startAction={action}
          />
        </OperationalFrame>
      );
    case "investigacao":
      return (
        <InvestigationView
          model={INVESTIGATION_MODEL}
          actions={{ startCeremony: action, publishInvestigation: action }}
        />
      );
    case "palco":
      return <PalcoView state={PALCO_STATE} connected />;
    case "dossie":
      return <DossieView state={DOSSIE_STATE} connected />;
  }
}
```

Reduce `dev-ui/page.tsx` to the development guard, query parsing, and an inert inline server action:

```tsx
async function inertFixtureAction(_formData: FormData): Promise<void> {
  "use server";
}

return <UiGalleryView view={query.view} action={inertFixtureAction} />;
```

The page must keep `notFound()` for production and invalid queries. Delete `FixtureState`, `UI_STATES`, and `UI_FIXTURES`.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/app/__dev/ui/fixtures.test.ts apps/web/src/app/__dev/ui/gallery.test.tsx
rtk pnpm --filter @sprint-griller/web typecheck
rtk pnpm --filter @sprint-griller/web lint
```

Expected: all commands PASS and `rg 'UI_STATES|FixtureState' apps/web/src` returns no matches.

Commit:

```bash
rtk git add apps/web/src/app/__dev/ui/fixtures.ts apps/web/src/app/__dev/ui/fixtures.test.ts apps/web/src/app/__dev/ui/gallery.tsx apps/web/src/app/__dev/ui/gallery.test.tsx apps/web/src/app/dev-ui/page.tsx
rtk git commit -m "feat(web): render production ui fixtures"
```

---

### Task 5: Explicit completed Dossiê progress

**Files:**
- Modify: `apps/web/src/components/ui/step-progress.tsx`
- Modify: `apps/web/src/components/ui/ui.test.tsx`
- Modify: `apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.tsx`
- Create: `apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx`

**Interfaces:**
- Consumes: `DossieState["refinement"]["phase"]`.
- Produces:

```ts
export type ProgressState<StepId extends string> =
  | { readonly kind: "active"; readonly step: StepId }
  | { readonly kind: "complete" };

export interface ProgressStep<StepId extends string> {
  readonly id: StepId;
  readonly label: string;
}

export function StepProgress<StepId extends string>(props: {
  readonly steps: readonly [ProgressStep<StepId>, ...ProgressStep<StepId>[]];
  readonly progress: ProgressState<StepId>;
}): ReactElement;
```

- [ ] **Step 1: Write the failing completed-workflow contract**

Update the direct UI primitive test to use stable step IDs and add an invalid-active-ID test through a widened runtime value:

```tsx
it("should mark every step complete without identifying a current step", () => {
  const html = renderToStaticMarkup(
    <StepProgress
      steps={[
        { id: "investigar", label: "Investigar" },
        { id: "refinar", label: "Refinar" },
        { id: "publicar", label: "Publicar" },
      ]}
      progress={{ kind: "complete" }}
    />,
  );

  expect({
    currentSteps: (html.match(/aria-current="step"/g) ?? []).length,
    completedSteps: (html.match(/data-state="complete"/g) ?? []).length,
  }).toEqual({ currentSteps: 0, completedSteps: 3 });
});
```

Add the two programmer-error boundaries explicitly:

```tsx
it("should reject duplicate step identifiers", () => {
  expect(() => renderToStaticMarkup(
    <StepProgress
      steps={[{ id: "refinar", label: "Refinar" }, { id: "refinar", label: "Duplicado" }]}
      progress={{ kind: "active", step: "refinar" }}
    />,
  )).toThrow("StepProgress requires unique step identifiers.");
});

it("should reject an active step that is absent at runtime", () => {
  const progress: ProgressState<string> = { kind: "active", step: "ausente" };

  expect(() => renderToStaticMarkup(
    <StepProgress
      steps={[{ id: "refinar", label: "Refinar" }]}
      progress={progress}
    />,
  )).toThrow('StepProgress active step "ausente" is not present.');
});
```

Create `dossie.test.tsx` using the published `DOSSIE_STATE` fixture from Task 4:

```tsx
it("should present a published Dossiê as a completed workflow", () => {
  const html = renderToStaticMarkup(<DossieView state={DOSSIE_STATE} connected />);

  expect({
    published: html.includes("Refinamento publicado"),
    noCurrentStep: !html.includes('aria-current="step"'),
    completedSteps: (html.match(/data-state="complete"/g) ?? []).length,
  }).toEqual({ published: true, noCurrentStep: true, completedSteps: 5 });
});
```

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/ui/ui.test.tsx 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
```

Expected: FAIL because `StepProgress` accepts only an index and published Dossiê clamps to Publish as current.

- [ ] **Step 3: Implement stable identifiers and explicit completion**

In `step-progress.tsx`, first reject duplicate IDs and missing active IDs with actionable programmer errors:

```ts
const ids = new Set(steps.map((step) => step.id));
if (ids.size !== steps.length) throw new Error("StepProgress requires unique step identifiers.");
if (progress.kind === "active" && !ids.has(progress.step)) {
  throw new Error(`StepProgress active step "${progress.step}" is not present.`);
}
```

For each step, derive one display state:

```ts
const activeIndex = progress.kind === "active"
  ? steps.findIndex((step) => step.id === progress.step)
  : steps.length;
const state = progress.kind === "complete" || index < activeIndex
  ? "complete"
  : index === activeIndex
    ? "active"
    : "pending";
```

Render `data-state={state}` and set `aria-current="step"` only for `active`.

- [ ] **Step 4: Replace Dossiê's parallel arrays and clamp**

Define the canonical steps once:

```ts
const REFINEMENT_STEPS = [
  { id: "refinar", label: "Refinar" },
  { id: "confirmar", label: "Confirmar" },
  { id: "spec", label: "Spec" },
  { id: "tickets", label: "Tickets" },
  { id: "publicar", label: "Publicar" },
] as const;

type RefinementStepId = (typeof REFINEMENT_STEPS)[number]["id"];

const REFINEMENT_PROGRESS = {
  refinando: { kind: "active", step: "refinar" },
  "aguardando-confirmacao": { kind: "active", step: "confirmar" },
  "revisando-spec": { kind: "active", step: "spec" },
  "revisando-tickets": { kind: "active", step: "tickets" },
  "pronto-para-publicar": { kind: "active", step: "publicar" },
  publicado: { kind: "complete" },
} as const satisfies Record<
  DossieState["refinement"]["phase"],
  ProgressState<RefinementStepId>
>;
```

`PhaseGate` passes `steps={REFINEMENT_STEPS}` and `progress={REFINEMENT_PROGRESS[state.refinement.phase]}`. Remove `indexOf`, `Math.min`, and `Math.max`.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
rtk pnpm exec vitest run apps/web/src/components/ui/ui.test.tsx 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
rtk pnpm --filter @sprint-griller/web typecheck
rtk pnpm --filter @sprint-griller/web lint
```

Expected: all commands PASS.

Commit:

```bash
rtk git add apps/web/src/components/ui/step-progress.tsx apps/web/src/components/ui/ui.test.tsx 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.tsx' 'apps/web/src/app/cerimonia/[sessionId]/dossie/dossie.test.tsx'
rtk git commit -m "fix(web): represent completed refinement progress"
```

---

### Task 6: Full verification

**Files:**
- Verify all files changed in Tasks 1–5.

**Interfaces:**
- Consumes: the five completed task deliverables.
- Produces: a branch whose complete static, test, lint, and production-build contracts pass.

- [ ] **Step 1: Run the complete repository checks**

Run:

```bash
rtk pnpm check
rtk pnpm build
rtk git diff --check origin/master...HEAD
```

Expected: typecheck, lint, all Vitest suites, Next production build, and whitespace checks PASS.

- [ ] **Step 2: Verify the reviewed debt is absent**

Run:

```bash
rg 'parseBlocks|INLINE_TOKEN|InvestigationUiStatus|uiStatus|UI_STATES|FixtureState|Math\.min\(Math\.max\(current' apps/web/src
```

Expected: no matches.

- [ ] **Step 3: Inspect final scope**

Run:

```bash
rtk git status --short --branch
rtk git diff --stat origin/master...HEAD
rtk git log --oneline origin/master..HEAD
```

Expected: only planned files are changed, the worktree is clean, and every implementation slice has its own conventional commit.
