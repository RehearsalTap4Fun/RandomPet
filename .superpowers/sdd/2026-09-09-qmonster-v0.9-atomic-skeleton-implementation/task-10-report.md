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
- Round-1 review RED added unchanged-key manifest-body tampering, swapped sealed/approval identities, content-addressed family/template cross-wiring, active-entrypoint activation/downgrade protection, real default-resolver PNG identity, and both neutral whole-skeleton images. The new assertions initially produced seven targeted failures while the 31 existing assertions in those suites remained green.
- Resolver boundary closure: the production resolver reads the exact content-ID resource, parses and CRC-checks the PNG, decodes the required profile-free 2048x2048 straight RGBA8 representation, verifies the decoded-content digest, and materializes a drawable without browser image normalization. JSON resources are fatal-UTF-8 parsed and canonical-hash verified. Promise caches evict failures and returned pixel/JSON values do not expose mutable cached identity.
- Final focused GREEN: the expanded Task 10 Vitest command passed 8 files and 92/92 tests.

## Implementation

- Added browser-safe asynchronous `loadActiveProductionRelease()`: it reads only an actual or explicitly supplied pointer, canonical-hash verifies the exact manifest body, traverses only exact content refs, validates strict pool/family/template/graph/inventory/approval schemas and cross-bindings, enforces the `0.4.0/0.9.0/0.9.0` tuple, resolves 312 sealed projections and their approvals by identity rather than ordering, and fails closed on tamper, swaps, missing refs, or mismatches.
- Production Creator and catalog-report entrypoints now share `loadProductionBootstrap()`. Only an absent active pointer preserves v0.8; any present-but-invalid pointer fails closed, and Task 12 can activate v0.9 solely by adding the pointer. Candidate loading remains an explicit opt-in.
- Added `AnyMonsterSpec`, a version-isolated v0.9 Creator session, complete structure/release identity persistence, strict restore targeting, and mixed-tuple rejection.
- Added the v0.9 Creator path with one whole-skeleton lock/reroll and exactly twelve appearance controls. It uses the existing deterministic v0.9 generation/reroll functions and fixed 21-node renderer path; no structural body/head/limb/tail controls or transform/connector path is exposed.
- Updated `PreviewCanvas` for exact legacy/v0.9 dispatch, 2048 identity staging, a fail-closed production-default v0.9 resource resolver, stale-render protection, and correctly scaled cached frames. Extensionless content blobs are served as raw bytes in Vite development and emitted as production assets; validation remains on-demand.
- Added a live v0.9 report model derived from the resolved immutable inventory: both neutral whole-skeleton masters with exact hashes, 8:1 weights and assembly approval state, plus twelve 8/4/1 semantic slot groups, full-context previews, rarity, sealed hash, and attachment interface/shape class. Legacy report behavior remains in its original branch.
- Added the narrow Vitest project include needed for the plan-mandated `.test.ts` browser loader suite.

## Verification

- `npx vitest run apps/creator-web/src/v09-production-release.test.ts apps/creator-web/src/production-bootstrap.test.tsx apps/creator-web/src/production-catalog.test.tsx apps/creator-web/src/App.test.tsx apps/creator-web/src/state/persistence.test.ts apps/creator-web/src/components/PreviewCanvas.test.tsx apps/creator-web/src/catalog-report.test.tsx apps/creator-web/src/components/CatalogReport.test.tsx`: PASS, 8 files, 92/92 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; Vite transformed 7,457 modules and completed the production build. Content resources remain lazy/on-demand rather than being fetched at application startup.
- `npx playwright test tests/render/v09-composition.spec.ts tests/render/v08-composition.spec.ts tests/render/v09-production-preview.spec.ts --project=chromium --workers=1`: PASS, 4/4 (two frozen v0.8 cases, v0.9 Node/Chromium parity, and real `PreviewCanvas` production-default resolver rendering).
- `npm run test:production-smoke:prebuilt`: one pre-existing v0.8 smoke failed after 120 seconds while waiting for hard-coded option `tail_none`; v0.8 catalog `0.8.0` does not contain that ID. The failure occurred before any Task 10/v0.9 path and the unrelated smoke/catalog files were not changed.
- Scoped `git diff --check`: PASS (line-ending conversion warnings only).
- Active pointer audit: absent.

## Commit

- Initial message: `feat: expose v0.9 in creator and catalog report`.
- Round-1 review closure message: `fix: close v0.9 production integration review`.
