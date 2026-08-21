# QMonster Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic browser-based fantasy creature generator that assembles 14 visual slots, projects them to the incubator's 8 semantic slots, previews them with Canvas 2D, and exports reproducible JSON plus transparent PNG/WebP.

**Architecture:** An npm-workspaces TypeScript monorepo separates deterministic generation, asset catalog validation, Canvas rendering, the React creator, and the incubator adapter. `MonsterSpec` is the only render contract; UI commands produce a new validated spec, and the renderer never performs random selection.

**Tech Stack:** Node.js 22.16.0, npm 10.9.2 workspaces, TypeScript 7, Vite 8, React 19, Zod 4, Vitest 4, fast-check 4, Playwright 1, Testing Library, Canvas 2D, Sharp.

**Spec:** `docs/superpowers/specs/2026-08-21-qmonster-creator-design.md`

## Global Constraints

- The v0.1 app is pure front end: no backend, account system, cloud sync, or collaboration.
- The public visual model has exactly 14 visual slots and exactly 8 incubator semantic slots.
- The v0.1 themes are exactly `deep-sea`, `fungal`, and `shadow`.
- The v0.1 rig families are exactly `blob`, `biped`, and `floating`.
- Global style is bright, rounded, tactile, friendly 3D cartoon; generated creatures must not enter horror-valley territory.
- Runtime rendering uses transparent PNG/WebP layers and Canvas 2D; SVG is limited to masks and positioning aids.
- PNG export is mandatory. WebP export must feature-detect and degrade with an explicit diagnostic.
- Local reroll to cached preview must stay at or below 150ms on the acceptance machine.
- 1024×1024 export must stay at or below 2 seconds on the acceptance machine.
- The release gate requires 20 consecutive visually accepted random creatures spanning all three themes and all three rig families.
- Chrome and Edge desktop are release browsers. Firefox and Safari must support generation and PNG export.
- Do not add seed-specific renderer patches. Fix the asset, anchor, compatibility rule, or catalog instead.
- Use TDD for every code task: failing test, observed failure, minimal implementation, passing test, then commit.

## Tooling References

- [Vite getting started](https://vite.dev/guide/)
- [Vite 8 Node.js support](https://vite.dev/blog/announcing-vite8)
- [Vitest test projects](https://vitest.dev/guide/projects)
- [Playwright web server](https://playwright.dev/docs/test-webserver)
- [Zod 4 schemas](https://zod.dev/api)
- [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)

---

## File Map

| Path | Responsibility |
| --- | --- |
| `package.json` | Workspace scripts and pinned dependency ranges |
| `tsconfig.base.json` | Strict shared TypeScript compiler options and source aliases |
| `tsconfig.json` | Project references for all packages and the app |
| `vitest.config.ts` | Node and jsdom test projects |
| `playwright.config.ts` | Chromium/Firefox/WebKit end-to-end projects and Vite server |
| `packages/generator-core/src/contracts.ts` | Slot IDs, `MonsterSpec`, catalog and diagnostic types |
| `packages/generator-core/src/schema.ts` | Zod schemas and transactional parse helpers |
| `packages/generator-core/src/test-fixtures.ts` | Valid `MonsterSpec` and minimal catalog factories shared by tests |
| `packages/generator-core/src/prng.ts` | Stable FNV-1a hash, Mulberry32 stream and weighted selection |
| `packages/generator-core/src/catalog-validation.ts` | Structural catalog validation independent of files |
| `packages/generator-core/src/generate.ts` | Theme, rarity, compatibility and weighted slot generation |
| `packages/generator-core/src/reroll.ts` | Lock-aware local reroll and manual selection |
| `packages/generator-core/src/projection.ts` | 14-to-8 semantic projection |
| `packages/generator-core/src/modifiers.ts` | Mutation and aberration overlays |
| `packages/asset-catalog/src/file-validation.ts` | Image, alpha, dimensions, path and hash checks |
| `packages/asset-catalog/src/load-catalog.ts` | Load and parse one versioned catalog |
| `packages/asset-catalog/src/catalog-registry.ts` | Resolve installed catalog versions for import and rendering |
| `packages/asset-catalog/src/cli.ts` | `npm run catalog:validate` command |
| `packages/asset-catalog/catalog/v0.1.0/*.json` | Themes, rigs, semantic traits, parts and modifiers |
| `packages/asset-catalog/assets/v0.1.0/` | Runtime transparent WebP/PNG layers and masks |
| `packages/asset-catalog/source-index.json` | Source prompt hash, locked base version and master-file checksum |
| `packages/renderer-canvas/src/layout.ts` | Socket/origin placement and allowed preset transforms |
| `packages/renderer-canvas/src/layers.ts` | Deterministic draw-order expansion |
| `packages/renderer-canvas/src/render.ts` | Canvas draw pipeline |
| `packages/renderer-canvas/src/export.ts` | PNG/WebP feature detection and Blob export |
| `packages/incubator-adapter/src/input.ts` | Incubator egg fields to `GenerationRequest` |
| `packages/incubator-adapter/src/output.ts` | `MonsterSpec` to legacy 8-slot record |
| `apps/creator-web/src/state/creator-reducer.ts` | Command-only editor state transitions |
| `apps/creator-web/src/state/persistence.ts` | localStorage session autosave |
| `apps/creator-web/src/components/GeneratorControls.tsx` | Theme, seed, mode and whole-creature generation |
| `apps/creator-web/src/components/PreviewCanvas.tsx` | Canvas preview and render diagnostics |
| `apps/creator-web/src/components/SlotPanel.tsx` | Lock, reroll and manual selection for 14 slots |
| `apps/creator-web/src/components/DiagnosticsPanel.tsx` | Blocking and degradation diagnostics |
| `apps/creator-web/src/io/spec-file.ts` | Transactional JSON import and JSON download |
| `apps/creator-web/src/io/image-file.ts` | Transparent PNG/WebP download |
| `tests/e2e/generator.spec.ts` | User workflow acceptance |
| `apps/creator-web/render-test.html` | Vite-served renderer regression harness |
| `apps/creator-web/src/render-test.ts` | Fixed-spec render entry point for browser regression |
| `tests/render/golden.spec.ts` | Browser decoded-pixel regression |
| `scripts/generate-acceptance-set.ts` | Deterministic 20-creature acceptance set |
| `docs/qa/v0.1-visual-acceptance.md` | Human visual gate evidence |

---

### Task 1: Workspace Foundation and `MonsterSpec` Contract

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `packages/generator-core/package.json`
- Create: `packages/generator-core/tsconfig.json`
- Create: `packages/generator-core/src/contracts.ts`
- Create: `packages/generator-core/src/schema.ts`
- Create: `packages/generator-core/src/test-fixtures.ts`
- Create: `packages/generator-core/src/schema.test.ts`
- Create: package manifests and `tsconfig.json` files for `renderer-canvas`, `asset-catalog`, `incubator-adapter`, and `creator-web`

**Interfaces:**
- Consumes: Design specification section 5.
- Produces: `VisualSlotId`, `SemanticSlotId`, `MonsterSpec`, `Catalog`, `Diagnostic`, `MonsterSpecSchema`, and `parseMonsterSpec(input: unknown): ParseResult<MonsterSpec>`.

- [ ] **Step 1: Create the npm workspace and install exact dependency lines**

Create the root `package.json` with these scripts and dependency versions:

```json
{
  "name": "qmonster-creator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "npm run dev -w @qmonster/creator-web",
    "build": "tsc -b && npm run build -w @qmonster/creator-web",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "catalog:validate": "npm run validate -w @qmonster/asset-catalog"
  },
  "dependencies": {
    "react": "~19.2.8",
    "react-dom": "~19.2.8",
    "zod": "~4.4.3"
  },
  "devDependencies": {
    "@playwright/test": "~1.62.1",
    "@testing-library/react": "~16.3.2",
    "@testing-library/user-event": "~14.6.5",
    "@types/node": "~22.20.1",
    "@types/react": "~19.2.18",
    "@types/react-dom": "~19.2.4",
    "@vitejs/plugin-react": "~6.1.0",
    "@vitest/coverage-v8": "~4.1.11",
    "fast-check": "~4.9.0",
    "jsdom": "~30.0.1",
    "sharp": "~0.35.3",
    "tsx": "~4.23.12",
    "typescript": "~7.0.2",
    "vite": "~8.2.2",
    "vitest": "~4.1.11"
  }
}
```

Run: `npm install`

Expected: `package-lock.json` is created and `npm ls --depth=0` exits 0.

Use these exact workspace package names: `@qmonster/generator-core`, `@qmonster/renderer-canvas`, `@qmonster/asset-catalog`, `@qmonster/incubator-adapter`, and `@qmonster/creator-web`. Every manifest is private, version `0.1.0`, and ESM. Each library exports `".": "./src/index.ts"`; generator-core additionally exports `"./test-fixtures": "./src/test-fixtures.ts"` for tests only. The creator manifest defines `"dev": "vite"` and `"build": "vite build"`; internal dependencies use version `"0.1.0"` so npm workspaces links them locally.

- [ ] **Step 2: Configure strict TypeScript and Vitest projects**

Create `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`, `moduleResolution: "Bundler"`, and aliases for the four packages. Create `vitest.config.ts` with one Node project for `packages/**/*.test.ts` and one jsdom project for `apps/**/*.test.tsx`.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: 'packages-node',
          environment: 'node',
          include: ['packages/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'creator-jsdom',
          environment: 'jsdom',
          include: ['apps/**/*.test.tsx'],
          setupFiles: ['apps/creator-web/src/test/setup.ts'],
        },
      },
    ],
  },
})
```

- [ ] **Step 3: Write the failing schema test**

```ts
import { describe, expect, it } from 'vitest'
import { VISUAL_SLOT_IDS } from './contracts.js'
import { parseMonsterSpec } from './schema.js'
import { makeValidMonsterSpecFixture } from './test-fixtures.js'

