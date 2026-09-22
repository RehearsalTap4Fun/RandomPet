# Pixel Scene Backdrop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a separately versioned 96×64 scene contract and candidate package for the three approved doodle backdrops, with a fixed 64×64 cat anchor, deterministic outline semantics, nine representative QA scenes, and the handoff needed for Nutri to extend growth from 15 to 18 stages.

**Architecture:** Keep the existing `feline-phenotype-v2`, `pixel-art-catalog-v3`, `pixel-rgba-v1`, and 35,840 cat coverage rows unchanged. Add a scene state and scene catalog beside them, then compose the already-rendered 64×64 cat over an outlined 96×64 backdrop with `pixel-scene-rgba-v1`. Build candidate and approved scene artifacts from the three already-approved PNG bytes; use nine scene samples for visual QA and cross-repository replay instead of multiplying the cat coverage grid.

**Tech Stack:** TypeScript 7, Zod 4, Vitest 4, Node.js 22 ESM, Sharp 0.35, esbuild 0.28, deterministic JSON/SHA-256 tooling already used by the pixel catalog pipeline.

**Spec:** `docs/superpowers/specs/2026-09-22-pixel-scene-backdrop-design.md`

## Global Constraints

- Preserve `feline-phenotype-v2`, `pixel-art-catalog-v3`, `pixel-rgba-v1`, all 63 cat resources, and all 35,840 approved/generatable 1.6.1 coverage rows byte-for-byte.
- Scene canvas is exactly 96×64; subject input is exactly 64×64 and anchored at `(16,0)`.
- Growth order is exactly `none → doodle-horizon (N) → doodle-leaf-shadow (R) → doodle-rainbow-trail (L)`.
- Scene state stores semantic backdrop IDs only; it never stores resource paths, hashes, or renderer parameters.
- Scene resources are separate 96×64 resources and must be byte-for-byte copies of the three approved files under `docs/qa/pixel-backdrop-batch/layers/`.
- `pixel-scene-rgba-v1` owns the only backdrop outline: four-neighbor, one pass, 1px, adjacent RGB mean × `0.36`, rounded per channel, alpha 255.
- Scene mode always returns 96×64, including `backdrop: none`; the legacy cat renderer continues returning 64×64.
- Candidate version is `1.0.0-candidate.1`; approved version is `1.0.0`.
- Visual QA is exactly nine representative scenes plus one automated `none` case; do not enumerate `35,840 × 4` scene combinations.
- Do not alter the approved artwork, add a color axis, change Nutri growth probabilities, or enable/publish a Nutri runtime from QMonster.

## Review Focus

- A damaged old save with a present but unknown `backdrop` must fail; only a truly missing field migrates to `none` (Task 1 tests both paths).
- A future cat pack with the same 64×64 contract should pass compatibility even when its art version changes; a different schema, renderer, or size must fail (Task 1 tests all four fields).
- Outline pixels must come only from the original backdrop, so diagonal contact and newly created outline pixels cannot grow a second ring (Task 2 pins exact pixel coordinates and RGB values).
- `none` must still center the cat in a transparent 96×64 scene, without mutating its RGBA bytes (Task 2 tests bounds, byte identity, and input immutability).
- Candidate and approved builds must never rewrite the source PNGs or the 1.6.1 cat package, even on repeated builds (Tasks 3 and 6 compare exact bytes and known identities).

---

## File Structure

### New contract files

- `packages/generator-core/src/pixel-scene-state.ts` — strict scene state schema, migration, type, and stable key.
- `packages/generator-core/src/pixel-scene-state.test.ts` — state parsing and migration tests.
- `packages/asset-catalog/src/pixel-scene-catalog.ts` — strict scene catalog schema, reference checks, revision verification, subject compatibility, and backdrop lookup.
- `packages/asset-catalog/src/pixel-scene-catalog.test.ts` — catalog validation and compatibility tests.

### New renderer files

- `packages/renderer-canvas/src/pixel-scene-render.ts` — pure rectangular RGBA compositor and browser resource loader.
- `packages/renderer-canvas/src/pixel-scene-render.test.ts` — exact outline, anchoring, failure, and immutability tests.
- `packages/incubator-adapter/src/pixel-scene-sdk.ts` — additive portable SDK entry point used by Node QA and Nutri.

### Candidate/release pipeline

- `scripts/build-pixel-scene-backdrops.mjs` — immutable candidate catalog, assets, provenance, and dist builder.
- `scripts/review-pixel-scene-backdrops.mjs` — nine-scene renderer, report, and static review page builder.
- `scripts/pixel-scene-backdrops-approval.mjs` — approval evidence validator used only after visual approval and Nutri replay.
- `scripts/build-pixel-scene-backdrops-approved.mjs` — formal 1.0.0 promotion builder.
- `packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts` — candidate and approved artifact invariants.
- `packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/` — candidate/approved catalogs, provenance, and content-addressed 96×64 assets.
- `dist/pixel-scene/backdrop-candidate/` and `dist/pixel-scene/backdrop-approved-1.0.0/` — portable handoff bundles.

### QA and handoff

- `docs/qa/pixel-scene-backdrops/report.json` — exact inputs, nine scene hashes, visible-pixel counts, and package identity.
- `docs/qa/pixel-scene-backdrops/index.html` — nearest-neighbor review page.
- `docs/qa/pixel-scene-backdrops/samples/01.png` through `09.png` — representative scene outputs.
- `docs/qa/pixel-scene-backdrops/approval.json` — immutable user visual-approval evidence created after the candidate page is accepted.
- `docs/qa/pixel-scene-backdrops/nutri-replay.json` — separate immutable evidence copied from Claude/Nutri's exact candidate replay result.
- `docs/integration/nutri-codex-exchange.md` — exact candidate and approved handoff records.

