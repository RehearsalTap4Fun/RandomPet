# Pixel Body and Eye Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `slender-tall` body and `sleepy-almond` eyes as independent phenotype traits, produce four flat source bodies, and publish a reproducible v2 candidate pixel pack with seven new review combinations.

**Architecture:** Preserve all v1 schemas and artifacts. Add parallel v2 phenotype, catalog and appearance contracts with mandatory `eyes`; art remains a complete body PNG selected by `body + coat + eyes + expression`. Rendering stays `pixel-rgba-v1`. The v2 candidate ports the 14 approved v1 appearances as `eyes: round`, then adds seven pending appearances for 21 exact coverage entries.

**Tech Stack:** TypeScript 7, Zod 4, Vitest, React 19, Sharp, esbuild, Playwright, built-in image generation, Nutri intake/replay tools.

**Spec:** `docs/superpowers/specs/2026-09-16-pixel-body-eye-batch-design.md`

## Global Constraints

- Work on `master`; preserve unrelated `docs/art/mutation-batch1/generation-transfer.json`.
- Do not modify v1 catalogs, revisions, appearances or the existing 14 RGBA hashes.
- Add `eyes` only through `feline-phenotype-v2`, `pixel-art-catalog-v2` and `feline-appearance-v2`.
- Use IDs `round`, `sleepy-almond` and `slender-tall` exactly.
- Fix this batch to `orange-white + small-fangs`; no new coats, colors, mouths or mutations.
- Generate four 1254×1254 solid-magenta assets with one built-in image generation call per asset. Copy each selected final into the workspace.
- Candidate version is `1.2.0-candidate.1`; approved `1.2.0` requires later explicit art approval.
- `rendererVersion` stays `pixel-rgba-v1`; composition changes require a new design.
- The v2 candidate contains 21 coverage entries: 14 ported approved/generatable entries plus 7 new pending entries.
- Nutri runtime remains disabled; cross-repository work is replay and exchange-file handoff only.

---

### Task 1: Add v2 Phenotype, Catalog and Appearance Contracts

**Files:**
- Create: `packages/generator-core/src/feline-phenotype-v2.ts`
- Create: `packages/generator-core/src/feline-phenotype-v2.test.ts`
- Modify: `packages/generator-core/src/index.ts`
- Create: `packages/asset-catalog/src/pixel-art-catalog-v2.ts`
- Create: `packages/asset-catalog/src/pixel-art-catalog-v2.test.ts`
- Modify: `packages/asset-catalog/src/index.ts`
- Modify: `packages/incubator-adapter/src/pixel-art-sdk.ts`

**Interfaces:**
- Consumes: existing `FelinePhenotype`, `PixelArtPlan`, `PixelOperation`, `PixelResource`, `canonicalJson` and legacy adapter.
- Produces: `FelinePhenotypeV2`, `parseFelinePhenotypeV2`, `phenotypeV2FromV1`, `phenotypeV2FromLegacy`, `phenotypeKeyV2`, `PixelArtCatalogV2`, `requirePixelArtCatalogV2`, `resolvePixelArtV2`, `pixelArtKeyV2`, `savePixelAppearanceV2`, `restorePixelAppearanceV2`, `generatablePixelPhenotypesV2`.

- [ ] **Step 1: Write failing phenotype v2 tests**

Use hand-written expected data:

```ts
expect(phenotypeV2FromV1(v1)).toEqual({
  schemaVersion: 'feline-phenotype-v2', body: 'standard', coat: 'orange-white', eyes: 'round',
  expression: 'small-fangs', crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
})
expect(phenotypeKeyV2(sleepy)).toBe('["standard","orange-white","sleepy-almond","small-fangs","none","none","none","none","none"]')
expect(parseFelinePhenotypeV2({ ...sleepy, png: 'cat.png' }).ok).toBe(false)
```

- [ ] **Step 2: Run the phenotype test and confirm RED**

Run `npx vitest run packages/generator-core/src/feline-phenotype-v2.test.ts`.