describe('MonsterSpecSchema', () => {
  it('accepts exactly fourteen visual slots and eight semantic slots', () => {
    const input = makeValidMonsterSpecFixture()
    expect(Object.keys(input.visualSlots)).toHaveLength(14)
    expect(VISUAL_SLOT_IDS).toHaveLength(14)
    expect(parseMonsterSpec(input)).toEqual({ ok: true, value: input })
  })

  it('rejects a missing mandatory slot without mutating input', () => {
    const input = makeValidMonsterSpecFixture()
    const snapshot = structuredClone(input)
    delete input.visualSlots.eyes
    const result = parseMonsterSpec(input)
    expect(result.ok).toBe(false)
    expect(snapshot.visualSlots.eyes.partId).toBe('eyes_asymmetric')
  })
})
```

- [ ] **Step 4: Run the schema test and observe the expected failure**

Run: `npx vitest run packages/generator-core/src/schema.test.ts`

Expected: FAIL because `parseMonsterSpec` and the contract types do not exist.

- [ ] **Step 5: Implement the contract constants and Zod schema**

Use literal arrays as the single type source:

```ts
export const VISUAL_SLOT_IDS = [
  'bodyFrame', 'headShape', 'eyes', 'mouthShape', 'oralDetail',
  'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
  'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
] as const

export const SEMANTIC_SLOT_IDS = [
  'frame', 'appendage', 'headAndEyes', 'mouth',
  'surface', 'pattern', 'personality', 'quirk',
] as const

export type VisualSlotId = typeof VISUAL_SLOT_IDS[number]
export type SemanticSlotId = typeof SEMANTIC_SLOT_IDS[number]
export type ThemeId = 'deep-sea' | 'fungal' | 'shadow'
export type RigId = 'blob' | 'biped' | 'floating'
export type RenderLayer =
  | 'groundShadow' | 'rearAppendage' | 'body' | 'surface' | 'pattern'
  | 'frontAppendage' | 'head' | 'faceAndHeadwear' | 'foregroundEffect'
export type Severity = 'warning' | 'error'

export interface Diagnostic {
  severity: Severity
  code: string
  path: string[]
  message: string
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: Diagnostic[] }
```

Build `MonsterSpecSchema` with Zod records keyed by `z.enum(VISUAL_SLOT_IDS)` and `z.enum(SEMANTIC_SLOT_IDS)`. Convert every Zod issue to `Diagnostic` in `parseMonsterSpec` and return the parsed clone, never the original object. Implement `makeValidMonsterSpecFixture(): MonsterSpec` as a complete typed factory with all 14 visual slots, all 8 semantic slots, `mutation: null`, `aberrations: []`, and catalog version `0.1.0`. Also implement `makeValidCatalogFixture(): Catalog` with all fixed themes/rigs, one legal candidate per required slot, explicit `none` candidates, eight semantic mappings, and the four v0.1 modifier entries. Every call returns a fresh object that later tests may mutate.

- [ ] **Step 6: Run contract verification**

Run: `npx vitest run packages/generator-core/src/schema.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0 with no TypeScript diagnostics.

- [ ] **Step 7: Commit the foundation**

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.json vitest.config.ts apps packages
git commit -m "feat: define workspace and monster spec contract"
```

---

### Task 2: Stable PRNG and Per-Slot Sub-Seeds

**Files:**
- Create: `packages/generator-core/src/prng.ts`
- Create: `packages/generator-core/src/prng.test.ts`
- Modify: `packages/generator-core/src/index.ts`

**Interfaces:**
- Consumes: `VisualSlotId` from Task 1.
- Produces: `fnv1a32(input: string): number`, `createRng(parts: readonly string[]): Rng`, `slotSeedParts(seed, themeId, slotId, rerollIndex)`, and `pickWeighted(items, weightOf, rng)`.

- [ ] **Step 1: Write golden-vector and weighted-selection tests**

```ts
import { describe, expect, it } from 'vitest'
import { createRng, pickWeighted, slotSeedParts } from './prng.js'