### Existing exports/configuration

- `packages/generator-core/src/index.ts` — export the scene state API.
- `packages/asset-catalog/src/index.ts` — export the scene catalog API without changing existing exports.
- `packages/renderer-canvas/src/index.ts` — export the scene renderer API.
- `package.json` — add focused build/review scripts and append only the candidate builder to `build:pixel`; approved promotion remains explicit.

---

### Task 1: Add strict scene state and catalog contracts

**Files:**
- Create: `packages/generator-core/src/pixel-scene-state.ts`
- Create: `packages/generator-core/src/pixel-scene-state.test.ts`
- Modify: `packages/generator-core/src/index.ts`
- Create: `packages/asset-catalog/src/pixel-scene-catalog.ts`
- Create: `packages/asset-catalog/src/pixel-scene-catalog.test.ts`
- Modify: `packages/asset-catalog/src/index.ts`

**Interfaces:**
- Consumes: `canonicalJson(value)` from `packages/generator-core/src/canonical-json.ts`; `PixelArtCatalogV3` metadata from `packages/asset-catalog/src/pixel-art-catalog-v3.ts`.
- Produces: `BackdropId`, `PixelSceneStateV1`, `requirePixelSceneStateV1(input)`, `migratePixelSceneStateV1(input)`, `pixelSceneStateKey(state)`, `PixelSceneCatalogV1`, `requirePixelSceneCatalogV1(input)`, `verifyPixelSceneCatalogV1(input)`, `requireSceneSubjectCompatibility(scene, subject)`, and `resolveBackdrop(state, catalog)`.

- [ ] **Step 1: Write failing state tests**

Create `packages/generator-core/src/pixel-scene-state.test.ts` with these cases:

```ts
import { describe, expect, it } from 'vitest'
import { migratePixelSceneStateV1, pixelSceneStateKey, requirePixelSceneStateV1 } from './pixel-scene-state.js'

describe('pixel-scene-state-v1', () => {
  it.each(['none', 'doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'] as const)('accepts %s', backdrop => {
    const state = { schemaVersion: 'pixel-scene-state-v1' as const, backdrop }
    expect(requirePixelSceneStateV1(state)).toEqual(state)
    expect(pixelSceneStateKey(state)).toBe(JSON.stringify(['pixel-scene-state-v1', backdrop]))
  })

  it('migrates only a missing backdrop to none', () => {
    expect(migratePixelSceneStateV1({})).toEqual({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' })
    expect(() => migratePixelSceneStateV1({ backdrop: 'unknown' })).toThrow(/backdrop/i)
    expect(() => migratePixelSceneStateV1({ backdrop: null })).toThrow(/backdrop/i)
  })

  it('rejects unknown fields and schema versions', () => {
    expect(() => requirePixelSceneStateV1({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'none', path: 'x.png' })).toThrow()
    expect(() => requirePixelSceneStateV1({ schemaVersion: 'pixel-scene-state-v2', backdrop: 'none' })).toThrow()
  })
})
```

- [ ] **Step 2: Run the state test and confirm the missing module failure**

Run:

```powershell
npx vitest run packages/generator-core/src/pixel-scene-state.test.ts
```

Expected: FAIL because `pixel-scene-state.ts` does not exist.

- [ ] **Step 3: Implement the state contract and export it**

Create `pixel-scene-state.ts` with a strict Zod enum and explicit migration guard:

```ts
import { z } from 'zod'
import { canonicalJson } from './canonical-json.js'

export const backdropIdSchema = z.enum(['none', 'doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'])
export type BackdropId = z.infer<typeof backdropIdSchema>

export const pixelSceneStateV1Schema = z.strictObject({
  schemaVersion: z.literal('pixel-scene-state-v1'),
  backdrop: backdropIdSchema,
})
export type PixelSceneStateV1 = z.infer<typeof pixelSceneStateV1Schema>

export const requirePixelSceneStateV1 = (input: unknown): PixelSceneStateV1 => pixelSceneStateV1Schema.parse(input)

export function migratePixelSceneStateV1(input: unknown): PixelSceneStateV1 {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid scene state.')
  if (Object.hasOwn(input, 'backdrop')) {
    return requirePixelSceneStateV1({ schemaVersion: 'pixel-scene-state-v1', backdrop: (input as Record<string, unknown>).backdrop })
  }
  return { schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' }
}

export const pixelSceneStateKey = (state: PixelSceneStateV1): string =>
  canonicalJson(['pixel-scene-state-v1', requirePixelSceneStateV1(state).backdrop])
```

Append `export * from './pixel-scene-state.js'` to `packages/generator-core/src/index.ts`.

- [ ] **Step 4: Write failing catalog tests**

Create a `validCatalog()` fixture in `pixel-scene-catalog.test.ts` with exact literals from the spec, three resources, three backdrop mappings, candidate review state, empty `generatable`, and a revision computed from canonical JSON. Test:

```ts
it('validates references, growth order and candidate review state', async () => {
  const catalog = await verifyPixelSceneCatalogV1(validCatalog())
  expect(catalog.canvas).toEqual({ width: 96, height: 64 })
  expect(catalog.growth.order).toEqual(['doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'])
  expect(resolveBackdrop({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' }, catalog)).toBeNull()
  expect(resolveBackdrop({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'doodle-horizon' }, catalog)?.resourceId).toBe('scene-a')
})

it.each([
  (c: any) => { c.canvas.width = 64 },
  (c: any) => { c.subject.anchor.x = 0 },
  (c: any) => { c.outline.factor = 0.5 },
  (c: any) => { c.growth.order.reverse() },
  (c: any) => { c.backdrops['doodle-horizon'].resourceId = 'missing' },
  (c: any) => { c.generatable = ['doodle-horizon'] },
])('rejects invalid scene contracts', mutate => {
  const input = validCatalog(); mutate(input)
  expect(() => requirePixelSceneCatalogV1(input)).toThrow()
})

it('accepts compatible future art and rejects incompatible subject contracts', () => {
  const scene = requirePixelSceneCatalogV1(validCatalog())
  expect(() => requireSceneSubjectCompatibility(scene, {
    schemaVersion: 'pixel-art-catalog-v3', rendererVersion: 'pixel-rgba-v1', size: 64,
    artVersion: '2.0.0', revision: 'f'.repeat(64),
  })).not.toThrow()
  for (const subject of [
    { schemaVersion: 'pixel-art-catalog-v2', rendererVersion: 'pixel-rgba-v1', size: 64 },
    { schemaVersion: 'pixel-art-catalog-v3', rendererVersion: 'pixel-rgba-v2', size: 64 },
    { schemaVersion: 'pixel-art-catalog-v3', rendererVersion: 'pixel-rgba-v1', size: 96 },
  ]) expect(() => requireSceneSubjectCompatibility(scene, subject as any)).toThrow(/subject/i)
})
```

- [ ] **Step 5: Implement the catalog schema and semantic checks**

Use `z.strictObject` throughout. Define entries as:

```ts
type SceneResource = { path: string; sha256: string; width: 96; height: 64 }
type BackdropEntry = {
  resourceId: string
  rarity: 'N' | 'R' | 'L'
  growthRank: 1 | 2 | 3
  review: 'pending' | 'approved'
}
```

The strict `subject` object contains `schemaVersion: 'feline-phenotype-v2'` and `catalogSchemaVersion: 'pixel-art-catalog-v3'` as separate fields, followed by the renderer, dimensions, and anchor from the spec. Compatibility checks compare the actual cat catalog's `schemaVersion` with `catalogSchemaVersion`; the scene subject's `schemaVersion` records the phenotype contract used by that catalog.

Require exactly the three backdrop keys, the matching rarity/rank tuple, unique resource references, exact growth order, and these promotion rules:

```ts
const pending = Object.entries(catalog.backdrops).filter(([, entry]) => entry.review === 'pending').map(([id]) => id)
for (const id of catalog.generatable) {
  if (catalog.backdrops[id as Exclude<BackdropId, 'none'>]?.review !== 'approved') {
    throw new Error(`Unapproved generatable backdrop: ${id}`)
  }
}
if (catalog.sceneVersion.includes('-candidate.') && (!pending.length || catalog.generatable.length)) {
  throw new Error('Candidate scene must keep pending backdrops out of generatable.')
}
```

`verifyPixelSceneCatalogV1` must remove `revision`, hash `canonicalJson(content)` with Web Crypto, compare the lowercase SHA-256, and return the parsed catalog. `requireSceneSubjectCompatibility` compares only `schemaVersion`, `rendererVersion`, and `size`; it does not require the validated 1.6.1 art identity. `resolveBackdrop` returns `null` for `none` and otherwise returns the validated entry plus resource.

Append `export * from './pixel-scene-catalog.js'` to `packages/asset-catalog/src/index.ts`.

- [ ] **Step 6: Run focused and type tests**

Run:

```powershell
npx vitest run packages/generator-core/src/pixel-scene-state.test.ts packages/asset-catalog/src/pixel-scene-catalog.test.ts
npm run typecheck
```

Expected: both test files PASS and TypeScript reports no errors.

- [ ] **Step 7: Commit the contract**

```powershell
git add packages/generator-core/src packages/asset-catalog/src
git commit -m "feat(pixel): add scene backdrop contracts"
```

---

### Task 2: Implement the deterministic 96×64 scene renderer

**Files:**
- Create: `packages/renderer-canvas/src/pixel-scene-render.ts`
- Create: `packages/renderer-canvas/src/pixel-scene-render.test.ts`
- Modify: `packages/renderer-canvas/src/index.ts`
- Create: `packages/incubator-adapter/src/pixel-scene-sdk.ts`

**Interfaces:**
- Consumes: `PixelSceneStateV1`, `PixelSceneCatalogV1`, `requireSceneSubjectCompatibility`, `resolveBackdrop`, and subject metadata shaped as `Pick<PixelArtCatalogV3, 'schemaVersion' | 'rendererVersion' | 'size' | 'artVersion' | 'revision'>`.
- Produces: `outlineSceneBackdrop(source)`, `composePixelScene(state, catalog, subjectCatalog, subjectPixels, layers)`, `verifyScenePng(bytes, resource)`, and `loadPixelScene(catalog, subjectCatalog, resourceUrl)`.

- [ ] **Step 1: Write exact renderer tests**

Build a small test fixture by creating 96×64 transparent backdrop pixels with two adjacent opaque pixels and a 64×64 cat with one opaque pixel. Pin these behaviors:

```ts
it('draws one four-neighbor outline ring with adjacent-mean darkening', () => {
  const src = new Uint8ClampedArray(96 * 64 * 4)
  put(src, 10, 10, [100, 50, 25, 255]); put(src, 11, 10, [200, 100, 50, 255])
  const out = outlineSceneBackdrop(src)
  expect(get(out, 10, 9)).toEqual([36, 18, 9, 255])
  expect(get(out, 10, 11)).toEqual([36, 18, 9, 255])
  expect(get(out, 9, 9)).toEqual([0, 0, 0, 0])
  expect(get(out, 10, 8)).toEqual([0, 0, 0, 0])
  expect(get(out, 10, 10)).toEqual([100, 50, 25, 255])
})

it('centers a none scene at x=16 without mutating the cat', () => {
  const cat = new Uint8ClampedArray(64 * 64 * 4); put64(cat, 0, 0, [9, 8, 7, 255])
  const before = new Uint8ClampedArray(cat)
  const scene = composePixelScene({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' }, catalog, subject, cat, {})
  expect(scene).toHaveLength(96 * 64 * 4)
  expect(get(scene, 16, 0)).toEqual([9, 8, 7, 255])
  expect(get(scene, 15, 0)).toEqual([0, 0, 0, 0])
  expect(cat).toEqual(before)
})

it('draws the cat over both backdrop and outline', () => {
  // Put backdrop color and its outline under subject coordinate (16,0), then assert cat RGBA wins exactly.
})

it.each([
  ['wrong cat length', new Uint8ClampedArray(4), validLayers],
  ['missing backdrop', validCat, {}],
  ['wrong backdrop length', validCat, { 'scene-a': new Uint8ClampedArray(4) }],
  ['nonbinary backdrop alpha', validCat, nonbinaryLayers],
])('fails closed on %s', (_label, cat, layers) => {
  expect(() => composePixelScene(horizonState, catalog, subject, cat, layers)).toThrow()
})
```

Also test incompatible subject metadata, nonbinary subject alpha, an unknown state, and input array immutability.

- [ ] **Step 2: Run the renderer test and confirm the missing module failure**

```powershell
npx vitest run packages/renderer-canvas/src/pixel-scene-render.test.ts
```

Expected: FAIL because `pixel-scene-render.ts` does not exist.

- [ ] **Step 3: Implement pure scene composition**

Use named constants `SCENE_WIDTH = 96`, `SCENE_HEIGHT = 64`, `SUBJECT_WIDTH = 64`, `SUBJECT_HEIGHT = 64`, `SUBJECT_X = 16`, and `SUBJECT_Y = 0`. Implement the outline loop from the approved QA semantics:

```ts
export function outlineSceneBackdrop(source: Uint8ClampedArray): Uint8ClampedArray {
  requireBinaryPixels(source, SCENE_WIDTH, SCENE_HEIGHT, 'backdrop')
  const output = new Uint8ClampedArray(source)
  for (let y = 0; y < SCENE_HEIGHT; y++) for (let x = 0; x < SCENE_WIDTH; x++) {
    const offset = (y * SCENE_WIDTH + x) * 4
    if (source[offset + 3]) continue
    let red = 0, green = 0, blue = 0, count = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextX = x + dx, nextY = y + dy
      if (nextX < 0 || nextX >= SCENE_WIDTH || nextY < 0 || nextY >= SCENE_HEIGHT) continue
      const next = (nextY * SCENE_WIDTH + nextX) * 4
      if (!source[next + 3]) continue
      red += source[next]!; green += source[next + 1]!; blue += source[next + 2]!; count++
    }
    if (count) output.set([
      Math.round(red / count * 0.36),
      Math.round(green / count * 0.36),
      Math.round(blue / count * 0.36),
      255,
    ], offset)
  }
  return output
}
```

`composePixelScene` must parse state/catalog, validate subject compatibility, validate binary alpha on both inputs, clone the selected backdrop before outlining, and write each nontransparent cat pixel to `((y + 0) * 96 + (x + 16)) * 4`. Never call the 64×64 cat outline function.

- [ ] **Step 4: Implement verified loading and the portable SDK entry**

`verifyScenePng` mirrors `verifyPixelPng` but checks the resource-declared rectangular width and height. `loadPixelScene` must verify the canonical catalog revision before fetching, verify each resource SHA-256 before decode, decode on a 96×64 canvas with color conversion and premultiplication disabled, reject decoded dimension or alpha mismatch, and return:

```ts
{
  catalog: structuredClone(catalog),
  render: (state: PixelSceneStateV1, subjectPixels: Uint8ClampedArray) =>
    composePixelScene(state, catalog, subjectCatalog, subjectPixels, layers),
}
```

Export the file from `packages/renderer-canvas/src/index.ts`. Create `packages/incubator-adapter/src/pixel-scene-sdk.ts` as an additive entry point exporting scene state, scene catalog, `canonicalJson`, and the scene renderer functions. Do not edit `pixel-art-sdk-v3.ts`.

- [ ] **Step 5: Run focused, full, and type checks**

```powershell
npx vitest run packages/renderer-canvas/src/pixel-scene-render.test.ts packages/asset-catalog/src/pixel-scene-catalog.test.ts
npm test
npm run typecheck
```

Expected: focused tests, the existing full suite, and TypeScript all PASS.

- [ ] **Step 6: Commit the renderer**

```powershell
git add packages/renderer-canvas/src packages/incubator-adapter/src/pixel-scene-sdk.ts
git commit -m "feat(pixel): add rectangular scene renderer"
```

---

### Task 3: Build the immutable 1.0.0 candidate scene package

