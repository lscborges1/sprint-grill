# Responsive Navigation and Theme Contrast Fixes

## Goal

Fix two UI regressions without changing the refinement workflow: responsive Palco and Dossiê navigation must remain available after a mobile-to-desktop resize, and Picker status badges must follow the explicitly selected theme rather than the operating-system theme.

## Responsive navigation

Palco and Dossiê will share a small responsive disclosure component. It keeps the existing native `<details>` interaction on mobile and observes the existing `lg` breakpoint with `matchMedia`. Entering the desktop breakpoint always opens the disclosure, so a mobile-collapsed rail cannot remain inaccessible after resize. Returning to mobile restores the user's previous mobile open state.

The component receives the existing summary and content as children. It owns only responsive presentation state; Palco and Dossiê retain their current domain data, navigation markup, and layout responsibilities. The server-rendered default remains open, preserving useful content before hydration.

## Theme-safe badges

`StatusBadge` will stop using Tailwind's media-query-driven `dark:` text variants. The Picker's warning and success tones will reuse the existing semantic `text-investigated` and `text-refined` colors, whose values already change under explicit `data-theme` selectors and the system-theme media query. Neutral and informational tones remain unchanged.

The unused danger tone is outside this fix. It will not be expanded or refactored unless a production caller needs it.

## Testing

Work proceeds in vertical TDD slices:

1. Through `PalcoView`, assert the server-rendered disclosure is open, collapse it on mobile, switch the mocked viewport to desktop and observe that the rail reopens, then return to mobile and observe that the prior collapsed state is restored.
2. Through `DossieView`, repeat the same SSR and bidirectional viewport contract for Dossiê navigation.
3. Through the rendered `StatusBadge` and global theme contract, prove warning and success badges use the explicit-theme semantic colors and no longer contain `dark:` variants.

Each test must fail before its minimum implementation is added. Final verification runs the focused tests, `pnpm check`, a production build with a valid local review configuration, and `git diff --check origin/master...HEAD`.

## Constraints

- Do not change ceremony state, persistence, server actions, or Azure DevOps behavior.
- Do not add dependencies or duplicate the mobile and desktop navigation trees.
- Preserve native keyboard interaction and an open server-rendered default.
- Keep the explicit Light, Dark, and System theme contract intact.