Expected: FAIL because the v2 module and exports do not exist.

- [ ] **Step 3: Implement the strict v2 phenotype**

```ts
export const PHENOTYPE_TRAITS_V2 = [
  'body', 'coat', 'eyes', 'expression', 'crown', 'ears', 'neck', 'back', 'tailTip',
] as const

export const felinePhenotypeV2Schema = z.strictObject({
  schemaVersion: z.literal('feline-phenotype-v2'),
  body: traitIdSchema, coat: traitIdSchema, eyes: traitIdSchema, expression: traitIdSchema,
  crown: traitIdSchema, ears: traitIdSchema, neck: traitIdSchema, back: traitIdSchema, tailTip: traitIdSchema,
})
```

`phenotypeV2FromV1` parses v1, copies all traits and inserts `eyes: 'round'`. `phenotypeV2FromLegacy` calls the existing legacy adapter and then `phenotypeV2FromV1`; it never samples traits.

- [ ] **Step 4: Write failing catalog v2 tests**

Build a literal one-profile fixture selected by `standard/orange-white/sleepy-almond/small-fangs`. Assert exact operation output, duplicate selector rejection, unsupported eye rejection, v2 appearance save/restore, and v1 appearance rejection:

```ts
expect(resolvePixelArtV2(phenotype, catalog).operations).toEqual([
  { kind: 'draw', resource: 'body', target: 'subject', occlusion: [] },
])
expect(savePixelAppearanceV2(phenotype, catalog).schemaVersion).toBe('feline-appearance-v2')
expect(() => restorePixelAppearanceV2(v1Appearance, catalog)).toThrow()
```

- [ ] **Step 5: Run the catalog test and confirm RED**

Run `npx vitest run packages/asset-catalog/src/pixel-art-catalog-v2.test.ts`.

Expected: FAIL because v2 catalog APIs do not exist.

- [ ] **Step 6: Implement the parallel v2 catalog**

Reuse v1 resource, point, polygon and step validation without widening. Define:

```ts
const profileV2 = z.strictObject({
  id, body: id, coat: id, eyes: id, expression: id,
  steps: z.array(step).length(6),
})
```

Set schema literals to `pixel-art-catalog-v2`, `feline-phenotype-v2`, and `feline-appearance-v2`. Profile uniqueness and coverage matching use `[body, coat, eyes, expression]`. Return the existing `PixelArtPlan`, so composition code remains unchanged.

- [ ] **Step 7: Run focused GREEN verification**

```powershell
npx vitest run packages/generator-core/src/feline-phenotype-v2.test.ts packages/asset-catalog/src/pixel-art-catalog-v2.test.ts
npm run typecheck
```

Expected: both test files pass and TypeScript exits 0.

- [ ] **Step 8: Commit the contracts**

```powershell
git add packages/generator-core/src/feline-phenotype-v2.ts packages/generator-core/src/feline-phenotype-v2.test.ts packages/generator-core/src/index.ts packages/asset-catalog/src/pixel-art-catalog-v2.ts packages/asset-catalog/src/pixel-art-catalog-v2.test.ts packages/asset-catalog/src/index.ts packages/incubator-adapter/src/pixel-art-sdk.ts
git commit -m "feat: add eye-aware feline phenotype and pixel catalog v2"
```

### Task 2: Produce Four Body Source Assets

**Files:**
- Create: `docs/art/flat-source-trial/stage3/solid/orange-white-round-small-fangs-slender-tall.png`
- Create: `docs/art/flat-source-trial/stage3/solid/orange-white-sleepy-almond-small-fangs-standard.png`
- Create: `docs/art/flat-source-trial/stage3/solid/orange-white-sleepy-almond-small-fangs-shortleg-round.png`
- Create: `docs/art/flat-source-trial/stage3/solid/orange-white-sleepy-almond-small-fangs-slender-tall.png`
- Create as needed: `docs/art/flat-source-trial/stage3/attempts/*.png`
- Create: `docs/art/flat-source-trial/stage3/generation.json`
- Create: `docs/art/flat-source-trial/stage3/revisions.json`