**Files:**
- Create: `scripts/build-pixel-scene-backdrops.mjs`
- Create: `packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts`
- Modify: `package.json`
- Generate: `packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/catalog.candidate.json`
- Generate: `packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/provenance.candidate.json`
- Generate: `packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/assets/*.png`
- Generate: `dist/pixel-scene/backdrop-candidate/catalog.json`
- Generate: `dist/pixel-scene/backdrop-candidate/provenance.json`
- Generate: `dist/pixel-scene/backdrop-candidate/assets/*.png`

**Interfaces:**
- Consumes: the three approved PNGs and approval evidence, `approved-1.6.1/catalog.approved.json`, `canonicalJson`, and `requirePixelSceneCatalogV1`.
- Produces: immutable `1.0.0-candidate.1` scene catalog with three pending backdrops, zero generatable entries, three content-addressed assets, and exact provenance.

- [ ] **Step 1: Write the failing candidate release test**

In `pixel-scene-backdrop-release.test.ts`, assert:

```ts
it('builds the separate three-resource candidate without changing the cat package', () => {
  expect(existsSync(sceneRoot + 'catalog.candidate.json')).toBe(true)
  const scene = requirePixelSceneCatalogV1(json(sceneRoot + 'catalog.candidate.json'))
  const catBytes = readFileSync(catRoot + 'catalog.approved.json')
  const cat = requirePixelArtCatalogV3(JSON.parse(catBytes.toString()))
  expect(scene.sceneVersion).toBe('1.0.0-candidate.1')
  expect(scene.rendererVersion).toBe('pixel-scene-rgba-v1')
  expect(scene.canvas).toEqual({ width: 96, height: 64 })
  expect(scene.subject.anchor).toEqual({ x: 16, y: 0 })
  expect(Object.keys(scene.resources)).toHaveLength(3)
  expect(Object.values(scene.backdrops).every(item => item.review === 'pending')).toBe(true)
  expect(scene.generatable).toEqual([])
  expect(cat.artVersion).toBe('1.6.1')
  expect(cat.revision).toBe('c622a13cb4f045edaa1fe8efc133d312bcb62f78414d75d8bc58a17d78f69ddf')
  expect(cat.coverage).toHaveLength(35_840)
  expect(Object.keys(cat.resources)).toHaveLength(63)
  expect(sha(catBytes)).toBe('76eec3381d1d09bbbf2a1883e5812818c76b474d0944c13d68f5ade89abaa804')
})
```

For each scene resource, compare package bytes with the matching approved source file, verify the three known SHA-256 values, and verify `width: 96`, `height: 64`. Recompute `revision` from canonical catalog content. Add negative tests for an altered source byte and an attempt to overwrite an existing immutable output.

- [ ] **Step 2: Run the release test and confirm the missing artifact failure**

```powershell
npx vitest run packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts
```

Expected: FAIL because the candidate catalog is absent.

- [ ] **Step 3: Implement the candidate builder**

Use these exact source entries:

```js
const backdrops = [
  { id: 'doodle-horizon', rarity: 'N', growthRank: 1, source: 'docs/qa/pixel-backdrop-batch/layers/doodle-horizon.png', sha256: '2f4eaff9b6ed478dadfcaff7ae9828b4a3c076d2bea5dd988e9628cffdbc604b' },
  { id: 'doodle-leaf-shadow', rarity: 'R', growthRank: 2, source: 'docs/qa/pixel-backdrop-batch/layers/doodle-leaf-shadow.png', sha256: 'f6acae86a1a7c92ab13e2b9d23e21613b499d204bf0045747038b4f636e7f471' },
  { id: 'doodle-rainbow-trail', rarity: 'L', growthRank: 3, source: 'docs/qa/pixel-backdrop-batch/layers/doodle-rainbow-trail.png', sha256: '17821cc32d36b65167393f802c313b595d4ec2d28b7b82e4ce20ea9d9820f872' },
]
```

Bundle `pixel-scene-sdk.ts` with esbuild, decode each source with Sharp to confirm dimensions/binary alpha, name each packaged resource `scene-${sha256.slice(0, 16)}.png`, and write the exact original bytes. Build catalog content with:

```js
{
  schemaVersion: 'pixel-scene-catalog-v1',
  sceneVersion: '1.0.0-candidate.1',
  rendererVersion: 'pixel-scene-rgba-v1',
  canvas: { width: 96, height: 64 },
  subject: { schemaVersion: 'feline-phenotype-v2', catalogSchemaVersion: 'pixel-art-catalog-v3', rendererVersion: 'pixel-rgba-v1', width: 64, height: 64, anchor: { x: 16, y: 0 } },
  outline: { owner: 'scene-renderer', neighborhood: 'four', width: 1, color: 'adjacent-mean-darken', factor: 0.36 },
  resources,
  backdrops,
  growth: { slot: 'backdrop', order: ['doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'] },
  validatedSubject: { artVersion: '1.6.1', revision: 'c622a13cb4f045edaa1fe8efc133d312bcb62f78414d75d8bc58a17d78f69ddf' },
  generatable: [],
  evidence,
}
```

Set `revision = sha(canonicalJson(content))`. Provenance status is `candidate-visual-validation`, `runtimeEnabled: false`, `validationMode: representative-scene-samples`, and records the source approval, three source hashes, cat catalog path/hash/revision, scene catalog identity, and exact build inputs.

Before writing, compare every existing output byte and throw ``Immutable artifact changed: ${file}`` on mismatch. For missing files, create parent directories and write with `{ flag: 'wx' }`.

