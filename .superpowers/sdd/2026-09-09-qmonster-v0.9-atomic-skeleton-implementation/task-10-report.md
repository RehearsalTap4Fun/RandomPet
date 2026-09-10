# Task 10 report — Creator and catalog-report v0.9 integration

Status: **COMPLETE**.

## Scope guard

- Worktree: `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1`.
- Starting HEAD: `b1d3ecfcf58c458f24414a16f22d8b22a6732f80`.
- The pre-existing v0.6/v0.8, Task 9 projection, script, render-test, diagnostics, and plan-file changes were preserved and excluded from this task.
- No approved v0.9 asset, catalog, release manifest, validation rule, or audit record was modified.
- `packages/asset-catalog/releases/active-release.json` remained absent. Candidate use is explicit and never a production fallback.

## TDD ledger

- Initial RED focused run: 6/7 suites failed to transform because `v09-production-release.ts` did not exist; the two new persistence cases failed because `createV09CreatorSession` did not exist. The remaining 30 persistence tests passed.
- Preview-cache RED: the 2048 v0.9 staging frame was saved to a 1024 cache canvas without scaling; the new assertion observed only one correct 2048→1024 draw instead of two. The cache snapshot now scales explicitly.
- Reverse-dispatch RED: a valid v0.9 spec paired with a legacy catalog entered the legacy renderer. Preview dispatch now validates the spec and catalog as one exact supported tuple and reports `VERSION_TUPLE_MISMATCH` before either renderer runs.
- Live-report RED: the v0.9 report required a caller-supplied preview URL resolver. It now resolves full-context preview hashes through the bundled `assets/v0.9.0/by-sha256/<hash>.png` graph by default.
- Resolver boundary audit: Chromium proved that direct PNG decoding cannot serve as the trusted v0.9 renderer resolver because transparent-pixel RGB normalization changes the decoded-content digest. Creator therefore retains explicit injection of the Task 9-style trusted raw-RGBA `V09ResourceResolver`; absence remains a structured fail-closed error rather than an unverified fallback.
- Final focused GREEN: the exact Task 10 Vitest command passed 7 files and 87/87 tests.

## Implementation

- Added browser-safe `loadActiveProductionRelease()`: it reads only an actual or explicitly supplied pointer, resolves the exact manifest hash, enforces the `0.4.0/0.9.0/0.9.0` tuple, loads 312 sealed projections, verifies the corresponding immutable approval inventory, and fails closed when the active pointer is absent.
- Kept the legacy production selector on v0.8; explicit candidate loading is a separate opt-in API.
- Added `AnyMonsterSpec`, a version-isolated v0.9 Creator session, complete structure/release identity persistence, strict restore targeting, and mixed-tuple rejection.
- Added the v0.9 Creator path with one whole-skeleton lock/reroll and exactly twelve appearance controls. It uses the existing deterministic v0.9 generation/reroll functions and fixed 21-node renderer path; no structural body/head/limb/tail controls or transform/connector path is exposed.
- Updated `PreviewCanvas` for exact legacy/v0.9 dispatch, 2048 identity staging, trusted resolver injection, stale-render protection, and correctly scaled cached frames.
- Added a live v0.9 report model derived from the resolved immutable inventory: two skeleton families with 8:1 weights, twelve 8/4/1 semantic slot groups, full-context previews, rarity, approval state, sealed hash, and attachment interface/shape class. Legacy report behavior remains in its original branch.
- Added the narrow Vitest project include needed for the plan-mandated `.test.ts` browser loader suite.

## Verification

- `npx vitest run apps/creator-web/src/v09-production-release.test.ts apps/creator-web/src/production-catalog.test.tsx apps/creator-web/src/App.test.tsx apps/creator-web/src/state/persistence.test.ts apps/creator-web/src/components/PreviewCanvas.test.tsx apps/creator-web/src/catalog-report.test.tsx apps/creator-web/src/components/CatalogReport.test.tsx`: PASS, 7 files, 87/87 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; Vite transformed 4,906 modules and completed the production build.
- `npx playwright test tests/render/v09-composition.spec.ts tests/render/v08-composition.spec.ts --project=chromium --workers=1`: PASS, 3/3 (two frozen v0.8 cases and v0.9 Node/Chromium parity).
- `npm run test:production-smoke:prebuilt`: one pre-existing v0.8 smoke failed after 120 seconds while waiting for hard-coded option `tail_none`; v0.8 catalog `0.8.0` does not contain that ID. The failure occurred before any Task 10/v0.9 path and the unrelated smoke/catalog files were not changed.
- Scoped `git diff --check`: PASS (line-ending conversion warnings only).
- Active pointer audit: absent.

## Commit

- Message: `feat: expose v0.9 in creator and catalog report`.