**Interfaces:**
- Consumes: stage2 standard and shortleg 1254px bodies; built-in image generation edit workflow.
- Produces: four selected 1254px solid-magenta sources and exact prompt/provenance records.

- [ ] **Step 1: Inspect both local edit targets**

Use `view_image` on the stage2 standard and shortleg body PNGs. Record face center, eye bounds, ear tips, paws, tail, outline weight and background as edit invariants.

- [ ] **Step 2: Generate standard sleepy-almond**

Use one built-in image generation call with the standard body as edit target:

```text
Use case: precise-object-edit. Asset type: 1254x1254 game sprite production source.
Change only the two eyes from large round eyes to calm half-lidded almond eyes. Each eye has a horizontal almond opening, gently lowered upper eyelid, visible teal iris, dark pupil and exactly one white highlight. Keep both eyes open enough to survive 64px downsampling.
Preserve everything outside the two eye regions: exact silhouette, head, ears, orange-white markings, nose, small-fang mouth, paws, tail, colors, outlines, coordinates and uniform #FF00FF background. No eyebrows, mouth change, extra marks, gradient, texture, shadow or text. Output exactly 1254x1254.
```

If non-eye regions drift or eyes collapse to lines, save the result under `attempts/` and issue one targeted correction.

- [ ] **Step 3: Generate shortleg sleepy-almond**

Use one call with the shortleg body as edit target and the same eye definition. Explicitly preserve squat body, broad low haunches, small low paws, face, mouth, tail and background.

- [ ] **Step 4: Generate slender-tall round-eye**

Use one call with the standard body as edit target/reference:

```text
Use case: precise-object-edit. Asset type: 1254x1254 game sprite production source.
Redesign only the kitten body proportions into a slender tall seated type: lengthen the visible front legs, narrow torso and haunches, and make both ears modestly larger. Keep a cute seated pose, one right-side tail, centered placement and similar overall canvas occupancy.
Preserve orange-white palette and marking layout, large round teal eyes, nose and exaggerated two-small-fang mouth. Keep hard-edged cel shading and dark outlines. At 64px the silhouette must differ from standard and shortleg without becoming adult, skeletal or standing. Uniform #FF00FF background; no ground, shadow, text, gradient, fur texture or extra limbs. Output exactly 1254x1254.
```

Reject outputs with merged legs, missing paws, duplicate tail, cropped ears or face drift.

- [ ] **Step 5: Generate slender-tall sleepy-almond**

Load the selected slender round image with `view_image`, then make one eye-only edit using Step 2's eye definition. Repeat that silhouette, body, ears, coat, mouth, tail, coordinates and background stay unchanged.

- [ ] **Step 6: Save finals and provenance**

Copy each selected built-in output into its exact `solid/` path. Write `generation.json` with schema `pixel-body-eye-generation-v1`, tool, edit target, exact prompt, final path and lowercase SHA-256 for all four items. Write only real retries to `revisions.json`; use `{"items":[]}` if no retry occurred.

- [ ] **Step 7: Run source checks**

Use Sharp to assert 1254×1254, four corners exactly `#FF00FF`, and hashes equal `generation.json`. Run Nutri `--check` for the two same-body eye edits. Compare slender round vs slender sleepy outside recorded eye rectangles; require silhouette IoU ≥ 0.98 and centroid delta ≤ 1 source-scaled pixel at 64px.

- [ ] **Step 8: Commit source candidates**

```powershell
git add docs/art/flat-source-trial/stage3
git commit -m "art: add slender body and sleepy eye source candidates"
```

### Task 3: Pixelize Sources and Calibrate Three Profiles