describe('stable PRNG', () => {
  it('matches the committed golden vector', () => {
    const rng = createRng(slotSeedParts('84721937', 'fungal', 'eyes', 0))
    expect(rng.nextFloat()).toBeCloseTo(0.8443717986810952, 15)
    expect(rng.nextFloat()).toBeCloseTo(0.8479310672264546, 15)
    expect(rng.nextFloat()).toBeCloseTo(0.009995558764785528, 15)
  })

  it('never selects a zero-weight item', () => {
    const rng = createRng(['weighted', 'fixture'])
    const result = pickWeighted(
      [{ id: 'zero', weight: 0 }, { id: 'live', weight: 4 }],
      item => item.weight,
      rng,
    )
    expect(result.id).toBe('live')
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run packages/generator-core/src/prng.test.ts`

Expected: FAIL because `prng.ts` does not exist.

- [ ] **Step 3: Implement FNV-1a, Mulberry32, and weighted selection**

```ts
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function createRng(parts: readonly string[]): Rng {
  let state = fnv1a32(parts.join('\u001f'))
  return {
    nextFloat() {
      state = (state + 0x6d2b79f5) >>> 0
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    },
  }
}

export function slotSeedParts(
  seed: string,
  themeId: string,
  slotId: VisualSlotId,
  rerollIndex: number,
): readonly string[] {
  return [seed, themeId, slotId, String(rerollIndex)]
}
```

`pickWeighted` must reject an empty array and a non-positive total weight with explicit errors. It must use `rng.nextFloat() * totalWeight`, then select the first cumulative weight greater than the roll.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/generator-core/src/prng.test.ts && npm run typecheck`

Expected: both commands pass.

- [ ] **Step 5: Commit the PRNG**

```bash
git add packages/generator-core/src/prng.ts packages/generator-core/src/prng.test.ts packages/generator-core/src/index.ts
git commit -m "feat: add deterministic slot random streams"
```

---

### Task 3: Catalog Schema, Structural Checks, and File Validation CLI

**Files:**
- Create: `packages/generator-core/src/catalog-schema.ts`
- Create: `packages/generator-core/src/catalog-validation.ts`
- Create: `packages/generator-core/src/catalog-validation.test.ts`
- Create: `packages/asset-catalog/src/file-validation.ts`
- Create: `packages/asset-catalog/src/file-validation.test.ts`
- Create: `packages/asset-catalog/src/load-catalog.ts`
- Create: `packages/asset-catalog/src/catalog-registry.ts`
- Create: `packages/asset-catalog/src/catalog-registry.test.ts`
- Create: `packages/asset-catalog/src/cli.ts`
- Create: `packages/asset-catalog/catalog/fixtures/minimal-valid.json`
- Modify: `packages/asset-catalog/package.json`

**Interfaces:**
- Consumes: Task 1 contract types and Zod 4.
- Produces: `CatalogSchema`, `parseCatalog`, `validateCatalogStructure(catalog)`, `validateCatalogFiles(catalog, assetRoot)`, `loadCatalog(catalogFile)`, and `CatalogRegistry`.

- [ ] **Step 1: Write structural failure tests**

```ts
it('reports dangling excludes and missing mandatory coverage', () => {
  const catalog = makeValidCatalogFixture()
  catalog.parts[0].excludes = ['missing_part']
  catalog.parts = catalog.parts.filter(part => part.slotId !== 'eyes')
  const codes = validateCatalogStructure(catalog).map(item => item.code)
  expect(codes).toContain('CATALOG_DANGLING_EXCLUDE')
  expect(codes).toContain('CATALOG_SLOT_UNCOVERED')
})

it('requires explicit none candidates for optional slots', () => {
  const catalog = makeValidCatalogFixture()
  catalog.parts = catalog.parts.filter(part => part.id !== 'tail_none')
  expect(validateCatalogStructure(catalog)).toContainEqual(
    expect.objectContaining({ code: 'CATALOG_OPTIONAL_NONE_MISSING' }),
  )
})
```

- [ ] **Step 2: Run the structural tests and observe failure**

Run: `npx vitest run packages/generator-core/src/catalog-validation.test.ts`

Expected: FAIL because catalog schemas and validation do not exist.

- [ ] **Step 3: Implement exact catalog entities**

Define these required shapes in `catalog-schema.ts`:

```ts
export interface RigDefinition {
  id: 'blob' | 'biped' | 'floating'
  sockets: Record<string, { x: number; y: number }>
}

export interface VisualPartDefinition {
  id: string
  slotId: VisualSlotId
  rarity: 'N' | 'R' | 'L'
  baseWeight: number
  themeIds: string[]
  themeWeights: Partial<Record<ThemeId, number>>
  compatibleRigs: Array<RigDefinition['id']>
  assetPath: string
  maskPaths: { primary?: string; secondary?: string }
  origin: { x: number; y: number }
  socket: string | null
  layer: RenderLayer
  semanticTraitId: string | null
  semanticPriority: number
  excludes: string[]
  boosts: Record<string, number>
}
```

Use `z.enum` for all fixed IDs and `.min(0)` for weights. Normalize socket and origin coordinates to the 0–2048 master canvas and reject values outside that range. `validateCatalogStructure` must check uniqueness, valid references, nonempty compatible rigs, required sockets, approved transforms, all mandatory slots, `none` for optional slots, and an acyclic dependency graph.

- [ ] **Step 4: Run structural tests**

Run: `npx vitest run packages/generator-core/src/catalog-validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Write file-level and catalog-registry failure tests**

Use Sharp in the test to write one valid 1024×1024 RGBA image and one invalid 800×600 RGB image into a temporary directory. Assert these diagnostic codes:

```ts
expect(await validateCatalogFiles(catalog, tempRoot)).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ code: 'ASSET_DIMENSION_INVALID' }),
    expect.objectContaining({ code: 'ASSET_ALPHA_MISSING' }),
  ]),
)
```

In `catalog-registry.test.ts`, register `0.1.0`, assert it loads by exact version, then request `0.0.9` and assert `CATALOG_VERSION_MISSING` with no fallback load.

- [ ] **Step 6: Run file tests to verify failure**

Run: `npx vitest run packages/asset-catalog/src/file-validation.test.ts packages/asset-catalog/src/catalog-registry.test.ts`

Expected: FAIL because file validation and the catalog registry do not exist.

- [ ] **Step 7: Implement file validation and CLI exit behavior**

`validateCatalogFiles` must resolve every path under the supplied asset root, reject path traversal, allow only `.png` and `.webp`, check existence, read Sharp metadata, require square 1024 or 2048 dimensions, require alpha, and verify optional SHA-256 values. `cli.ts` must print one line per diagnostic and set `process.exitCode = 1` if any error exists.

Implement `CatalogRegistry` as an injected `Map<string, () => Promise<Catalog>>` with `has(version)` and `load(version)`. Its tests must prove that an installed noncurrent version loads, while an absent version returns `CATALOG_VERSION_MISSING` without substituting the current catalog.

Add this workspace script:

```json
{
  "scripts": {
    "validate": "tsx src/cli.ts catalog/v0.1.0/catalog.json assets/v0.1.0"
  }
}
```

Use the root-pinned `tsx@~4.23.12`; do not add a second package-local copy.

- [ ] **Step 8: Run catalog verification**

Run: `npx vitest run packages/generator-core/src/catalog-validation.test.ts packages/asset-catalog/src/file-validation.test.ts packages/asset-catalog/src/catalog-registry.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit catalog validation**

```bash
git add package.json package-lock.json packages/generator-core packages/asset-catalog
git commit -m "feat: validate creature catalogs and image assets"
```

---

### Task 4: Deterministic Generation, Locks, Local Reroll, and Manual Selection

**Files:**
- Create: `packages/generator-core/src/candidates.ts`
- Create: `packages/generator-core/src/generate.ts`
- Create: `packages/generator-core/src/reroll.ts`
- Create: `packages/generator-core/src/projection.ts`
- Create: `packages/generator-core/src/projection.test.ts`
- Create: `packages/generator-core/src/generate.test.ts`
- Create: `packages/generator-core/src/generate.property.test.ts`
- Modify: `packages/generator-core/src/contracts.ts`
- Modify: `packages/generator-core/src/index.ts`

**Interfaces:**
- Consumes: `Catalog`, `MonsterSpec`, PRNG, and structural validation.
- Produces: `GenerationRequest`, `GenerationResult`, `generateMonster`, `rerollSlot`, `selectVisualPart`, and `projectSemanticTraits`.

```ts
export interface GenerationRequest {
  seed: string
  themeId: ThemeId
  mode: 'normal' | 'mutation' | 'aberration'
  slotRolls?: Partial<Record<VisualSlotId, number>>
  lockedSelections?: Partial<Record<VisualSlotId, string>>
}

export interface GenerationResult {
  spec: MonsterSpec
  diagnostics: Diagnostic[]
  blocked: boolean
}
```

- [ ] **Step 1: Write determinism, isolation, and conflict tests**

