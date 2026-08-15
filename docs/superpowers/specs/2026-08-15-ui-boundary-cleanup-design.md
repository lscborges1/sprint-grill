# UI Boundary Cleanup Design

## Goal

Resolve the maintainability findings from the Refina workflow redesign without changing its product behavior. The cleanup keeps the existing Palco decomposition, removes duplicate or misleading UI models, and makes development fixtures exercise the production views they claim to represent.

## Scope

This change covers four UI boundaries:

1. Markdown rendering in Investigação and Dossiê.
2. The Picker's derived next-action model.
3. The development-only UI fixture route.
4. Dossiê workflow progress semantics.

It does not change ceremony persistence, Azure DevOps writes, the refinement state machine, or the visible workflow vocabulary defined in `CONTEXT.md`.

## Design

### Markdown preview

`MarkdownPreview` remains the public React seam. Its handwritten block and inline parsers will be replaced with `markdown-it`, which is already present in the workspace. The web package will declare the dependency directly because it imports it directly.

The renderer will disable raw HTML and rely on a narrowly configured link policy so external Markdown cannot create active `javascript:` or other unsafe links. The resulting HTML will be inserted only after this controlled rendering step. Canonical report constructs—including hidden section comments, nested lists, blockquotes, and fenced code—must render according to Markdown semantics rather than appearing as parser artifacts.

The browser preview and Azure DevOps conversion have different presentation needs, so this change reuses the parser dependency without coupling the browser bundle to the server-oriented `ado-client` barrel.

### Picker next action

The server-side mapping from `IterationStory` plus local `InvestigationRun` will produce a small discriminated `PickerAction` value. It will contain only the information consumed by the Picker: whether the action starts an investigation or opens its existing detail, and the visible label.

`PickerStory` will carry this value alongside the Azure DevOps refinement status. It will no longer carry `InvestigationUiStatus`, repeated persisted state, internal error messages, timestamps, or publication identifiers that the Picker never renders. The mapping remains pure and is tested independently through its public function.

### Development UI fixtures

`/__dev/ui` remains development-only and keeps its validated `view` and `state` query boundary. Each supported `view` must render the corresponding production view component with a typed, inert fixture:

- Picker renders `Picker` with fixture stories whose actions do not write data.
- Investigação renders an extracted pure `InvestigationView` used by both the route and fixture gallery.
- Palco renders the existing `PalcoView` with a fixture state that requires no valid persisted session.
- Dossiê renders the existing `DossieView` with a fixture state that requires no mutation.

Fixture states may select safe loading, empty, error, or terminal production states. They must not introduce fixture-specific branches into production components and must not call Azure DevOps, SQLite, or agent runtime boundaries.

### Workflow progress

`StepProgress` will accept a discriminated progress state rather than a numeric index alone:

- `active` identifies exactly one current step.
- `complete` marks every step complete and marks none as current.

Dossiê will derive that state from `DossieState["refinement"]["phase"]` through one exhaustive typed mapping. The mapping replaces the parallel phase array, `indexOf`, and clamping logic. The published phase therefore has an explicit completed representation.

## Data flow

Server-owned domain data remains canonical:

1. The home route reads Azure DevOps status and any local investigation run.
2. A pure mapper derives the minimal Picker action before data crosses the client boundary.
3. Production view components receive their existing domain projections or the reduced Picker presentation model.
4. The development route supplies typed in-memory fixtures to those same public view components.

No new persistent state or external write path is introduced.

## Error and security behavior

- Raw HTML in Markdown stays inert.
- Unsafe link destinations do not become active anchors.
- Existing server-action error handling remains unchanged.
- Development fixtures are unavailable outside `NODE_ENV=development` and perform no external work.
- Exhaustive TypeScript mappings make newly added refinement phases a compile-time maintenance point.

## TDD slices

Work proceeds one vertical slice at a time:

1. Add canonical Markdown examples to the `MarkdownPreview` rendering test and observe failure; replace the parser and make it pass.
2. Add Picker action contract tests that assert the minimal action value; replace `InvestigationUiStatus` and update the Picker.
3. Add route/view rendering tests proving each fixture view emits production-specific content; connect typed fixtures to production views.
4. Add a `DossieView` rendering test proving published progress has no current step and all steps are complete; introduce the discriminated progress contract.

Each slice runs its focused test before and after implementation. The final verification runs typecheck, lint, the complete test suite, and a production build if the environment permits it.

## Acceptance criteria

- Canonical reports and Specs render nested lists, blockquotes, fenced code, and hidden comments correctly.
- Raw HTML and unsafe Markdown links remain inert.
- Picker client data contains one canonical refinement status plus a minimal next-action value, with no unused duplicated execution metadata.
- Every named development fixture renders its corresponding production view.
- Published Dossiê progress is complete, not current on Publish.
- Existing workflow behavior and Azure DevOps write boundaries are unchanged.
