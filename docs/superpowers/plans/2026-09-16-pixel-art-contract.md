# Pixel Art Contract Implementation Plan

**Post-implementation approval:** User subsequently confirmed “验收通过”. The ten stage-2 combinations are now approved in art version 1.1.0 (14 total generatable). The original 1.0.0 and candidate catalogs remain byte-identical for replay; the candidate-state references below describe the scope when this plan was executed. Approval record: `docs/qa/flat-source-trial/stage2/approval.json`. Post-approval validation: 110 tests, production build and browser verification passed.

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in this session. User explicitly requested development on master.

**Goal:** Deliver an independent pixel art bundle, phenotype contract, browser preview/export and consumer example without changing legacy random outcomes.

**Architecture:** Trait-only phenotype adapts already-resolved legacy selections. Versioned pixel catalog maps phenotype to body profiles, layer files, ordered compositing and masks. A pure RGBA renderer serves both browser and exported consumer SDK.

**Tech Stack:** Existing TypeScript, Zod, Vitest, React, Sharp, esbuild and Playwright.

**Spec:** `docs/art/2026-09-16-pixel-production-readiness.md`

## Global Constraints

- Work on master; preserve existing uncommitted art and unrelated generation-transfer.json.
- Preserve legacy source snapshot and RNG; new modules use explicit import paths.
- Keep Nutri tracked source unchanged; deliver a standalone consuming example.
- Native 64px, integer 128px export, binary alpha and deterministic replay.
- First four stage-1 combinations are approved; ten stage-2 combinations remain preview candidates.
- Missing coverage reports an error; no plush fallback in a pixel bundle.

## Task 1: Phenotype and coverage contract

Files: `packages/generator-core/src/feline-phenotype.ts`, its test; `packages/asset-catalog/src/pixel-art-catalog.ts`, its test.

Interfaces: `phenotypeFromLegacy(input)` preserves resolved selections and defaults body to standard. `parseFelinePhenotype(input)` rejects art fields. `resolvePixelArt(phenotype,catalog)` returns ordered operations only for declared coverage; `pixelArtKey` includes style/version/revision/body/all traits. Approved generation enumerates only the catalog's explicit generatable set.

- [x] Red: adapt an existing saved spec with deliberately overridden selections; require exact selections, detached data and default body. Reject art metadata inside phenotype.
- [x] Red: reject missing body, unknown resource, invalid polygon, unsupported combination and unapproved generation entry. Assert changed body/version/revision changes the key.
- [x] Green: strict schemas, referential validation, explicit coverage lookup and deterministic legacy adapter. No new RNG.
- [x] Run `npx vitest run packages/generator-core/src/feline-phenotype.test.ts packages/asset-catalog/src/pixel-art-catalog.test.ts`.

## Task 2: Resource bundle and shared pixel renderer

Files: `packages/renderer-canvas/src/pixel-art-render.ts`, its test; `scripts/build-pixel-art.mjs`; `packages/asset-catalog/pixel/v1/`.

Interfaces: `composePixelArt(plan,layers)` returns RGBA without mutating inputs. `loadPixelArt` verifies resource hashes/dimensions. Saved appearances pin phenotype plus art style/version/revision. Exported SDK uses the same resolver/renderer.

- [x] Red: compare rendered RGBA against four approved stage-1 hashes and ten adjusted stage-2 hashes; reject corrupted PNG/resource data.
- [x] Green: reproduce Nutri's four-neighbor 0.36 outline and two-surface compositing, using profile-defined clear/occlusion polygons.
- [x] Package only referenced flat layers; pin evidence/profile/input hashes. Build approved and candidate catalogs separately, marking candidate coverage precisely.
- [x] Verify reproducible manifests and samples; bundle browser SDK with esbuild into `dist/pixel-art`.

## Task 3: Preview, export, consumer example

Files: `apps/creator-web/src/pixel-workbench.tsx`, its CSS, minimal navigation in main.tsx; `docs/integration/pixel-art.md`; `scripts/verify-pixel-art.mjs`; package.json build scripts.

- [x] Add a pixel workbench route with exact supported sample selection, art-review labels, deep/light backgrounds, 64/128 transparent PNG export, pinned appearance JSON import/export and legacy spec import.
- [x] Keep legacy workbench route and storage key intact. Missing profile or mismatched art revision produces explicit diagnostics.
- [x] Build a consumer page that loads the exported catalog/SDK/PNGs from a relocatable folder and renders independently of the repository and Nutri checkout.
- [x] Playwright verifies actual downloads, image dimensions, catalog integrity, import rejection and preview/export byte equivalence. Verify legacy workbench still loads.
- [x] Run `npm test`, `npm run build`, and pixel consumer verification. Record actual counts and remaining art approval scope in docs.

## Completion

- [x] Self-review for legacy changes, release coverage, stale async rendering and portable URLs.
- [x] Show the working pixel preview and describe the separate Nutri integration step.