```ts
it('repeats the same spec for the same request and catalog', () => {
  const request = { seed: '84721937', themeId: 'fungal', mode: 'normal' } as const
  expect(generateMonster(request, catalog).spec).toEqual(generateMonster(request, catalog).spec)
})

it('rerolls eyes without changing independent slots', () => {
  const before = generateMonster(baseRequest, catalog).spec
  const after = rerollSlot({ spec: before, slotId: 'eyes', locks: {}, catalog }).spec
  expect(after.slotRolls.eyes).toBe(before.slotRolls.eyes + 1)
  expect(after.visualSlots.bodyFrame).toEqual(before.visualSlots.bodyFrame)
  expect(after.visualSlots.tail).toEqual(before.visualSlots.tail)
})

it('retains an incompatible lock and blocks export', () => {
  const result = generateMonster(
    { ...baseRequest, lockedSelections: { legs: 'legs_spring' } },
    catalogWithoutSpringCompatibleRig,
  )
  expect(result.blocked).toBe(true)
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'legs'] }),
  )
})
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `npx vitest run packages/generator-core/src/generate.test.ts`

Expected: FAIL because generation functions do not exist.

- [ ] **Step 3: Implement candidate filtering and weighted choice**

`buildCandidates` must apply this exact sequence:

1. Rig, required socket, excludes, and asset availability.
2. Theme-pool roll: 70% theme pool and 30% full pool; fall back to full pool only if the theme pool is empty.
3. Rarity roll N/R/L with 70%/25%/5% weights renormalized over available rarities.
4. Item weight `baseWeight × active themeWeights[themeId] × every active boost multiplier`, with omitted multipliers equal to `1`.

Return both the selected part and a trace object containing range mode, rarity roll, candidate IDs, and final weights. Trace is test/debug data and is not persisted in `MonsterSpec`.

- [ ] **Step 4: Implement fixed dependency order and generation**

Use this dependency-safe order:

```ts
export const GENERATION_ORDER: readonly VisualSlotId[] = [
  'bodyFrame', 'colorScheme', 'surfaceMaterial', 'pattern',
  'headShape', 'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
  'eyes', 'mouthShape', 'oralDetail', 'effect',
]
```

After all visual slots resolve, call `projectSemanticTraits` to populate all eight semantic slots. In this task, `normal` produces `mutation: null` and `aberrations: []`; `mutation` and `aberration` return the blocking diagnostic `GENERATION_MODE_NOT_IMPLEMENTED`. Task 5 replaces that diagnostic with deterministic modifier selection. Do not add randomness in rendering code.

- [ ] **Step 5: Write the failing 14-to-8 semantic projection test**

```ts
it('chooses the highest semantic priority and retains details', () => {
  const spec = makeValidMonsterSpecFixture()
  spec.visualSlots.tail.partId = 'tail_anchor'
  spec.visualSlots.legs.partId = 'legs_webbed'
  const projection = projectSemanticTraits(spec.visualSlots, spec.seed, catalog)
  expect(projection.appendage).toEqual({
    primaryTraitId: 'appendage_anchor_tail',
    detailTraitIds: ['appendage_webbed_feet'],
  })
})
```

- [ ] **Step 6: Run the projection test and observe failure**

Run: `npx vitest run packages/generator-core/src/projection.test.ts`

Expected: FAIL because `projectSemanticTraits` does not exist.

- [ ] **Step 7: Implement 14-to-8 semantic projection**

For each grouped semantic slot, sort candidates by descending `semanticPriority`, then by this fixed order:

```ts
const SEMANTIC_TIE_BREAKERS = {
  appendage: ['extraAppendage', 'tail', 'legs', 'arms'],
  headAndEyes: ['eyes', 'headAppendage', 'headShape'],
  mouth: ['oralDetail', 'mouthShape'],
  pattern: ['pattern', 'colorScheme'],
} as const
```

Deduplicate trait IDs. The first is primary; remaining IDs retain tie-break order as details. Fill personality and quirk with separate `personality` and `quirk` PRNG substreams over catalog semantic-only traits.

- [ ] **Step 8: Implement local reroll and manual selection**

`rerollSlot` increments only the target `slotRolls` counter, then recomputes that slot and unlocked descendants from the catalog dependency graph. `selectVisualPart` assigns the requested part after validation, preserves incompatible locked descendants, and returns blocking diagnostics instead of replacing them.

- [ ] **Step 9: Add fast-check properties and fixed distribution checks**

```ts
it('terminates with a legal result or structured errors for arbitrary seeds', () => {
  fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 64 }), seed => {
    const result = generateMonster({ seed, themeId: 'fungal', mode: 'normal' }, catalog)
    expect(result.spec.seed).toBe(seed)
    if (result.blocked) {
      expect(result.diagnostics.some(item => item.severity === 'error')).toBe(true)
    } else {
      expect(Object.keys(result.spec.visualSlots)).toHaveLength(14)
    }
  }), { numRuns: 1000 })
})
```

Add a fixed 20,000-seed statistical test over a balanced fixture catalog. Read the candidate trace and require theme-pool selection within 68–72%, normal rarity within 68–72%, rare within 23–27%, and legendary within 4–6%. Use the same sample seeds on every run and print observed counts on failure.

- [ ] **Step 10: Run generation verification**

Run: `npx vitest run packages/generator-core/src/generate.test.ts packages/generator-core/src/generate.property.test.ts packages/generator-core/src/projection.test.ts`

Expected: PASS with 1,000 property runs.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 11: Commit generation rules**

```bash
git add packages/generator-core/src
git commit -m "feat: generate and reroll deterministic creature slots"
```

---

### Task 5: Modifiers and Incubator Adapter

**Files:**
- Create: `packages/generator-core/src/modifiers.ts`
- Create: `packages/generator-core/src/modifiers.test.ts`
- Create: `packages/incubator-adapter/src/contracts.ts`
- Create: `packages/incubator-adapter/src/input.ts`
- Create: `packages/incubator-adapter/src/output.ts`
- Create: `packages/incubator-adapter/src/adapter.test.ts`
- Create: `packages/incubator-adapter/fixtures/fungal-egg.json`
- Modify: `packages/generator-core/src/contracts.ts`
- Modify: `packages/generator-core/src/generate.ts`
- Modify: `packages/generator-core/src/generate.test.ts`

**Interfaces:**
- Consumes: Complete base visual selection and semantic projection from Task 4.
- Produces: `applyModifiers`, implemented mutation/aberration modes, `toGenerationRequest`, and `toIncubatorRecord`.

- [ ] **Step 1: Write modifier-mode failure tests**

```ts
it('selects the same mutation for the same request', () => {
  const request = { seed: '84721937', themeId: 'fungal', mode: 'mutation' } as const
  const first = generateMonster(request, catalog)
  const second = generateMonster(request, catalog)
  expect(first.blocked).toBe(false)
  expect(first.spec.mutation).toEqual(second.spec.mutation)
  expect(first.spec.mutation).not.toBeNull()
  expect(first.spec.aberrations).toEqual([])
})
```

- [ ] **Step 2: Run modifier tests and observe failure**

Run: `npx vitest run packages/generator-core/src/modifiers.test.ts packages/generator-core/src/generate.test.ts`

Expected: FAIL because modifiers are not selected and non-normal modes still block.

- [ ] **Step 3: Implement exact modifier behavior and mode selection**

Add the exact mode type `type GenerationMode = 'normal' | 'mutation' | 'aberration'`. Replace Task 4's unimplemented-mode branch with named `mutation-roll` and `aberration-roll` PRNG substreams. Test these four v0.1 modifiers:

- `mutation_albino`: palette override, no slot displacement.
- `mutation_double_head`: duplicate the resolved head group during layer expansion.
- `aberration_color_discord`: replace palette with modifier colors.
- `aberration_misplaced_eye`: move the eye layer to a catalog-approved alternate socket.

`applyModifiers` must leave `visualSlots` as the inspectable base selection and store visual overrides only in each `ModifierApplication`; it must not mutate the base visual selection. Normal mode produces `mutation: null` and `aberrations: []`; mutation mode produces exactly one mutation; aberration mode produces exactly one aberration plus a mutation only when the catalog's aberration entry explicitly requests one.

- [ ] **Step 4: Write the adapter failure test**

```ts
it('exports exactly eight legacy traits and preserves visual extension', () => {
  const spec = makeValidMonsterSpecFixture()
  const record = toIncubatorRecord(spec)
  expect(record.traits).toHaveLength(8)
  expect(record.visualExtension.visualSlots).toEqual(spec.visualSlots)
})
```

Run: `npx vitest run packages/incubator-adapter/src/adapter.test.ts`

Expected: FAIL because adapter functions do not exist.

- [ ] **Step 5: Implement adapter contracts**

```ts
export interface IncubatorEggInput {
  id: string
  theme: 'deep_sea' | 'fungal' | 'shadow'
  seed: string | number
  risk: number
  mutationBonus: number
}

export interface IncubatorCreatureRecord {
  theme: IncubatorEggInput['theme']
  seed: string
  traits: string[]
  mutation: string | null
  aberrations: string[]
  palette: [string, string, string]
  visualExtension: Pick<MonsterSpec, 'schemaVersion' | 'catalogVersion' | 'visualSlots'>
}
```

Map theme spelling explicitly. Keep risk and mutation rolls in `toGenerationRequest` with named substreams `aberration-roll` and `mutation-roll` so repeated calls are stable.

- [ ] **Step 6: Run modifier and adapter tests**

Run: `npx vitest run packages/generator-core/src/modifiers.test.ts packages/generator-core/src/generate.test.ts packages/incubator-adapter/src/adapter.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit semantic compatibility**