**Files:**
- Create: `scripts/review-pixel-stage3.mjs`
- Create: `docs/art/flat-source-trial/stage3/profiles.json`
- Create: `docs/qa/flat-source-trial/stage3/report.json`
- Create: `docs/qa/flat-source-trial/stage3/index.html`
- Create: `docs/qa/flat-source-trial/stage3/comparison.png`
- Create: `docs/qa/flat-source-trial/stage3/layers/<profile>/*.png`
- Create: `docs/qa/flat-source-trial/stage3/samples/*.png`
- Create: `docs/qa/flat-source-trial/stage3/README.md`

**Interfaces:**
- Consumes: four sources, v1.1.0 mutation layers, Nutri flat pixelizer at or after `9868de3`.
- Produces: four 64px body layers, three profile families, seven candidate RGBA hashes and gallery.

- [ ] **Step 1: Create profile data and failing validation**

Create three profile entries in order `standard`, `shortleg-round`, `slender-tall`. The script first asserts each has canvas 1254, pixelSize 64, two ear-clear polygons, a tail polygon and a face occlusion polygon. Run `node scripts/review-pixel-stage3.mjs`; expect FAIL before all body mappings exist.

- [ ] **Step 2: Pixelize with approved Nutri semantics**

Compile the referenced Nutri pixelizer with `NUTRI_DIR` override. Use key threshold 90, erosion 3, flat median/palette settings, transparent one-pixel border, 64px output and binary alpha. Missing any of the four named sources is fatal; no plush fallback.

- [ ] **Step 3: Calibrate slender geometry**

Measure the selected slender body and set independent ear transform, mane transform, ear clear, tail clear and face occlusion. Standard/shortleg may begin from verified geometry but must be rechecked. Save before/after composites. Do not publish placeholder coordinates copied from another body.

- [ ] **Step 4: Render the exact seven cases**

Render these IDs with full v2 phenotype and `review: pending`:

```text
standard-sleepy-base
shortleg-sleepy-base
slender-round-base
slender-sleepy-base
standard-sleepy-ears-mane
shortleg-sleepy-horns-flame
slender-sleepy-stack
```

Save 64px PNG and 128px/256px nearest-neighbor previews. Store PNG/RGBA SHA-256, profileId and full phenotype.

- [ ] **Step 5: Assert image behavior**

Assert 64×64, binary alpha, deterministic replay and unchanged inputs. Require eye-only variants to match body alpha outside recorded eye rectangles. Mane samples must preserve the same eyes/nose/mouth pixels as no-mane samples. Replacement parts must clear old ears/tail and retain opaque pixels outside the body silhouette.

- [ ] **Step 6: Build and inspect gallery**

Show the seven candidates plus existing standard/shortleg round controls at 64/128/256px, with deep/light background toggle. Include comparisons for standard round→sleepy, shortleg round→sleepy, slender round→sleepy and the three body silhouettes. Capture `browser-preview.png`; verify all images load and inspect eyes, teeth, paws, tail and layer order.

- [ ] **Step 7: Commit QA candidate**

```powershell
git add scripts/review-pixel-stage3.mjs docs/art/flat-source-trial/stage3/profiles.json docs/qa/flat-source-trial/stage3
git commit -m "test(art): validate body and eye pixel combinations"
```

### Task 4: Build the v2 Candidate Pack and Preserve v1

**Files:**
- Create: `scripts/build-pixel-art-v2.mjs`
- Modify: `package.json`
- Create: `packages/asset-catalog/pixel/v2/catalog.candidate.json`
- Create: `packages/asset-catalog/pixel/v2/provenance.json`
- Create: `packages/asset-catalog/pixel/v2/assets/*.png`
- Create: `packages/asset-catalog/src/pixel-art-catalog-v2-release.test.ts`
- Modify: `packages/renderer-canvas/src/pixel-art-render.test.ts`

**Interfaces:**
- Consumes: approved v1.1.0 catalog and stage3 report/profile.
- Produces: v2 candidate with 21 coverage entries and 14 generatable entries.

- [ ] **Step 1: Write failing release tests**

