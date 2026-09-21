# Pixel Evolution Chain Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the five approved evolution-chain traits in a reproducible `1.6.0-candidate.1` pixel catalog while generating only 13 representative new combinations.

**Architecture:** Clone approved `1.5.0`, add five shared resources and their mappings to all 28 profiles, preserve the 8,064 approved base coverage rows byte-for-byte, and append 13 pending sampled rows. The candidate keeps the current runtime and legacy generator options unchanged; Nutri receives a compact candidate package plus exact sample evidence.

**Tech Stack:** Node.js 22, ES modules, Sharp, esbuild, Vitest, pixel-art-catalog-v3, pixel-rgba-v1.

**Spec:** `docs/qa/pixel-evolution-chains/approval.json`

## Global Constraints

- Use `master`, as explicitly authorized by the user for this project.
- Do not enumerate or render the theoretical 35,840 combinations.
- Keep all 8,064 approved `1.5.0` coverage records and generatable IDs unchanged.
- Add exactly 13 pending coverage rows covering all five new traits, all six coats, and all three bodies.
- Keep `rendererVersion: pixel-rgba-v1`, six profile steps, and `feline-phenotype-v2` unchanged.
- Do not modify current runtime selection options or enable the candidate in the app.
- `sunburst-ruff` must use `subject` plus the approved body-specific occlusion polygons.
- `phoenix-tail` must retain opaque left anchor `x=40`.

## Review Focus

- A profile misses one of the five new resource mappings: assert all 28 profiles expose every approved trait.
- A body receives the wrong sunburst mask: compare each profile variant to the approved mask for its body.
- Existing coverage or generatable ordering changes: deep-compare the base prefixes with `1.5.0`.
- A sample accidentally duplicates existing or sampled phenotype coverage: require unique phenotype keys and exactly 13 appended rows.
- A build starts enumerating the theoretical Cartesian product: assert candidate coverage is exactly `8064 + 13` and provenance records `validationMode: representative-samples`.

---

### Task 1: Pin the sampled candidate contract

**Files:**
- Create: `packages/asset-catalog/src/pixel-art-v3-evolution-chains.test.ts`
- Create: `scripts/build-pixel-art-v3-evolution-chains.mjs`
- Create: `packages/asset-catalog/pixel/v3/evolution-chains-1.6.0/catalog.candidate.json`
- Create: `packages/asset-catalog/pixel/v3/evolution-chains-1.6.0/provenance.json`
- Create: `packages/asset-catalog/pixel/v3/evolution-chains-1.6.0/assets/*.png`
- Create: `dist/pixel-art/v3-evolution-chains-candidate/catalog.json`
- Create: `dist/pixel-art/v3-evolution-chains-candidate/provenance.json`
- Create: `dist/pixel-art/v3-evolution-chains-candidate/assets/*.png`

**Interfaces:**
- Consumes: approved `1.5.0`, `pixel-evolution-chain-approval-v2`, `requirePixelArtCatalogV3`, and `composePixelArt`.
- Produces: immutable `1.6.0-candidate.1` with 28 profiles, 8,077 coverage rows, 8,064 generatable IDs, and 63 resources.

- [x] **Step 1: Write the failing catalog test**

The test must assert the exact counts above, base-prefix identity, five mappings on all profiles, three body-specific sunburst masks, 13 unique pending samples, and no runtime promotion.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run packages/asset-catalog/src/pixel-art-v3-evolution-chains.test.ts`

Expected: FAIL because the candidate catalog does not exist.

- [x] **Step 3: Implement the minimal deterministic candidate builder**

Copy base resources by verified SHA-256, import the five approved layer files by content-derived resource IDs, extend cloned profiles, append the fixed 13 phenotypes, compose only those 13 rows, and write package/dist artifacts without overwriting divergent immutable bytes.

- [x] **Step 4: Build and verify GREEN**

Run: `node scripts/build-pixel-art-v3-evolution-chains.mjs && npx vitest run packages/asset-catalog/src/pixel-art-v3-evolution-chains.test.ts`

Expected: PASS with `28 profiles / 8077 coverage / 13 sampled pending / 63 resources`.

### Task 2: Publish focused QA evidence

**Files:**
- Create: `docs/qa/pixel-evolution-chain-registration/index.html`
- Create: `docs/qa/pixel-evolution-chain-registration/report.json`
- Create: `docs/qa/pixel-evolution-chain-registration/samples/01.png` through `13.png`
- Create: `docs/qa/pixel-evolution-chain-registration/README.md`
- Create: `scripts/review-pixel-art-v3-evolution-chains.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the 13 pending rows and rendered RGBA produced by Task 1.
- Produces: a focused evidence page and a repeatable npm build entry; no full Cartesian render.

- [ ] **Step 1: Extend the failing test for QA evidence and sampling coverage**

Assert exactly 13 PNGs, all six coats, all three bodies, every new trait, three full-stack body samples, matching PNG/RGBA hashes, and `validationMode: representative-samples`.

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL because QA evidence is absent.

- [ ] **Step 3: Generate the report, page, samples, and npm script**

Add `build:pixel-evolution-chains` that runs only this candidate builder. The main `build:pixel` may call the new builder after existing immutable builds, but this task's verification command must use the focused script.

- [ ] **Step 4: Verify GREEN and deterministic rebuild**

Run the focused npm script twice and compare hashes for the catalog, provenance, report, page, and 13 PNGs.

### Task 3: Verify, commit, and hand off to Claude

**Files:**
- Modify: `docs/integration/nutri-codex-exchange.md`

**Interfaces:**
- Consumes: candidate revision, catalog SHA-256, profile/resource/sample counts, and validation results.
- Produces: an exact Nutri handoff requesting the same 13-row replay rather than a full combination sweep.

- [ ] **Step 1: Run final verification**

Run: focused candidate test, `npm test`, `npm run typecheck`, targeted interface test, and `git diff --check`.

- [ ] **Step 2: Commit candidate implementation**

Commit the candidate, builder, test, QA evidence, plan, and package script.

- [ ] **Step 3: Append the Claude handoff**

Record the implementation commit, candidate identity, the exact 13-sample scope, unchanged runtime/schema/renderer, and the request for a matching Nutri dry replay.

- [ ] **Step 4: Commit and push the exchange update**

Fetch first, preserve any concurrent remote exchange update, then push both commits to `origin/master`.