```bash
git add packages/generator-core packages/incubator-adapter
git commit -m "feat: add creature modifiers and incubator compatibility"
```

---

### Task 6: Socket Layout and Deterministic Canvas Layer Expansion

**Files:**
- Create: `packages/renderer-canvas/src/types.ts`
- Create: `packages/renderer-canvas/src/layout.ts`
- Create: `packages/renderer-canvas/src/layers.ts`
- Create: `packages/renderer-canvas/src/render.ts`
- Create: `packages/renderer-canvas/src/render.test.ts`
- Create: `packages/renderer-canvas/src/index.ts`

**Interfaces:**
- Consumes: `MonsterSpec`, `Catalog`, rig sockets, part origins and modifier overrides.
- Produces: `resolvePlacement`, `expandRenderLayers`, `renderMonster`, `ImageResolver`, and `RenderResult`.

```ts
export interface ImageResolver {
  resolve(assetPath: string): Promise<CanvasImageSource>
}

export interface RenderOptions {
  width: 1024 | 2048
  height: 1024 | 2048
  includeGroundShadow: boolean
}

export interface RenderResult {
  drawnAssetIds: string[]
  diagnostics: Diagnostic[]
}
```

- [ ] **Step 1: Write draw-order and placement tests with a fake context**

```ts
it('draws the fixed nine groups from back to front', async () => {
  const calls: string[] = []
  const context = makeRecordingContext(calls)
  const spec = makeValidMonsterSpecFixture()
  const result = await renderMonster(context, spec, catalog, resolver, options1024)
  expect(result.drawnAssetIds).toEqual([
    'ground_shadow', 'tail_curl', 'body_blob', 'surface_fur',
    'pattern_spots', 'arms_round', 'head_soft', 'eyes_asymmetric', 'effect_spores',
  ])
})

it('aligns a part origin to the body socket', () => {
  expect(resolvePlacement(
    { x: 620, y: 360 },
    { x: 40, y: 50 },
    { scale: 1, mirrorX: false },
  )).toEqual({ x: 580, y: 310, scaleX: 1, scaleY: 1 })
})
```

- [ ] **Step 2: Run renderer tests and observe failure**

Run: `npx vitest run packages/renderer-canvas/src/render.test.ts`

Expected: FAIL because renderer modules do not exist.

- [ ] **Step 3: Implement placement without free transforms**

`resolvePlacement` must match body socket to part origin, apply only manifest-approved `scale` and `mirrorX`, and reject any transform not present in the part's preset list. Return `RENDER_PRESET_INVALID` instead of clamping.

- [ ] **Step 4: Implement the fixed layer expansion**

Use this exact order:

```ts
export const RENDER_LAYER_ORDER = [
  'groundShadow', 'rearAppendage', 'body', 'surface', 'pattern',
  'frontAppendage', 'head', 'faceAndHeadwear', 'foregroundEffect',
] as const
```

`expandRenderLayers` must apply double-head and misplaced-eye modifiers by adding catalog-approved layer instances. It must never change `MonsterSpec`.

- [ ] **Step 5: Implement rendering and explicit missing-image diagnostics**

For each expanded layer: save context, translate, scale, draw the base image, apply primary/secondary masks with deterministic composite operations, and restore context. If `ImageResolver` fails, append blocking `ASSET_LOAD_FAILED`, draw a deterministic magenta checker placeholder labeled with the missing asset ID at the resolved placement, and continue so the preview can identify every missing asset. Formal image and JSON exports remain blocked until the missing asset is restored.

- [ ] **Step 6: Run renderer verification**

Run: `npx vitest run packages/renderer-canvas/src/render.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the renderer core**

```bash
git add packages/renderer-canvas
git commit -m "feat: compose catalog parts on deterministic canvas layers"
```

---

### Task 7: PNG/WebP Export and Browser Pixel Regression

**Files:**
- Create: `packages/renderer-canvas/src/export.ts`
- Create: `packages/renderer-canvas/src/export.test.ts`
- Create: `apps/creator-web/render-test.html`
- Create: `apps/creator-web/src/render-test.ts`
- Create: `apps/creator-web/public/render-fixtures/synthetic-spec.json`
- Create: `apps/creator-web/public/render-fixtures/assets/*.png`
- Create: `scripts/create-render-fixtures.ts`
- Create: `tests/render/golden.spec.ts`
- Create: `tests/render/golden/synthetic-1024.rgba.sha256`
- Create: `playwright.config.ts`
- Modify: `packages/renderer-canvas/src/index.ts`

**Interfaces:**
- Consumes: Task 6 rendering.
- Produces: `detectExportCapabilities`, `exportCanvas`, and committed decoded-pixel golden hashes.

- [ ] **Step 1: Write export capability tests**

```ts
it('always exposes PNG and reports WebP by probe result', async () => {
  const capabilities = await detectExportCapabilities(makeCanvasProbe('image/png'))
  expect(capabilities.png).toBe(true)
  expect(capabilities.webp).toBe(false)
})

it('rejects unsupported WebP without blocking JSON workflows', async () => {
  await expect(exportCanvas(canvasWithoutWebp, 'image/webp')).rejects.toMatchObject({
    code: 'WEBP_EXPORT_UNSUPPORTED',
  })
})
```

- [ ] **Step 2: Run export tests and observe failure**

Run: `npx vitest run packages/renderer-canvas/src/export.test.ts`

Expected: FAIL because export functions do not exist.

- [ ] **Step 3: Implement Blob export with MIME verification**

Use `HTMLCanvasElement.toBlob`. Reject null blobs. Verify returned `blob.type` matches the requested MIME. `detectExportCapabilities` must perform one tiny-canvas probe per session and cache its promise.

- [ ] **Step 4: Configure Playwright browser projects and Vite web server**

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'npm run dev -w @qmonster/creator-web -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chrome-stable', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge-stable', use: { ...devices['Desktop Chrome'], channel: 'msedge' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
```

Run: `npx playwright install chromium firefox webkit`

Expected: all three bundled browser engines install successfully. The acceptance machine must also have current stable Chrome and Edge for the two branded-channel projects.

- [ ] **Step 5: Write the failing golden-pixel browser test**

The test must open `/render-test.html`, wait for `document.body.dataset.renderComplete`, read `ImageData.data`, compute SHA-256 in Node, and compare `synthetic-1024.rgba.sha256`. Compare decoded RGBA bytes, not PNG/WebP file bytes. A second case opens `/render-test.html?size=2048` and asserts a 2048×2048 backing buffer, nonzero alpha, and no nontransparent pixels touching the outermost crop boundary.

Run: `npx playwright test tests/render/golden.spec.ts --project=chromium`

Expected: FAIL because the Vite-served harness, synthetic assets, and golden hash are absent.

- [ ] **Step 6: Add the fixture page and establish the first golden hash**

Implement `create-render-fixtures.ts` with Sharp composites to create deterministic transparent body, mirrored rear appendage, masked surface, eyes, and mouth PNGs under the creator's public directory. `render-test.html` imports `src/render-test.ts`; that entry loads the fixed public spec, draws it at the `size` query parameter through `renderer-canvas`, exposes the canvas as `#render-target`, and sets `document.body.dataset.renderComplete = 'true'`. Run `npx tsx scripts/create-render-fixtures.ts`, then generate the 1024 hash once with `UPDATE_GOLDENS=1`, review the rendered image, and commit the reviewed fixtures and hash.

- [ ] **Step 7: Run renderer browser verification**

Run: `npx vitest run packages/renderer-canvas/src/export.test.ts`

Expected: PASS.

Run: `npx playwright test tests/render/golden.spec.ts --project=chromium`

Expected: PASS with the committed RGBA hash.

- [ ] **Step 8: Commit export and golden regression**

```bash
git add playwright.config.ts packages/renderer-canvas apps/creator-web/render-test.html apps/creator-web/src/render-test.ts apps/creator-web/public/render-fixtures scripts/create-render-fixtures.ts tests/render
git commit -m "feat: export transparent creature images with pixel regression"
```

---

### Task 8: AI Asset Production Pipeline and v0.1 Catalog

**Files:**
- Create: `docs/art/qmonster-v0.1-art-bible.md`
- Create: `packages/asset-catalog/catalog/v0.1.0/catalog.json`
- Create: `packages/asset-catalog/catalog/v0.1.0/themes.json`
- Create: `packages/asset-catalog/catalog/v0.1.0/rigs.json`
- Create: `packages/asset-catalog/catalog/v0.1.0/parts.json`
- Create: `packages/asset-catalog/catalog/v0.1.0/semantic-traits.json`
- Create: `packages/asset-catalog/catalog/v0.1.0/modifiers.json`
- Create: `packages/asset-catalog/assets/v0.1.0/**/*.webp`
- Create: `packages/asset-catalog/assets/v0.1.0/**/*.png`
- Create: `packages/asset-catalog/source-index.json`
- Create: `scripts/build-runtime-assets.ts`
- Create: `scripts/build-runtime-assets.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 3 catalog rules, Task 6 sockets and render layers.
- Produces: A validated v0.1 runtime catalog with 55 visual candidates, 12 semantic-only traits, 2 mutations, and 2 aberrations.