```ts
expect(catalog.schemaVersion).toBe('pixel-art-catalog-v2')
expect(catalog.artVersion).toBe('1.2.0-candidate.1')
expect(catalog.coverage).toHaveLength(21)
expect(catalog.generatable).toHaveLength(14)
expect(catalog.coverage.filter(c => c.review === 'pending').map(c => c.id)).toEqual([
  'standard-sleepy-base', 'shortleg-sleepy-base', 'slender-round-base', 'slender-sleepy-base',
  'standard-sleepy-ears-mane', 'shortleg-sleepy-horns-flame', 'slender-sleepy-stack',
])
```

For every ported entry, assert v2 phenotype equals v1 plus `eyes: round` and rendered RGBA hash equals the v1 hash.

- [ ] **Step 2: Run release test and confirm RED**

Run `npx vitest run packages/asset-catalog/src/pixel-art-catalog-v2-release.test.ts`.

Expected: FAIL because the v2 candidate file is absent.

- [ ] **Step 3: Implement v2 build**

```js
const migrated = v1.coverage.map(entry => ({
  ...entry,
  phenotype: phenotypeV2FromV1(entry.phenotype),
  profileId: `${entry.profileId}-round`,
}))
const coverage = [...migrated, ...stage3.samples]
const generatable = migrated.map(entry => entry.id)
```

Port used v1 profiles with `eyes: round`; add stage3 profiles. Deduplicate PNGs by SHA-256. Pin v1 revision, stage3 source/profile/report/script hashes. Compute revision from canonical JSON without revision and validate using `requirePixelArtCatalogV2`.

- [ ] **Step 4: Integrate build commands**

```json
{
  "build:pixel": "node scripts/build-pixel-art.mjs && node scripts/build-pixel-art-v2.mjs",
  "build": "npm run build:pixel && npm run typecheck && npm run build -w @qmonster/creator-web && node scripts/build-hatchery.mjs"
}
```

Copy v2 candidate to `dist/pixel-art/v2-candidate/`; leave current v1 output directories unchanged.

- [ ] **Step 5: Run replay and reproducibility tests**

```powershell
npm run build:pixel
npx vitest run packages/asset-catalog/src/pixel-art-catalog-v2-release.test.ts packages/renderer-canvas/src/pixel-art-render.test.ts
```

Hash catalog, provenance and assets; rebuild and assert byte-identical output. Save hashes to `docs/qa/flat-source-trial/stage3/reproducibility.json`.

- [ ] **Step 6: Commit candidate pack**

```powershell
git add scripts/build-pixel-art-v2.mjs package.json packages/asset-catalog/pixel/v2 packages/asset-catalog/src/pixel-art-catalog-v2-release.test.ts packages/renderer-canvas/src/pixel-art-render.test.ts docs/qa/flat-source-trial/stage3/reproducibility.json
git commit -m "feat: build eye-aware pixel art candidate 1.2.0"
```

### Task 5: Extend Workbench and Browser Verification

**Files:**
- Modify: `apps/creator-web/src/pixel-workbench.tsx`
- Modify: `apps/creator-web/src/pixel-workbench.css`
- Modify: `docs/integration/examples/pixel-art.html`
- Create: `scripts/verify-pixel-art-v2.mjs`
- Create: `docs/qa/pixel-body-eye-batch/report.json`
- Create: `docs/qa/pixel-body-eye-batch/pixel-workbench.png`
- Create: `docs/qa/pixel-body-eye-batch/portable-consumer.png`

**Interfaces:**
- Consumes: v1 and v2 bundle APIs.
- Produces: one workbench that keeps v1 replay while exposing v2 candidates and v2 appearance export.

- [ ] **Step 1: Normalize bundle differences without casting v1 to v2**

Create an internal `WorkbenchBundle` with `coverage`, `generatableCount`, `render`, `save`, `restore` and `key`. Each v1/v2 adapter calls its matching parser and functions.

- [ ] **Step 2: Add v2 candidate and labels**

Display `候选包 1.2.0 · 21 个组合`. Add:

```ts
const bodyLabels = { standard: '标准体型', 'shortleg-round': '短腿圆身', 'slender-tall': '修长高挑' }
const eyeLabels = { round: '圆眼', 'sleepy-almond': '半眯杏仁眼' }
```