- [ ] **Step 4: Add focused package scripts**

Add:

```json
"build:pixel-scene": "node scripts/build-pixel-scene-backdrops.mjs",
"review:pixel-scene": "node scripts/review-pixel-scene-backdrops.mjs",
"build:pixel-scene-approved": "node scripts/build-pixel-scene-backdrops-approved.mjs"
```

Append `&& npm run build:pixel-scene` to `build:pixel`. Do not append the approved builder.

- [ ] **Step 5: Build twice and run the candidate tests**

```powershell
npm run build:pixel-scene
$first = Get-FileHash -Algorithm SHA256 'packages\asset-catalog\pixel\scene\v1\backdrop-1.0.0\catalog.candidate.json'
npm run build:pixel-scene
$second = Get-FileHash -Algorithm SHA256 'packages\asset-catalog\pixel\scene\v1\backdrop-1.0.0\catalog.candidate.json'
if ($first.Hash -ne $second.Hash) { throw 'Scene candidate is not reproducible' }
npx vitest run packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts
```

Expected: both hashes match and the release test PASSes.

- [ ] **Step 6: Commit the candidate package**

```powershell
git add package.json scripts/build-pixel-scene-backdrops.mjs packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0 dist/pixel-scene/backdrop-candidate
git commit -m "feat(pixel): build scene backdrop candidate"
```

---

### Task 4: Generate the nine-scene QA page

**Files:**
- Create: `scripts/review-pixel-scene-backdrops.mjs`
- Generate: `docs/qa/pixel-scene-backdrops/report.json`
- Generate: `docs/qa/pixel-scene-backdrops/index.html`
- Generate: `docs/qa/pixel-scene-backdrops/samples/01.png` through `09.png`
- Modify: `packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts`

**Interfaces:**
- Consumes: the scene candidate, the approved 1.6.1 cat catalog and assets, `resolvePixelArtV3`, `composePixelArt`, and `composePixelScene`.
- Produces: nine deterministic 96×64 PNGs and a machine-readable report suitable for exact Nutri replay.

- [ ] **Step 1: Extend the release test with the exact QA matrix**

The report must contain these nine rows in this order:

```js
const samples = [
  ['doodle-horizon', 'standard', 'orange-white', 'round', 'parted-mouth', 'none', 'none', 'none', 'none', 'none'],
  ['doodle-horizon', 'shortleg-round', 'orange-white', 'round', 'small-fangs', 'antlers', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip'],
  ['doodle-horizon', 'standard', 'tuxedo', 'sleepy-almond', 'parted-mouth', 'crystal-horns', 'feathered-ears', 'sunburst-ruff', 'dragon-wings', 'phoenix-tail'],
  ['doodle-leaf-shadow', 'standard', 'brown-tabby', 'sleepy-almond', 'small-fangs', 'none', 'none', 'none', 'none', 'none'],
  ['doodle-leaf-shadow', 'slender-tall', 'orange-white', 'sleepy-almond', 'small-fangs', 'halo', 'celestial-ears', 'frill-neck', 'feathered-wings', 'flame-tail'],
  ['doodle-leaf-shadow', 'standard', 'colorpoint', 'round', 'small-fangs', 'dragon-horns', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip'],
  ['doodle-rainbow-trail', 'standard', 'calico', 'round', 'parted-mouth', 'none', 'none', 'none', 'none', 'none'],
  ['doodle-rainbow-trail', 'standard', 'rosetted', 'sleepy-almond', 'small-fangs', 'crystal-horns', 'celestial-ears', 'sunburst-ruff', 'dragon-wings', 'phoenix-tail'],
  ['doodle-rainbow-trail', 'standard', 'orange-white', 'round', 'parted-mouth', 'antlers', 'feathered-ears', 'frill-neck', 'feathered-wings', 'flame-tail'],
]
```

The fields after expression map to `crown`, `ears`, `neck`, `back`, and `tailTip`. Assert three samples per backdrop, all three bodies and all six coats covered, at least one plain and one high-occlusion sample per backdrop, unique phenotype+backdrop keys, 96×64 PNG dimensions, and report hashes matching the actual PNG/RGBA bytes. The seven standard samples cover the coat spread; the one shortleg and one slender sample use the only coat those bodies currently support, `orange-white`.

Also compose `backdrop: none` with sample 01 in memory and assert that it is not written as a tenth QA PNG, remains 96×64, and equals the cat centered at `(16,0)`.

- [ ] **Step 2: Run the test and confirm the missing report failure**

```powershell
npx vitest run packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts
```

Expected: FAIL because `docs/qa/pixel-scene-backdrops/report.json` is absent.

- [ ] **Step 3: Implement the QA builder**

Bundle `pixel-art-sdk-v3.ts` and `pixel-scene-sdk.ts` separately with esbuild. Load all cat and scene PNGs with Sharp and verify their declared SHA-256 before decode. For each fixed sample:

1. Build a complete `feline-phenotype-v2` object.
2. Resolve and compose the unchanged 64×64 cat.
3. Compose the selected `pixel-scene-state-v1` into 96×64.
4. Save a palette PNG with binary alpha and no dithering.
5. Record sample ID, backdrop, full phenotype, cat coverage ID, cat RGBA SHA-256, scene RGBA SHA-256, PNG SHA-256, scene file, and the count of original backdrop pixels still visible after the cat covers the center.

The report must identify candidate scene version/revision/catalog hash, source cat version/revision/catalog hash, both renderer versions, canvas/anchor, outline semantics, the nine samples, and the automated `none` case hash. Set `status: candidate-visual-review` and `runtimeEnabled: false`.