The exact visual candidate budget is:

| Slot | Candidate count |
| --- | ---: |
| `bodyFrame` | 5 |
| `headShape` | 4 |
| `eyes` | 5 |
| `mouthShape` | 4 |
| `oralDetail` | 4 |
| `headAppendage` | 4 |
| `arms` | 3 |
| `legs` | 4 |
| `tail` | 4 |
| `extraAppendage` | 4 |
| `surfaceMaterial` | 4 |
| `pattern` | 4 |
| `colorScheme` | 3 |
| `effect` | 3 |
| **Total** | **55** |

- [ ] **Step 1: Write the art bible with immutable generation controls**

Record these fixed controls:

- 3/4 front view, camera at creature eye level, 50mm-equivalent lens.
- 1024×1024 runtime crop and 2048×2048 master.
- Soft key light from upper-left, broad fill from camera, soft contact shadow on a separate layer.
- Bright rounded tactile 3D cartoon, exaggerated eyes and mouth, friendly asymmetry, no gore, no sharp photoreal anatomy.
- Locked base IDs: `base_blob_v1`, `base_biped_v1`, `base_floating_v1`.

Use this exact edit prompt template for every candidate:

```text
Edit the supplied locked QMonster rig base. Change only the masked {slotId} region to: {partDescription}.
Preserve the camera, 3/4 front pose, body silhouette outside the mask, eye-level perspective,
upper-left soft key light, broad front fill, friendly rounded 3D cartoon proportions, and tactile material response.
Keep attachment points aligned with the supplied socket guides. No text, no props, no environment,
no extra limbs outside the requested slot, no gore, no horror-valley anatomy. Output a clean isolated subject.
```

- [ ] **Step 2: Write the failing runtime-asset conversion test**

Generate a temporary 2048×2048 RGBA master with Sharp. Test that `buildRuntimeAsset` produces a 1024×1024 lossless WebP, preserves alpha, and writes the expected SHA-256 to the source index.

Run: `npx vitest run scripts/build-runtime-assets.test.ts`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement runtime asset conversion**

```ts
export async function buildRuntimeAsset(input: {
  sourcePath: string
  runtimePath: string
  sourceId: string
}): Promise<{ sourceSha256: string; runtimeSha256: string }> {
  const source = await readFile(input.sourcePath)
  await sharp(source)
    .resize(1024, 1024, { fit: 'contain' })
    .webp({ lossless: true })
    .toFile(input.runtimePath)
  return {
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    runtimeSha256: await sha256File(input.runtimePath),
  }
}
```

- [ ] **Step 4: Produce and approve the three locked rig bases**

Use the image generation/editing capability selected at execution time. Generate four candidates for each rig, choose one using the art bible, and save approved 2048 masters outside Git under `asset-source/v0.1.0/rigs/`. Add `asset-source/` to `.gitignore`. Store approved source hashes and prompt hashes in `source-index.json`.

Run the three bases through runtime conversion and catalog validation before generating dependent parts.

- [ ] **Step 5: Produce the 55 slot candidates by masked edit**

For each candidate in the count table:

1. Select a compatible locked base.
2. Supply a slot mask and socket guide.
3. Generate four candidates with the exact prompt template.
4. Reject candidates with camera, light, silhouette-outside-mask, socket, or friendliness drift.
5. Save the approved 2048 master outside Git.
6. Convert the runtime WebP/PNG and record source/runtime hashes.
7. Add `compatibleRigs`, origin, socket, layer, theme IDs, rarity, semantic mapping, excludes, and boosts to `parts.json`.

The optional slots must include explicit `none` candidates. The three theme color schemes are theme-bounded rather than globally interchangeable.

- [ ] **Step 6: Add semantic-only and modifier catalog entries**

Create exactly six personality traits and six quirks covering normal and rare grades. Add these modifiers:

- `mutation_albino`
- `mutation_double_head`
- `aberration_color_discord`
- `aberration_misplaced_eye`

Each entry must include Chinese display name, flavor text, rarity, theme boosts, excludes, and visual effect mapping where applicable.

- [ ] **Step 7: Validate the production catalog and generate a contact sheet**

Run: `npm run catalog:validate`

Expected: exit 0 with no diagnostics.

Add a script that renders every candidate on each compatible rig into contact sheets. Review for camera, light, alpha edge, socket and scale consistency. Record review date and reviewer in `source-index.json`.

- [ ] **Step 8: Run all catalog and renderer tests**

Run: `npx vitest run packages/generator-core packages/asset-catalog packages/renderer-canvas scripts/build-runtime-assets.test.ts`

Expected: PASS.

Run: `npx playwright test tests/render/golden.spec.ts --project=chromium`

Expected: PASS without changing the synthetic renderer golden; production catalog visuals are reviewed through the contact sheet and Task 12 acceptance set.

- [ ] **Step 9: Commit art metadata and runtime assets**

```bash
git add .gitignore docs/art packages/asset-catalog scripts/build-runtime-assets.ts scripts/build-runtime-assets.test.ts tests/render
git commit -m "feat: add validated v0.1 creature asset catalog"
```

---

### Task 9: Creator Session Reducer and Local Persistence

**Files:**
- Create: `apps/creator-web/src/state/contracts.ts`
- Create: `apps/creator-web/src/state/creator-reducer.ts`
- Create: `apps/creator-web/src/state/creator-reducer.test.ts`
- Create: `apps/creator-web/src/state/persistence.ts`
- Create: `apps/creator-web/src/state/persistence.test.ts`
- Create: `apps/creator-web/src/hooks/useCreator.ts`

**Interfaces:**
- Consumes: Core generation/reroll/manual-selection and production catalog.
- Produces: `CreatorSession`, `CreatorAction`, `createCreatorReducer(catalog)`, `loadSession`, `saveSession`, and `useCreator`.

```ts
export interface CreatorSession {
  spec: MonsterSpec
  locks: Record<VisualSlotId, boolean>
  diagnostics: Diagnostic[]
  blocked: boolean
  exportCapabilities: { png: boolean; webp: boolean }
}

export type CreatorAction =
  | { type: 'newCreature'; seed: string }
  | { type: 'setTheme'; themeId: ThemeId }
  | { type: 'setMode'; mode: GenerationRequest['mode'] }
  | { type: 'toggleLock'; slotId: VisualSlotId }
  | { type: 'rerollSlot'; slotId: VisualSlotId }
  | { type: 'manualSelect'; slotId: VisualSlotId; partId: string }
  | { type: 'importSpec'; spec: MonsterSpec }
```

- [ ] **Step 1: Write reducer behavior tests**

