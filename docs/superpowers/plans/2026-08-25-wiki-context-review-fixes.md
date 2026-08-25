# Wiki Context Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix plain-text Wiki `pagePath` parsing and close the deterministic and end-to-end test gaps found in review.

**Architecture:** Keep `fetchWikiContext` as the public parsing/traversal seam and change only its raw-link normalization order. Exercise the complete web orchestration through `startInvestigation` and `publishInvestigation`, mocking only the Azure DevOps HTTP boundary and the external agent runtime.

**Tech Stack:** TypeScript 5.9, Vitest 4, pnpm workspace, native `URL`/`fetch` APIs.

**Spec:** `README.md` section "Investigação AFK — o agente lê a US e os repos"

## Global Constraints

- Preserve canonical same-organization `dev.azure.com` URL validation.
- Traverse sequentially in breadth-first order to depth 1, with at most 10 attempts and 100,000 retained characters.
- Treat Wiki data as untrusted and never expose the PAT or page contents in logs.
- Add no configuration or external dependency.
- Test behavior through public interfaces and mock only HTTP and the agent runtime.

---

### Task 1: Normalize plain-text closing delimiters

**Files:**
- Modify: `packages/ado-client/src/wiki/wiki.ts:272-283`
- Test: `packages/ado-client/src/wiki/wiki.test.ts`

**Interfaces:**
- Consumes: `fetchWikiContext(options, { storyId, description }): Promise<WikiContext>`
- Produces: the same API, with a parenthesized plain-text `pagePath` requested without the prose delimiter

- [x] **Step 1: Write the failing public-seam test**

```ts
it("should trim unmatched closing delimiters from plain-text pagePath links", async () => {
  const doFetch = vi.fn<typeof globalThis.fetch>(async () =>
    wikiPage(10, "/Runbook"),
  );

  await fetchWikiContext(options(doFetch), {
    storyId: 4211,
    description:
      "Veja (https://dev.azure.com/acme/Plataforma/_wiki/wikis/Produto.wiki?pagePath=%2FRunbook)",
  });

  expect(new URL(String(doFetch.mock.calls[0]?.[0])).searchParams.get("path")).toBe(
    "/Runbook",
  );
});
```

- [x] **Step 2: Run the test and verify red**

Run: `rtk pnpm exec vitest run packages/ado-client/src/wiki/wiki.test.ts`

Expected: FAIL because the requested path is `/Runbook)`.

- [x] **Step 3: Implement the minimum normalization change**

Normalize unmatched external closing delimiters before the first call to `parseWikiTarget`, while retaining the existing balance-aware algorithm so quoted HTML URLs ending in balanced punctuation remain unchanged.

- [x] **Step 4: Run the focused test and verify green**

Run: `rtk pnpm exec vitest run packages/ado-client/src/wiki/wiki.test.ts`

Expected: PASS.

### Task 2: Make the parser regression test deterministic

**Files:**
- Modify: `packages/ado-client/src/wiki/wiki.test.ts:142-165`

**Interfaces:**
- Consumes: `fetchWikiContext` with an 18,000-character invalid delimiter suffix
- Produces: a deterministic contract that rejects the input without HTTP requests

- [x] **Step 1: Remove the wall-clock assertion**

Delete the `node:perf_hooks` import, `performance.now()` calls, timeout option, and `withinBudget` assertion. Keep the adversarial input and assert the public result plus zero HTTP requests.

- [x] **Step 2: Run the Wiki suite**

Run: `rtk pnpm exec vitest run packages/ado-client/src/wiki/wiki.test.ts`

Expected: PASS without depending on machine timing.

### Task 3: Cover traversal depth and partial recovery

**Files:**
- Modify: `packages/ado-client/src/wiki/wiki.test.ts`

**Interfaces:**
- Consumes: `fetchWikiContext`
- Produces: coverage proving depth-1 pages do not enqueue grandchildren and recoverable failures do not stop later pages

- [x] **Step 1: Extend the BFS fixture with a grandchild link**

Return a Markdown child link from page 2 and keep the expected requests at `[1, 3, 2, 4, "/parent dir/child", 5]`. The existing public result must remain green and prove that depth 2 is ignored.

- [x] **Step 2: Add a partial-failure sequence test**

Use three direct IDs whose HTTP responses are loaded, 404, and loaded. Assert the reference statuses are `["loaded", "unavailable", "loaded"]`, page IDs are preserved for both successes, and all three attempts occur in order.

- [x] **Step 3: Run the Wiki suite**

Run: `rtk pnpm exec vitest run packages/ado-client/src/wiki/wiki.test.ts`

Expected: PASS.

### Task 4: Prove Wiki context reaches the published Markdown

**Files:**
- Create: `apps/web/src/lib/investigations.wiki.integration.test.ts`

**Interfaces:**
- Consumes: `startInvestigation(storyId)`, `getInvestigation(storyId)`, and `publishInvestigation(storyId)`
- Produces: one integration test covering US fetch, Wiki fetch, prompt construction, deterministic gap enrichment, Markdown rendering, and ADO comment publication

- [x] **Step 1: Set up only boundary fakes**

Mock `createAgentRuntime`, `getSquadConfig`, and the logger. Stub global `fetch` with routes for the US, one loaded Wiki page, one 404 Wiki page, and the comments endpoint. Capture the runtime prompt and posted comment body.

- [x] **Step 2: Exercise the complete public workflow**

Start a unique story, wait for an approved investigation, publish it, and assert:

```ts
expect(prompt).toContain("O TTL padrão é 3.600 segundos.");
expect(publishedComment).toContain("Qual contexto da Wiki");
expect(publishedComment).toContain("não encontrou a página");
```

- [x] **Step 3: Run the integration test**

Run: `rtk pnpm exec vitest run apps/web/src/lib/investigations.wiki.integration.test.ts`

Expected: PASS.

### Task 5: Verify and deliver

**Files:**
- Review all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: the complete branch diff
- Produces: a verified conventional commit pushed to `exibir-links-wiki-na-us`

- [x] **Step 1: Run the repository quality gate**

Run: `rtk pnpm check`

Expected: typecheck, lint, and all tests pass.

- [x] **Step 2: Inspect the final diff and status**

Run: `rtk git diff --check && rtk git status --short && rtk git diff --stat`

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-25-wiki-context-review-fixes.md \
  packages/ado-client/src/wiki/wiki.ts \
  packages/ado-client/src/wiki/wiki.test.ts \
  apps/web/src/lib/investigations.wiki.integration.test.ts
git commit -m "fix(wiki): handle plain-text link delimiters"
```

- [x] **Step 4: Push the current branch**

Run: `rtk git push -u origin exibir-links-wiki-na-us`