Generate a static page with three sections (N/R/L), three cards per section, 3× nearest-neighbor previews, native 96×64 previews, semantic labels, phenotype text, and a light/dark page background toggle. Do not load scripts or assets from the network.

- [ ] **Step 4: Build twice and verify deterministic QA**

```powershell
npm run review:pixel-scene
$before = Get-ChildItem 'docs\qa\pixel-scene-backdrops' -Recurse -File | Sort-Object FullName | ForEach-Object { "$(Get-FileHash -Algorithm SHA256 $_.FullName | Select-Object -ExpandProperty Hash) $($_.FullName)" }
npm run review:pixel-scene
$after = Get-ChildItem 'docs\qa\pixel-scene-backdrops' -Recurse -File | Sort-Object FullName | ForEach-Object { "$(Get-FileHash -Algorithm SHA256 $_.FullName | Select-Object -ExpandProperty Hash) $($_.FullName)" }
if (Compare-Object $before $after) { throw 'Scene QA is not reproducible' }
npx vitest run packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts packages/renderer-canvas/src/pixel-scene-render.test.ts
```

Expected: the two manifests are identical and all focused tests PASS.

- [ ] **Step 5: Open the review page and stop for visual approval**

Open `docs/qa/pixel-scene-backdrops/index.html` in the Codex browser. Ask the user to inspect the nine samples for backdrop visibility, coat contrast, part overflow, and stable centering. Do not create `approval.json`, contact Nutri, or build the approved package until the user explicitly approves this page.

- [ ] **Step 6: Commit the candidate QA after approval**

```powershell
git add scripts/review-pixel-scene-backdrops.mjs packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts docs/qa/pixel-scene-backdrops
git commit -m "test(pixel): add scene backdrop candidate QA"
```

---

### Task 5: Record approval and request Nutri candidate replay

**Files:**
- Create: `docs/qa/pixel-scene-backdrops/approval.json`
- Modify: `docs/integration/nutri-codex-exchange.md`

**Interfaces:**
- Consumes: the exact user approval statement, candidate catalog/provenance/report bytes, and nine sample hashes.
- Produces: immutable visual approval evidence and a remote handoff containing every input Nutri needs for replay.

- [ ] **Step 1: Create approval evidence from the accepted page**

Write `pixel-scene-backdrop-approval-v1` with:

```json
{
  "schemaVersion": "pixel-scene-backdrop-approval-v1",
  "approvedAt": "2026-09-22",
  "userStatement": "ok",
  "scope": {
    "sceneVersion": "1.0.0-candidate.1",
    "backdrops": 3,
    "samples": 9,
    "canvas": [96, 64],
    "subjectAnchor": [16, 0],
    "interpretation": "Approve the separate scene contract and the exact nine representative outputs; do not expand the cat coverage grid."
  },
  "candidate": {},
  "evidence": {}
}
```

The JSON above illustrates the currently most likely approval text. At execution time, set `approvedAt` to the local ISO date of the actual visual decision and set `userStatement` to the exact immediately preceding user message, without translation, punctuation changes, or inferred wording. Populate `candidate` with path, version, revision, catalog SHA-256, provenance path/hash, and populate `evidence` with the report, page, three source PNGs, and nine sample hashes.

- [ ] **Step 2: Append the exact Nutri replay request**

Add a dated exchange entry that states:

- candidate path and dist path;
- scene version/revision/catalog SHA-256;
- exact 1.6.1 subject revision;
- three resource paths and SHA-256 values;
- `96×64`, `(16,0)`, and complete outline semantics;
- the nine report rows are the only requested visual replay set;
- automated `none` hash must also match;
- Nutri must separately check old-save migration, rectangular web/mini-program display/export, the sixth growth slot, and `maxGrowthSteps() === 18`;
- runtime deployment remains outside this candidate replay request.

- [ ] **Step 3: Validate evidence identities and repository state**

```powershell
npm run build:pixel-scene
npm run review:pixel-scene
npx vitest run packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts packages/renderer-canvas/src/pixel-scene-render.test.ts
npm run typecheck
git diff --check
git status --short
```

Expected: all checks PASS; only the intended approval/exchange changes remain uncommitted.

- [ ] **Step 4: Commit and push the replay handoff**

```powershell
git add docs/qa/pixel-scene-backdrops/approval.json docs/integration/nutri-codex-exchange.md
git commit -m "docs(exchange): request scene backdrop replay"
git push origin master
```

The remote push is part of the approved cross-device handoff. Stop after the push and wait for Claude/Nutri to record the exact replay result; do not promote on silence or a partial result.

---

### Task 6: Promote replayed backdrops to formal scene 1.0.0

**Files:**
- Create: `scripts/pixel-scene-backdrops-approval.mjs`
- Create: `scripts/build-pixel-scene-backdrops-approved.mjs`
- Modify: `packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts`
- Create: `docs/qa/pixel-scene-backdrops/nutri-replay.json`
- Generate: `packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/catalog.approved.json`
- Generate: `packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/provenance.approved.json`
- Generate: `dist/pixel-scene/backdrop-approved-1.0.0/catalog.json`
- Generate: `dist/pixel-scene/backdrop-approved-1.0.0/provenance.json`
- Generate: `dist/pixel-scene/backdrop-approved-1.0.0/assets/*.png`
- Modify: `docs/integration/nutri-codex-exchange.md`