```ts
it('keeps compatible locks and flags incompatible locks on theme change', () => {
  const creatorReducer = createCreatorReducer(catalog)
  const locked = sessionWithLockedEyes('eyes_asymmetric')
  const next = creatorReducer(locked, { type: 'setTheme', themeId: 'shadow' })
  expect(next.locks.eyes).toBe(true)
  expect(next.spec.visualSlots.eyes.partId).toBe('eyes_asymmetric')
  expect(next.blocked).toBe(true)
})

it('preserves compatible locks and regenerates every unlocked slot on theme change', () => {
  const creatorReducer = createCreatorReducer(catalog)
  const before = sessionWithLockedEyes('eyes_asymmetric')
  const next = creatorReducer(before, { type: 'setTheme', themeId: 'deep-sea' })
  expect(next.spec.visualSlots.eyes).toEqual(before.spec.visualSlots.eyes)
  expect(next.spec.visualSlots.surfaceMaterial).not.toEqual(before.spec.visualSlots.surfaceMaterial)
  expect(next.blocked).toBe(false)
})

it('imports a spec with every editor lock cleared', () => {
  const creatorReducer = createCreatorReducer(catalog)
  const next = creatorReducer(sessionWithAllLocks, { type: 'importSpec', spec: importedSpec })
  expect(Object.values(next.locks).every(value => value === false)).toBe(true)
})
```

- [ ] **Step 2: Run reducer tests and observe failure**

Run: `npx vitest run apps/creator-web/src/state/creator-reducer.test.ts`

Expected: FAIL because reducer modules do not exist.

- [ ] **Step 3: Implement command-only reducer transitions**

Implement `createCreatorReducer(catalog: Catalog): Reducer<CreatorSession, CreatorAction>` so catalog access is explicit and tests can inject the minimal catalog. Every action must call core functions and replace the returned spec; no case may mutate `state.spec.visualSlots`. Use `structuredClone` only at import boundaries, not as a substitute for immutable reducer logic.

- [ ] **Step 4: Write persistence transaction tests**

Test valid save/load, corrupt JSON, unsupported schema, and storage quota errors. Corrupt or unsupported data must return a warning plus a fresh session; it must never partially hydrate.

- [ ] **Step 5: Run persistence tests and observe failure**

Run: `npx vitest run apps/creator-web/src/state/persistence.test.ts`

Expected: FAIL because persistence functions do not exist.

- [ ] **Step 6: Implement debounced localStorage persistence**

Use key `qmonster.creator.session.v1`. Save the complete `CreatorSession` after 250ms without writes during render. Wrap storage access and return diagnostics `SESSION_LOAD_FAILED` or `SESSION_SAVE_FAILED`.

- [ ] **Step 7: Run state verification**

Run: `npx vitest run apps/creator-web/src/state && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit editor state**

```bash
git add apps/creator-web/src/state apps/creator-web/src/hooks
git commit -m "feat: manage creature editing sessions with deterministic commands"
```

---

### Task 10: Desktop-First React Workbench

**Files:**
- Create: `apps/creator-web/index.html`
- Create: `apps/creator-web/vite.config.ts`
- Create: `apps/creator-web/src/main.tsx`
- Create: `apps/creator-web/src/App.tsx`
- Create: `apps/creator-web/src/styles/tokens.css`
- Create: `apps/creator-web/src/styles/workbench.css`
- Create: `apps/creator-web/src/components/GeneratorControls.tsx`
- Create: `apps/creator-web/src/components/GeneratorControls.test.tsx`
- Create: `apps/creator-web/src/components/PreviewCanvas.tsx`
- Create: `apps/creator-web/src/components/PreviewCanvas.test.tsx`
- Create: `apps/creator-web/src/components/SlotPanel.tsx`
- Create: `apps/creator-web/src/components/SlotPanel.test.tsx`
- Create: `apps/creator-web/src/components/DiagnosticsPanel.tsx`
- Create: `apps/creator-web/src/test/setup.ts`

**Interfaces:**
- Consumes: `useCreator`, renderer, catalog and export capability state.
- Produces: A responsive one-screen workbench matching spec section 9.

- [ ] **Step 1: Write controls and slot-panel interaction tests**

```tsx
it('dispatches one local reroll without changing lock state', async () => {
  const user = userEvent.setup()
  const onAction = vi.fn()
  render(<SlotPanel session={sessionFixture} onAction={onAction} />)
  await user.click(screen.getByRole('button', { name: '重抽眼睛' }))
  expect(onAction).toHaveBeenCalledWith({ type: 'rerollSlot', slotId: 'eyes' })
})

it('exposes fourteen slot rows grouped by responsibility', () => {
  render(<SlotPanel session={sessionFixture} onAction={() => undefined} />)
  expect(screen.getAllByTestId('visual-slot-row')).toHaveLength(14)
})
```

- [ ] **Step 2: Run component tests and observe failure**

Run: `npx vitest run apps/creator-web/src/components`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the app shell and desktop grid**

Create a top bar, 210px global-control rail, flexible preview, and 320px slot rail. At widths below 880px, move the slot rail below preview. At widths below 560px, stack global controls, preview, and slots. Do not add free transform controls.

Configure the app with the exact Vite entry:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
})
```

- [ ] **Step 4: Implement controls and semantic HTML**

`GeneratorControls` must use labeled native inputs/selects. `SlotPanel` must use a real checkbox for every lock, a native select for manual part choice, and a labeled button for reroll. Disable incompatible choices and expose the incompatibility reason in visible text.

- [ ] **Step 5: Implement preview lifecycle**

`PreviewCanvas` must size the backing canvas to 1024×1024, render through `renderer-canvas`, cancel stale async renders with a monotonically increasing request ID, and merge render diagnostics into the displayed diagnostic list.

Use an `ImageResolver` cache keyed by catalog version plus asset path. Fetch only the assets referenced by the current `MonsterSpec`; theme changes may retain compatible cached layers but must not preload every theme.

- [ ] **Step 6: Implement diagnostic status**

Show `14/14`, lock count, error count, theme and catalog version. `DiagnosticsPanel` must group errors before warnings and link each slot diagnostic to the corresponding labeled control.

- [ ] **Step 7: Run UI tests, typecheck, and build**

Run: `npx vitest run apps/creator-web/src/components`

Expected: PASS.

Run: `npm run typecheck && npm run build`

Expected: PASS and Vite emits the production app under `apps/creator-web/dist`.

- [ ] **Step 8: Commit the workbench**

```bash
git add apps/creator-web
git commit -m "feat: add responsive creature generator workbench"
```

---

### Task 11: Transactional Import, JSON/Image Export, and Blocking Rules

**Files:**
- Create: `apps/creator-web/src/io/spec-file.ts`
- Create: `apps/creator-web/src/io/spec-file.test.ts`
- Create: `apps/creator-web/src/io/image-file.ts`
- Create: `apps/creator-web/src/io/image-file.test.ts`
- Create: `apps/creator-web/src/components/ExportControls.tsx`
- Create: `apps/creator-web/src/components/ExportControls.test.tsx`
- Modify: `apps/creator-web/src/App.tsx`
- Modify: `apps/creator-web/src/components/GeneratorControls.tsx`
- Modify: `packages/asset-catalog/src/catalog-registry.ts`

**Interfaces:**
- Consumes: `parseMonsterSpec`, `CatalogRegistry`, `exportCanvas`, `CreatorSession.blocked`.
- Produces: `parseSpecFile`, `downloadSpec`, `downloadRenderedImage`, and export controls.

- [ ] **Step 1: Write transactional import tests**

```ts
it('does not call commit when imported JSON is invalid', async () => {
  const commit = vi.fn()
  const result = await parseSpecFile(new File(['{"schemaVersion":2}'], 'bad.json'))
  if (result.ok) commit(result.value)
  expect(result.ok).toBe(false)
  expect(commit).not.toHaveBeenCalled()
})

it('round-trips a valid spec byte-for-value after parse', async () => {
  const spec = makeValidMonsterSpecFixture()
  const file = createSpecFile(spec)
  expect(await parseSpecFile(file)).toEqual({ ok: true, value: spec })
})
```

In `image-file.test.ts`, mock `exportCanvas` to return a PNG Blob, spy on `URL.createObjectURL`, the synthetic anchor click, and `URL.revokeObjectURL`, and require the exact filename `qmonster-fungal-84721937.png`. Add a rejection case proving `WEBP_EXPORT_UNSUPPORTED` is returned to the caller rather than swallowed.