Keep seven entries visibly pending and excluded from the generatable count.

- [ ] **Step 3: Dispatch appearance import by schema**

Use v2 restore for `feline-appearance-v2`, matching v1 restore for `feline-appearance-v1`, and `phenotypeV2FromLegacy` for legacy combination specs. Reject unknown versions and unsupported exact combinations without changing the canvas.

- [ ] **Step 4: Write browser verification**

`verify-pixel-art-v2.mjs` clicks all 21 v2 entries and compares native canvas RGBA; exports slender sleepy stack at 64/128px; reloads an appearance-v2; proves a v1 appearance still replays; rejects wrong revision and unsupported eyes; runs the relocated consumer with one v1 and one v2 sample; captures screenshots and JSON report.

- [ ] **Step 5: Run browser and legacy regressions**

```powershell
npm run build
node scripts/verify-pixel-art-v2.mjs
npm run verify:workbench
```

Expected: 21/21 v2 browser replays and unchanged v1/plush workbench behavior.

- [ ] **Step 6: Commit UI and evidence**

```powershell
git add apps/creator-web/src/pixel-workbench.tsx apps/creator-web/src/pixel-workbench.css docs/integration/examples/pixel-art.html scripts/verify-pixel-art-v2.mjs docs/qa/pixel-body-eye-batch
git commit -m "feat(web): review body and eye pixel candidates"
```

### Task 6: Document, Verify and Hand Off

**Files:**
- Modify: `docs/integration/pixel-art.md`
- Create: `docs/art/flat-source-trial/stage3/README.md`
- Modify: `docs/integration/nutri-codex-exchange.md`
- Modify: `docs/superpowers/plans/2026-09-16-pixel-body-eye-batch.md`

**Interfaces:**
- Consumes: final v2 revision, counts, hashes and verification output.
- Produces: production record, Claude handoff and user review entry; no 1.2.0 approval before user review.

- [ ] **Step 1: Document v2 contract and art results**

Record mandatory eyes, v1→v2 round migration, four-part profile selector, 21/14/7 counts, revision, resource count, unsupported behavior and unchanged renderer. Stage3 README records all four prompts, retries, hashes, profile decisions and automated results; it states that technical replay is not art approval.

- [ ] **Step 2: Run final verification**

```powershell
npm test
npm run build
npm run verify:pixel
node scripts/verify-pixel-art-v2.mjs
git diff --check
```

Expected: tests, build and both browser suites pass with no whitespace errors.

- [ ] **Step 3: Update and directly push exchange-file handoff**

Append QMonster commit, v2 version/revision, coverage/resource counts, unchanged renderer, seven pending IDs and Nutri replay command. State runtime remains disabled. Fetch first, preserve Claude text, then commit and push this exchange update under the user's standing authorization.

- [ ] **Step 4: Present gallery for explicit art review**

Open `/pixel` with v2 candidate selected and provide the QA link. Ask only whether seven pending combinations pass or need targeted corrections. Do not create approved 1.2.0 before an explicit answer.

- [ ] **Step 5: Commit remaining docs and checked plan**

```powershell
git add docs/integration/pixel-art.md docs/art/flat-source-trial/stage3/README.md docs/superpowers/plans/2026-09-16-pixel-body-eye-batch.md
git commit -m "docs: document pixel body and eye candidate"
```

## Self-Review Record

- Spec coverage: phenotype/art separation, four sources, seven candidates, v1 replay, QA, UI, Nutri handoff and exclusions each map to a task.
- Placeholder scan: implementation steps contain exact interfaces, commands, expected failures and output paths; runtime-measured hashes and geometry are defined outputs of their producing steps.
- Type consistency: v2 API names match Tasks 1, 4 and 5; renderer consumes unchanged `PixelArtPlan`; version strings match the spec.
- Scope: this plan stops at candidate review. Promotion to 1.2.0 is a later bounded task after explicit art approval.