**Interfaces:**
- Consumes: immutable user approval evidence and a separate Claude/Nutri replay identity copied from the exchange file.
- Produces: formal scene 1.0.0 with all three backdrops approved/generatable, immutable assets, formal provenance, and a final Nutri package handoff.

- [ ] **Step 1: Extend the release test for formal promotion**

Add assertions that formal output is absent until replay evidence is present, then pins:

```ts
expect(approved.sceneVersion).toBe('1.0.0')
expect(approved.resources).toEqual(candidate.resources)
expect(approved.backdrops).toEqual(Object.fromEntries(
  Object.entries(candidate.backdrops).map(([id, entry]) => [id, { ...entry, review: 'approved' }]),
))
expect(approved.generatable).toEqual(['doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'])
expect(provenance).toMatchObject({ status: 'approved', runtimeEnabled: false, replay: { samplesPassed: 9, samplesFailed: 0, nonePassed: true } })
```

Recompute formal revision, compare all three asset bytes with candidate and source bytes, and verify that the approval validator rejects altered user text, candidate bytes, report bytes, sample bytes, or replay identity.

- [ ] **Step 2: Implement the approval validator**

Create `nutri-replay.json` by copying the structured identities and results from Claude's exchange reply without paraphrasing. `validatePixelSceneBackdropApproval(approvalBytes, replayBytes, context)` must pin the independent approval and replay SHA-256 values, require exact candidate identity, require the user statement recorded in Task 5, validate every evidence hash, and require the replay object to contain:

```js
{
  repository: 'Nutri',
  commit: /^[0-9a-f]{7,40}$/,
  sceneRevision: candidate.revision,
  subjectRevision: 'c622a13cb4f045edaa1fe8efc133d312bcb62f78414d75d8bc58a17d78f69ddf',
  samplesPassed: 9,
  samplesFailed: 0,
  nonePassed: true,
  migrationPassed: true,
  webRectangularExportPassed: true,
  miniProgramRectangularExportPassed: true,
  maxGrowthSteps: 18
}
```

Every field must be supported by Claude's recorded exchange response; never infer a passing field from silence or general prose. The original `approval.json` must remain byte-for-byte unchanged.

- [ ] **Step 3: Implement the approved builder**

Read and validate the candidate, candidate provenance, report, assets, and final approval. Build approved content by changing only:

- `sceneVersion` from `1.0.0-candidate.1` to `1.0.0`;
- each backdrop `review` from `pending` to `approved`;
- `generatable` from `[]` to the exact growth-order array;
- `evidence` by adding the immutable user approval hash and the separate Nutri replay hash.

Recompute revision from canonical content. Formal provenance records candidate identity, the separate approval and replay identities, three approved resources, `runtimeEnabled: false`, and `validationMode: representative-scene-samples`. Copy candidate asset bytes without decoding or re-encoding. Use the same immutable compare-before-write behavior as the candidate builder.

- [ ] **Step 4: Build twice and run full verification**

```powershell
npm run build:pixel-scene-approved
$first = Get-FileHash -Algorithm SHA256 'packages\asset-catalog\pixel\scene\v1\backdrop-1.0.0\catalog.approved.json'
npm run build:pixel-scene-approved
$second = Get-FileHash -Algorithm SHA256 'packages\asset-catalog\pixel\scene\v1\backdrop-1.0.0\catalog.approved.json'
if ($first.Hash -ne $second.Hash) { throw 'Approved scene is not reproducible' }
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: identical formal catalog hashes, full tests PASS, typecheck PASS, full build PASS, and no changes to the 1.6.1 cat package.

- [ ] **Step 5: Record the formal handoff**

Append a dated exchange entry with formal scene version/revision/catalog SHA-256, three asset hashes, user approval hash, Nutri replay hash, QMonster verification results, and the exact formal dist path. State that the package is approved and generatable but QMonster still does not claim Nutri deployment; Nutri must switch from candidate to formal bytes and report its deployed web build and mini-program version separately.

- [ ] **Step 6: Commit and push the formal release**

```powershell
git add scripts/pixel-scene-backdrops-approval.mjs scripts/build-pixel-scene-backdrops-approved.mjs packages/asset-catalog/src/pixel-scene-backdrop-release.test.ts packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0 dist/pixel-scene/backdrop-approved-1.0.0 docs/qa/pixel-scene-backdrops/nutri-replay.json docs/integration/nutri-codex-exchange.md
git commit -m "feat(pixel): promote scene backdrops to 1.0.0"
git push origin master
```

Expected: remote `master` contains formal scene 1.0.0 and the exchange handoff; the worktree is clean.

---

## Final Verification Checklist

- [ ] `npm test` passes the full repository suite.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes and includes the candidate scene build without invoking formal promotion.
- [ ] Candidate and approved scene artifacts rebuild byte-for-byte.
- [ ] Three packaged scene assets equal their approved source bytes and hashes.
- [ ] Formal scene catalog has three approved/generatable backdrops in N→R→L order.
- [ ] `none` and all three backdrops return 96×64 with subject anchor `(16,0)`.
- [ ] The nine QA outputs replay exactly in QMonster and Nutri.
- [ ] Nutri reports missing-field migration to `none`, 18 maximum growth steps, and rectangular web/mini-program export checks.
- [ ] `approved-1.6.1` still has revision `c622a13cb4f045edaa1fe8efc133d312bcb62f78414d75d8bc58a17d78f69ddf`, 63 resources, and 35,840 approved/generatable coverage rows.
- [ ] `git diff --check` passes and `git status --short` is clean after the final push.