- [ ] **Step 2: Run IO tests and observe failure**

Run: `npx vitest run apps/creator-web/src/io`

Expected: FAIL because spec and image IO modules do not exist.

- [ ] **Step 3: Implement safe JSON parsing and download names**

Read a maximum of 1 MiB. Parse into an unknown value, then call `parseMonsterSpec`. Only after schema success, resolve `catalogVersion` through the injected `CatalogRegistry`: a missing version returns blocking `CATALOG_VERSION_MISSING`, while an installed noncurrent version loads and adds warning `CATALOG_VERSION_OLD`. Commit the imported spec only after both phases succeed. Generate file names as `qmonster-{themeId}-{seed}.json`. Serialize with two-space indentation and a trailing newline.

- [ ] **Step 4: Implement image downloads**

Call `exportCanvas` with `image/png` or `image/webp`. Use `qmonster-{themeId}-{seed}.{extension}`. Revoke object URLs after the synthetic anchor click. Do not catch and suppress `WEBP_EXPORT_UNSUPPORTED`; convert it to a visible warning.

- [ ] **Step 5: Write and implement blocking UI tests**

```tsx
it('disables formal exports while blocking diagnostics exist', () => {
  render(<ExportControls session={{ ...sessionFixture, blocked: true }} />)
  expect(screen.getByRole('button', { name: '导出 JSON' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeDisabled()
})

it('keeps JSON and PNG available when only WebP is unsupported', () => {
  render(<ExportControls session={{
    ...sessionFixture,
    blocked: false,
    exportCapabilities: { png: true, webp: false },
  }} />)
  expect(screen.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '导出透明 WebP' })).toBeDisabled()
})

it('keeps JSON available when no browser image encoder is usable', () => {
  render(<ExportControls session={{
    ...sessionFixture,
    blocked: false,
    exportCapabilities: { png: false, webp: false },
  }} />)
  expect(screen.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeDisabled()
})
```

- [ ] **Step 6: Run import/export verification**

Run: `npx vitest run apps/creator-web/src/io apps/creator-web/src/components/ExportControls.test.tsx`

Expected: PASS.

Run: `npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit import/export**

```bash
git add apps/creator-web/src packages/asset-catalog/src/catalog-registry.ts
git commit -m "feat: import recipes and export transparent creature files"
```

---

### Task 12: End-to-End, Performance, Cross-Browser, and Visual Release Gate

**Files:**
- Create: `tests/e2e/generator.spec.ts`
- Create: `tests/e2e/import-export.spec.ts`
- Create: `tests/e2e/performance.spec.ts`
- Create: `tests/e2e/fixtures/valid-fungal.json`
- Create: `tests/e2e/fixtures/invalid-conflict.json`
- Create: `scripts/generate-acceptance-set.ts`
- Create: `scripts/generate-acceptance-set.test.ts`
- Create: `docs/qa/v0.1-visual-acceptance.md`
- Create: `docs/qa/v0.1-release-report.md`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: Complete v0.1 application and production catalog.
- Produces: Release evidence for behavior, performance, browser degradation and 20-creature visual review.

- [ ] **Step 1: Write the failing end-to-end generation workflow**

```ts
test('locks eyes, rerolls the tail, and round-trips JSON', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('主题').selectOption('fungal')
  await page.getByLabel('锁定眼睛').check()
  const eyesBefore = await page.getByTestId('slot-eyes-value').textContent()
  const tailBefore = await page.getByTestId('slot-tail-value').textContent()
  await page.getByRole('button', { name: '重抽尾巴' }).click()
  await expect(page.getByTestId('slot-eyes-value')).toHaveText(eyesBefore ?? '')
  await expect(page.getByTestId('slot-tail-value')).not.toHaveText(tailBefore ?? '')
  await expect(page.getByText('14/14 槽位有效')).toBeVisible()
})
```

- [ ] **Step 2: Run Chromium end-to-end tests and observe failure**

Run: `npx playwright test tests/e2e/generator.spec.ts --project=chromium`

Expected: FAIL until stable test IDs, accessible labels, and workflow behavior are wired.

- [ ] **Step 3: Make the end-to-end workflow pass without test-only product branches**

Add stable `data-testid` only for values that lack a natural role. Do not expose test hooks that mutate generator state. Fix product behavior at the public command boundary.

- [ ] **Step 4: Add import, export-capability, and production-pixel determinism cases**

Cover valid import, invalid import preserving the current seed, conflict blocking all formal exports, and WebP unsupported preserving JSON/PNG. Generate the same fixed seed twice in fresh pages, hash `#preview-canvas` decoded RGBA bytes, and require equal hashes; export/import the JSON between the pages and require the imported preview hash to match as well.

- [ ] **Step 5: Add performance measurements**

Use product-level marks named `qmonster-command-start` immediately before dispatch and `qmonster-preview-commit` after the non-stale render is painted. Warm assets first, then reroll 100 times. Assert p95 local reroll at or below 150ms and no monotonic canvas/image cache growth. Measure 1024 PNG export and assert at or below 2,000ms on Chromium acceptance hardware.

- [ ] **Step 6: Write the failing acceptance-set script test**

```ts
it('produces twenty deterministic specs covering every theme and rig', async () => {
  const set = await generateAcceptanceSet({ seedStart: 2026082101, count: 20, catalog })
  expect(set).toHaveLength(20)
  expect(new Set(set.map(item => item.themeId))).toEqual(
    new Set(['deep-sea', 'fungal', 'shadow']),
  )
  expect(new Set(set.map(item => item.visualSlots.bodyFrame.rigId))).toEqual(
    new Set(['blob', 'biped', 'floating']),
  )
})
```

- [ ] **Step 7: Implement deterministic acceptance generation and contact-sheet export**

Use seeds `2026082101` through `2026082120`. Cycle required theme and rig coverage before allowing unconstrained remaining samples. Export each transparent PNG plus a numbered contact sheet and machine-readable `acceptance-set.json` under `artifacts/acceptance/v0.1/`, and add `artifacts/acceptance/` to `.gitignore`; record the reviewed seed results in tracked QA Markdown instead of committing generated images.

Add root scripts:

```json
{
  "scripts": {
    "acceptance:generate": "tsx scripts/generate-acceptance-set.ts --seed-start 2026082101 --count 20",
    "verify": "npm run typecheck && npm test && npm run catalog:validate && npm run build && npm run test:e2e"
  }
}
```

- [ ] **Step 8: Perform the human 20-creature visual gate**

For each seed, record pass/fail for:

- limb continuity and ground contact;
- no unintended penetration or layer inversion;
- camera and light consistency;
- eye, mouth and appendage perspective;
- material and palette coherence;
- friendly weirdness without horror-valley anatomy;
- theme readability.

Any failure requires an asset, anchor, mask, compatibility or catalog fix. Regenerate the entire 20-seed set and restart the consecutive pass count after a fix.

- [ ] **Step 9: Run full cross-browser verification**

Run: `npm run verify`

Expected: unit, property, catalog, build and Chromium/Firefox/WebKit workflows pass. WebKit may report WebP unavailable, but must pass generation and PNG export.

- [ ] **Step 10: Write the release report**

Record exact Node/npm versions, Git commit, catalog/schema/renderer versions, test totals, p95 reroll time, PNG export time, browser results and the 20 accepted seeds in `docs/qa/v0.1-release-report.md`.

- [ ] **Step 11: Commit release evidence**

```bash
git add .gitignore package.json package-lock.json tests scripts docs/qa
git commit -m "test: verify qmonster creator v0.1 release gates"
```

---

## Final Verification

- [ ] Run `git status --short` and confirm no generated acceptance images, source masters, build outputs, browser traces, or coverage files are staged.
- [ ] Run `npm run verify` and confirm exit 0.
- [ ] Run `npm run acceptance:generate` and confirm the reviewed 20-seed set matches the release report.
- [ ] Run `git log --oneline --decorate -12` and confirm every task has its own focused commit.
- [ ] Compare the final implementation against every heading in `docs/superpowers/specs/2026-08-21-qmonster-creator-design.md` before claiming completion.
