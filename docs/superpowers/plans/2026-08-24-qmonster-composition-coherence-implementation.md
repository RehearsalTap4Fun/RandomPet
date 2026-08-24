# QMonster Creator Composition Coherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every automatically generated result read as one coherent friendly-weird creature by adding hierarchical attachments, deterministic motif and intensity budgets, face protection, selective asset repair, and full-composite release gates.

**Architecture:** Keep the existing npm-workspaces boundaries. `generator-core` plans and validates composition, `asset-catalog` owns versioned geometry and visual-strength metadata, `renderer-canvas` resolves an attachment tree and measures face visibility, and `creator-web` displays the resulting diagnostics. Catalog `0.2.0` becomes the editable default while catalog `0.1.0` remains available only through its exact legacy rendering path.

**Tech Stack:** Node.js 22+, npm workspaces, TypeScript 7, React 19, Vite 8, Zod 4, Vitest 4, fast-check 4, Canvas 2D, Sharp, Playwright 1, AI image generation through the current Codex image workflow.

**Spec:** `docs/superpowers/specs/2026-08-24-qmonster-composition-coherence-design.md`

## Global Constraints

- Work only in the existing linked worktree on `feature/qmonster-v0.1`; preserve unrelated user changes.
- Use TDD for every behavior change: record the focused failure, implement the smallest coherent behavior, run focused and integration tests, then commit.
- Keep exactly 14 visual slots, 8 semantic slots, themes `deep-sea`/`fungal`/`shadow`, and rigs `blob`/`biped`/`floating`.
- `bodyFrame` is the only structural root. Every visible non-root render node must resolve through an explicit parent slot and socket.
- Automatically generated monsters may contain at most two parts with `visualIntensity: "strong"`.
- For `M` motif opportunity slots, at most `floor(M * 0.3)` are surprise-eligible; all other opportunities are dominant-theme-only.
- `headAppendage`, `tail`, `extraAppendage`, and `effect` must each select `none` in 35%–50% of normal-mode statistical samples.
- Eyes and mouth must each retain at least 85% visible alpha and place at least 80% of feature alpha inside the active face safe zone.
- `MonsterSpec.schemaVersion` remains `0.1.0`; the new default is `catalogVersion: 0.2.0` and `rendererVersion: 0.2.0`.
- Do not rewrite an imported `0.1.0` spec with `0.2.0` geometry. Legacy specs require the installed `0.1.0` catalog and legacy renderer semantics.
- Do not add seed-specific renderer coordinates. The regression seed `qmonster-v0.1-first-hatch` must pass through the same catalog and renderer rules as every other seed.
- Do not regenerate an asset until Tasks 1–4 establish its final metadata, placement, provenance, and validation contract.
- Do not update a rendered golden merely to satisfy a test. Review the PNG/contact sheet, record the reason, then update the reviewed artifact and hash.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `packages/generator-core/src/contracts.ts` | Shared composition policy, geometry, render-node, and metric types |
| `packages/generator-core/src/catalog-schema.ts` | Legacy-compatible parsing plus `0.2.0` composition field validation |
| `packages/generator-core/src/catalog-validation.ts` | Attachment-tree, socket coverage, quiet fallback, and optional-none structural gates |
| `packages/generator-core/src/composition.ts` | Deterministic motif plan, strong-feature accounting, and final composition diagnostics |
| `packages/generator-core/src/candidates.ts` | Candidate filtering using the current composition allowance |
| `packages/generator-core/src/generate.ts` | Structure-first generation and renderer-version selection |
| `packages/generator-core/src/reroll.ts` | Budget-aware local reroll without disturbing unrelated slots |
| `packages/generator-core/src/selection.ts` | Manual selection that preserves intentional over-budget choices as warnings |
| `packages/renderer-canvas/src/attachment-tree.ts` | Hierarchical socket/world-transform resolution and modifier subtree expansion |
| `packages/renderer-canvas/src/composition-metrics.ts` | Pure face-alpha, safe-zone, and visible-bounds calculations |
| `packages/renderer-canvas/src/layers.ts` | Legacy layer expansion and `0.2.0` resolved-node ordering |
| `packages/renderer-canvas/src/render.ts` | Body clipping, face protection, metric masks, and structured diagnostics |
| `scripts/production-paths.ts` | Version-derived catalog, asset, source, audit, review, and acceptance paths |
| `scripts/build-production-catalog.ts` | Build `0.2.0` aggregate/split catalogs and source evidence from reviewed inputs |
| `scripts/split-paired-part.ts` | Deterministic crop/trim of paired appendages into two render-node assets |
| `packages/asset-catalog/catalog/v0.2.0/*` | New composition-aware production catalog |
| `packages/asset-catalog/assets/v0.2.0/*` | New runtime PNG/WebP nodes and masks |
| `asset-source/v0.2.0/composition-manifest.json` | Reviewed attachment, geometry, intensity, motif, and clipping metadata |
| `packages/asset-catalog/review/v0.2.0/*` | Part sheets, full-composite sheet, rework decisions, and user review record |
| `apps/creator-web/src/App.tsx` | `0.2.0` default catalog, legacy read-only inspection, and composition status |
| `apps/creator-web/src/components/PreviewCanvas.tsx` | Versioned asset lookup for both installed catalogs |
| `apps/creator-web/src/components/DiagnosticsPanel.tsx` | Actionable Chinese composition diagnostics |
| `scripts/generate-acceptance-set.ts` | Fixed 20-seed set plus first-hatch regression and machine metrics |
| `docs/qa/v0.2-composition-acceptance.md` | Environment, metrics, contact-sheet decision, and final visual evidence |

---

### Task 1: Composition Catalog Contract and Structural Validation

**Files:**
- Modify: `packages/generator-core/src/contracts.ts`
- Modify: `packages/generator-core/src/catalog-schema.ts`
- Modify: `packages/generator-core/src/catalog-validation.ts`
- Modify: `packages/generator-core/src/catalog-validation.test.ts`
- Modify: `packages/generator-core/src/schema.test.ts`
- Modify: `packages/generator-core/src/test-fixtures.ts`
- Modify: `packages/generator-core/src/index.ts`

**Interfaces:**
- Consumes: existing `VisualSlotId`, `ThemeId`, `RigId`, `ApprovedTransform`, `RenderLayer`, `Catalog`, and `VisualPartDefinition`.
- Produces: `CompositionPolicy`, `PartComposition`, `RenderNodeDefinition`, `CompositionGeometry`, `Rect`, optional `Catalog.compositionPolicy`, and optional `VisualPartDefinition.composition` for legacy compatibility.

- [ ] **Step 1: Add shared composition types to `contracts.ts`**

Use these exact public shapes:

```ts
export interface Point2D { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type ClipPolicy = 'none' | 'body' | 'protect-face'
export type VisualIntensity = 'quiet' | 'strong'

export interface RenderNodeDefinition {
  id: string
  assetPath: string
  pngPath?: string
  assetSha256?: string
  pngSha256?: string
  parentSlot: VisualSlotId | null
  socket: string | null
  origin: Point2D
  transform: ApprovedTransform
  layer: RenderLayer
  compatibleRigs: RigId[]
  clipPolicy: ClipPolicy
}

export interface CompositionGeometry {
  sockets: Record<string, Point2D>
  faceSafeZone?: Rect
}

export interface PartComposition {
  isNone: boolean
  motifTags: ThemeId[]
  visualIntensity: VisualIntensity
  renderNodes: RenderNodeDefinition[]
  geometryByRig: Partial<Record<RigId, CompositionGeometry>>
}

export interface CompositionPolicy {
  motifSlots: VisualSlotId[]
  surpriseRatio: 0.3
  maxStrongFeatures: 2
  optionalNoneRate: { min: 0.35; max: 0.5 }
  frameBounds: Rect
  faceInsideRatio: 0.8
  faceVisibleRatio: 0.85
}
```

Add `compositionPolicy?: CompositionPolicy` to `Catalog` and `composition?: PartComposition` to `VisualPartDefinition`. Optionality is only the parsing boundary for installed `0.1.0`; production `0.2.0` validation makes the fields mandatory.

- [ ] **Step 2: Write failing Schema tests**

Add tests that parse the legacy fixture unchanged, parse a composition-aware fixture, and reject a negative rectangle or an unknown parent slot:

```ts
it('keeps the installed 0.1.0 catalog parseable without composition metadata', () => {
  expect(parseCatalog(makeValidCatalogFixture()).ok).toBe(true)
})

it('parses the exact 0.2.0 composition policy and render-node contract', () => {
  const catalog = makeCompositionCatalogFixture()
  expect(parseCatalog(catalog)).toEqual({ ok: true, value: catalog })
})

it('rejects non-positive render-node transforms and face rectangles', () => {
  const catalog = makeCompositionCatalogFixture() as any
  catalog.parts[0].composition.renderNodes[0].transform.scale = 0
  catalog.parts[1].composition.geometryByRig.blob.faceSafeZone.width = -1
  const result = parseCatalog(catalog)
  expect(result.ok).toBe(false)
})
```

- [ ] **Step 3: Run Schema tests and record the failure**

Run: `npx vitest run packages/generator-core/src/schema.test.ts`

Expected: FAIL because the composition types and Zod schemas do not exist.

- [ ] **Step 4: Extend `CatalogSchema` without weakening legacy validation**

Create strict Zod schemas mirroring Step 1. Coordinates remain finite in `[0, 2048]`; rectangles require positive width/height and must fit inside 2048 local pixels; transforms require positive finite scale. Add the optional fields to the existing part/catalog objects rather than replacing the `0.1.0` fields.

```ts
const RectSchema = z.object({
  x: coordinate,
  y: coordinate,
  width: z.number().finite().positive().max(2048),
  height: z.number().finite().positive().max(2048),
}).refine(rect => rect.x + rect.width <= 2048 && rect.y + rect.height <= 2048, {
  message: 'Rectangle must fit inside the 2048px local canvas.',
})
```

- [ ] **Step 5: Add a complete composition fixture**

Add the following constant to `contracts.ts`, then implement `makeCompositionCatalogFixture()` in `test-fixtures.ts` by starting from `makeValidCatalogFixture()`, setting version `0.2.0`, and applying the map:

```ts
export const COMPOSITION_PARENT_BY_SLOT: Record<VisualSlotId, VisualSlotId | null> = {
  bodyFrame: null,
  headShape: 'bodyFrame',
  eyes: 'headShape',
  mouthShape: 'headShape',
  oralDetail: 'mouthShape',
  headAppendage: 'headShape',
  arms: 'bodyFrame',
  legs: 'bodyFrame',
  tail: 'bodyFrame',
  extraAppendage: 'bodyFrame',
  surfaceMaterial: 'bodyFrame',
  pattern: 'bodyFrame',
  colorScheme: 'bodyFrame',
  effect: 'bodyFrame',
}
```

The fixture body provides `head`, `headAlternate`, `armLeft`, `armRight`, `legLeft`, `legRight`, `tail`, `wingLeft`, `wingRight`, `overlay`, and `effect`; the head provides `eyes`, `mouth`, and `headAppendage` plus `faceSafeZone`; the mouth provides `oralDetail`. Explicit-none parts have zero nodes, empty geometry, `quiet` intensity, and empty motif tags.

Also export this fixture builder for later renderer tests:

```ts
export function makeValidCompositionSpecFixture(
  catalog: Catalog = makeCompositionCatalogFixture(),
): MonsterSpec {
  const spec = makeValidMonsterSpecFixture()
  spec.catalogVersion = '0.2.0'
  spec.rendererVersion = '0.2.0'
  for (const slotId of VISUAL_SLOT_IDS) {
    const part = catalog.parts.find(candidate => candidate.slotId === slotId)!
    spec.visualSlots[slotId] = { partId: part.id, rigId: 'blob' }
  }
  return spec
}
```

- [ ] **Step 6: Write failing structural catalog tests**

```ts
it('rejects a visible non-root node without an explicit parent socket', () => {
  const catalog = makeCompositionCatalogFixture()
  const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
  eyes.composition!.renderNodes[0]!.socket = null
  expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
    code: 'COMPOSITION_SOCKET_MISSING',
  }))
})

it('requires quiet fallbacks and face geometry for every compatible rig', () => {
  const catalog = makeCompositionCatalogFixture()
  catalog.parts = catalog.parts.filter(part => part.slotId !== 'eyes' || part.composition?.visualIntensity === 'strong')
  delete catalog.parts.find(part => part.slotId === 'headShape')!
    .composition!.geometryByRig.blob!.faceSafeZone
  const codes = validateCatalogStructure(catalog).map(item => item.code)
  expect(codes).toContain('COMPOSITION_QUIET_FALLBACK_MISSING')
  expect(codes).toContain('COMPOSITION_FACE_ZONE_MISSING')
})
```

Also cover duplicate node IDs, a node targeting the wrong parent slot, a socket absent from one compatible parent part, non-none with zero nodes, `none` with visible nodes, and duplicate motif slots.

- [ ] **Step 7: Implement structural validation**

When `catalog.compositionPolicy` is present, enforce:

```ts
const REQUIRED_PROVIDER_SOCKETS: Partial<Record<VisualSlotId, readonly string[]>> = {
  bodyFrame: ['head', 'headAlternate', 'armLeft', 'armRight', 'legLeft', 'legRight', 'tail', 'wingLeft', 'wingRight', 'overlay', 'effect'],
  headShape: ['eyes', 'mouth', 'headAppendage'],
  mouthShape: ['oralDetail'],
}
```

For each node, every compatible parent candidate for the same rig must expose its requested socket. Every mandatory slot must have a quiet candidate for every required theme/rig combination. Optional slots must have an explicit `composition.isNone === true` candidate; do not infer none from the part ID. Return the diagnostic codes named in the spec.

For composition-aware parts, `part.approvedTransforms` must be absent or empty and `MonsterSpec.visualSlots[slotId].transform` must be undefined. Node transforms are catalog-authored per node; accepting both part- and node-level transforms would make socket geometry ambiguous. Legacy catalogs retain the existing approved-transform behavior.

- [ ] **Step 8: Run focused and core tests**

Run: `npx vitest run packages/generator-core/src/schema.test.ts packages/generator-core/src/catalog-validation.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 9: Commit the catalog contract**

```bash
git add packages/generator-core/src
git commit -m "feat: define composition-aware catalog contracts"
```

---

### Task 2: Deterministic Motif, Intensity, and Leave-Blank Budgets

**Files:**
- Create: `packages/generator-core/src/composition.ts`
- Create: `packages/generator-core/src/composition.test.ts`
- Modify: `packages/generator-core/src/candidates.ts`
- Modify: `packages/generator-core/src/candidates.test.ts`
- Modify: `packages/generator-core/src/generate.ts`
- Modify: `packages/generator-core/src/generate.test.ts`
- Modify: `packages/generator-core/src/reroll.ts`
- Modify: `packages/generator-core/src/selection.ts`
- Modify: `packages/generator-core/src/spec-validation.ts`
- Modify: `packages/generator-core/src/index.ts`

**Interfaces:**
- Consumes: Task 1 `CompositionPolicy`, `PartComposition`, existing PRNG, generation request, locks, selected parts, and catalog.
- Produces: `CompositionPlan`, `planComposition()`, `compositionAllowanceForSlot()`, `validateCompositionSelections()`, and composition-aware candidate traces.

- [ ] **Step 1: Write planner tests before implementation**

Use these contracts in the test imports:

```ts
export type MotifMode = 'neutral' | 'dominant' | 'surprise'
export interface CompositionPlan {
  motifModes: Record<VisualSlotId, MotifMode>
  maxStrongFeatures: number
}
export function planComposition(
  seed: string,
  themeId: ThemeId,
  rigId: RigId,
  catalog: Catalog,
): CompositionPlan
```

Add:

```ts
it('assigns at most floor(M * 0.3) stable surprise opportunities', () => {
  const catalog = makeCompositionCatalogFixture()
  const first = planComposition('motif-seed', 'fungal', 'blob', catalog)
  const second = planComposition('motif-seed', 'fungal', 'blob', catalog)
  expect(second).toEqual(first)
  const surprise = Object.values(first.motifModes).filter(mode => mode === 'surprise')
  expect(surprise).toHaveLength(Math.floor(catalog.compositionPolicy!.motifSlots.length * 0.3))
})

it('reports three manual strong selections as a warning without changing them', () => {
  const catalog = makeCompositionCatalogFixtureWithStrongParts()
  const spec = makeValidCompositionSpecFixture(catalog)
  selectStrongParts(spec, catalog, ['headShape', 'eyes', 'effect'])
  const diagnostics = validateCompositionSelections(spec, catalog, planComposition(
    spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, catalog,
  ))
  expect(diagnostics).toContainEqual(expect.objectContaining({
    severity: 'warning', code: 'COMPOSITION_INTENSITY_EXCEEDED',
  }))
})
```

In the same test file, define `makeCompositionCatalogFixtureWithStrongParts()` by cloning the Task 1 fixture and adding one quiet fungal and one strong foreign candidate to `headShape`, `eyes`, and `effect`. Define `selectStrongParts(spec, catalog, slotIds)` to assign the first strong candidate in each named slot; both are test-only helpers, while `makeValidCompositionSpecFixture` comes from `test-fixtures.ts`.

- [ ] **Step 2: Run planner tests and record the missing-module failure**

Run: `npx vitest run packages/generator-core/src/composition.test.ts`

Expected: FAIL because `composition.ts` is absent.

- [ ] **Step 3: Implement the deterministic composition plan**

For legacy catalogs return all slots as `neutral` and an effectively unbounded strong budget. For `0.2.0`, rank motif slots without shared RNG consumption:

```ts
const ranked = policy.motifSlots
  .map(slotId => ({
    slotId,
    roll: createRng([seed, themeId, rigId, slotId, 'motif-plan']).nextFloat(),
  }))
  .sort((left, right) => left.roll - right.roll
    || VISUAL_SLOT_IDS.indexOf(left.slotId) - VISUAL_SLOT_IDS.indexOf(right.slotId))
const surprise = new Set(ranked.slice(0, Math.floor(ranked.length * policy.surpriseRatio)).map(item => item.slotId))
```

Mark catalog motif slots as `dominant` or `surprise`; all remaining slots are `neutral`. Export a pure `strongFeatureCount(spec, catalog): number` helper.

- [ ] **Step 4: Add failing candidate-filter tests**

```ts
it('filters foreign motifs and strong candidates when the current allowance is exhausted', () => {
  const result = buildCandidates({
    catalog: makeCompositionCatalogFixtureWithStrongParts(),
    slotId: 'eyes', themeId: 'fungal', rigId: 'blob', selections: {},
    rng: createRng(['budget-filter']),
    composition: { motifMode: 'dominant', remainingStrong: 0 },
  })
  expect(result.trace.candidateIds).not.toContain('eyes_triple_foreign')
  expect(result.trace.candidateIds).toContain('eyes_quiet_fungal')
})
```

Also prove that a surprise slot may draw either dominant or foreign parts, an explicit none is always quiet/theme-neutral, and an empty dominant pool sets `trace.themeFallback === true` before using a foreign candidate.

- [ ] **Step 5: Make `buildCandidates` consume an optional composition allowance**

Extend `BuildCandidatesInput` with:

```ts
composition?: {
  motifMode: MotifMode
  remainingStrong: number
}
```

For composition-aware catalogs, filter strong parts when `remainingStrong <= 0`; in dominant slots prefer candidates where `isNone` or `motifTags.includes(themeId)`. Only if that pool is empty use the compatible pool and set `themeFallback`. Keep the existing rarity/base/theme/semantic weighting inside the resulting pool. Legacy catalogs retain the current 70/30 branch exactly.

- [ ] **Step 6: Generate structure first and reserve locked intensity**

Change `GENERATION_ORDER` to:

```ts
[
  'bodyFrame', 'headShape', 'eyes', 'mouthShape', 'oralDetail',
  'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
  'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
]
```

Before full random selection, count strong locked parts so the generator does not spend their capacity on earlier unlocked slots. During a local reroll, count every preserved selection except the target slot; during manual selection, count every other selected slot. For each newly resolved slot pass its motif mode and current `remainingStrong` to `buildCandidates`. Append `COMPOSITION_THEME_FALLBACK` when a dominant slot had no on-theme candidate. After selection, append `validateCompositionSelections`; `blocked` remains based only on error diagnostics.

Set generated versions with one function:

```ts
export function rendererVersionForCatalog(catalog: Catalog): '0.1.0' | '0.2.0' {
  return catalog.compositionPolicy === undefined ? '0.1.0' : '0.2.0'
}
```

- [ ] **Step 7: Add generation, reroll, and manual-selection tests**

```ts
it('never auto-generates more than two strong parts over 500 seeds', () => {
  const catalog = makeCompositionCatalogFixtureWithStrongParts()
  for (let index = 0; index < 500; index += 1) {
    const result = generateMonster({ seed: `strong-${index}`, themeId: 'fungal', mode: 'normal' }, catalog)
    expect(strongFeatureCount(result.spec, catalog)).toBeLessThanOrEqual(2)
  }
})

it('keeps unrelated motif assignments and selections stable during a local reroll', () => {
  const catalog = makeCompositionCatalogFixtureWithStrongParts()
  const initial = generateMonster({ seed: 'local-budget', themeId: 'shadow', mode: 'normal' }, catalog).spec
  const locks = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [slotId, false])) as Record<VisualSlotId, boolean>
  const rerolled = rerollSlot({ spec: initial, slotId: 'eyes', locks, catalog }).spec
  const rigId = initial.visualSlots.bodyFrame.rigId
  expect(rerolled.visualSlots.tail).toEqual(initial.visualSlots.tail)
  expect(planComposition(initial.seed, initial.themeId, rigId, catalog))
    .toEqual(planComposition(rerolled.seed, rerolled.themeId, rigId, catalog))
})
```

Manual selection of a third strong part must preserve the requested part and return a warning. A structurally incompatible part remains blocked. Update replaceable diagnostic codes in `creator-reducer.ts` later in Task 6, not in this task.

- [ ] **Step 8: Run core verification**

Run: `npx vitest run packages/generator-core/src/composition.test.ts packages/generator-core/src/candidates.test.ts packages/generator-core/src/generate.test.ts packages/generator-core/src/reroll.test.ts packages/generator-core/src/selection.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 9: Commit composition planning**

```bash
git add packages/generator-core
git commit -m "feat: enforce deterministic creature composition budgets"
```

---

### Task 3: Hierarchical Attachment Renderer and Face Protection

**Files:**
- Create: `packages/renderer-canvas/src/attachment-tree.ts`
- Create: `packages/renderer-canvas/src/attachment-tree.test.ts`
- Create: `packages/renderer-canvas/src/composition-metrics.ts`
- Create: `packages/renderer-canvas/src/composition-metrics.test.ts`
- Modify: `packages/renderer-canvas/src/types.ts`
- Modify: `packages/renderer-canvas/src/layers.ts`
- Modify: `packages/renderer-canvas/src/layout.ts`
- Modify: `packages/renderer-canvas/src/render.ts`
- Modify: `packages/renderer-canvas/src/render.test.ts`
- Modify: `packages/renderer-canvas/src/index.ts`
- Modify: `packages/generator-core/src/spec-validation.ts`
- Modify: `packages/generator-core/src/spec-validation.test.ts`
- Modify: `apps/creator-web/src/App.test.tsx`
- Modify: `apps/creator-web/src/components/PreviewCanvas.test.tsx`

**Interfaces:**
- Consumes: Task 1 render nodes/geometries/policy, Task 2 renderer-version mapping, `MonsterSpec`, and existing Canvas resolver/surface factory.
- Produces: `resolveAttachmentTree()`, `ResolvedRenderNode`, `CompositionMetrics`, and render diagnostics for sockets, face placement, face visibility, and bounds.

- [ ] **Step 1: Define resolved-node and metric types**

Add to renderer `types.ts`:

```ts
export interface WorldRect { x: number; y: number; width: number; height: number }
export interface ResolvedRenderNode {
  key: string
  slotId: VisualSlotId
  part: VisualPartDefinition
  node: RenderNodeDefinition
  placement: Placement
  sequence: number
}
export interface CompositionMetrics {
  eyesInsideRatio: number
  eyesVisibleRatio: number
  mouthInsideRatio: number
  mouthVisibleRatio: number
  visibleBounds: WorldRect | null
}
export interface AttachmentTreeResult {
  nodes: ResolvedRenderNode[]
  faceSafeZones: WorldRect[]
  parentChainBySlot: Partial<Record<VisualSlotId, VisualSlotId[]>>
  diagnostics: Diagnostic[]
}
```

Extend `RenderResult` with `compositionMetrics: CompositionMetrics | null`. Legacy renders return `null`.

- [ ] **Step 2: Write failing attachment-transform tests**

```ts
it('resolves body -> head -> eyes through local sockets', () => {
  const catalog = makeCompositionCatalogFixture()
  const spec = makeValidCompositionSpecFixture(catalog)
  const result = resolveAttachmentTree(spec, catalog)
  expect(result.diagnostics).toEqual([])
  expect(result.nodes.find(node => node.slotId === 'eyes')?.placement).toEqual({
    x: expect.any(Number), y: expect.any(Number), scaleX: 1, scaleY: 1,
  })
  expect(result.parentChainBySlot.eyes).toEqual(['bodyFrame', 'headShape', 'eyes'])
})

it('does not fall back to canvas center for a missing child socket', () => {
  const catalog = makeCompositionCatalogFixture()
  delete catalog.parts.find(part => part.slotId === 'headShape')!
    .composition!.geometryByRig.blob!.sockets.eyes
  const result = resolveAttachmentTree(makeValidCompositionSpecFixture(catalog), catalog)
  expect(result.nodes.some(node => node.slotId === 'eyes')).toBe(false)
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: 'COMPOSITION_SOCKET_MISSING',
  }))
})
```

Add a mirrored-child test proving socket/world conversion uses signed `scaleX` and a paired-arm test proving one selected part expands into two independently placed nodes.

- [ ] **Step 3: Run attachment tests and record failure**

Run: `npx vitest run packages/renderer-canvas/src/attachment-tree.test.ts`

Expected: FAIL because attachment-tree resolution is absent.

- [ ] **Step 4: Implement recursive world placement**

Use these formulas; do not use the old `socket: null -> {1024,1024}` fallback for composition nodes:

```ts
function worldPoint(parent: Placement, local: Point2D): Point2D {
  return {
    x: parent.x + local.x * parent.scaleX,
    y: parent.y + local.y * parent.scaleY,
  }
}

function childPlacement(socket: Point2D, node: RenderNodeDefinition): Placement {
  const scaleX = node.transform.mirrorX ? -node.transform.scale : node.transform.scale
  return {
    x: socket.x - node.origin.x * scaleX,
    y: socket.y - node.origin.y * node.transform.scale,
    scaleX,
    scaleY: node.transform.scale,
  }
}
```

Root nodes align their origin to `{x: 1024, y: 1024}`. Resolve slots in the exact structure-first order from Task 2. A socket-providing part must have one provider node; the catalog validator rejects ambiguous providers before rendering.

The composition path uses only `RenderNodeDefinition.transform`. `validateMonsterSpecAgainstCatalog` returns `SPEC_TRANSFORM_INVALID` if a `0.2.0` selection carries the legacy `VisualSelection.transform`; the legacy renderer continues using the existing part-level transform contract.

For `mutation_double_head`, clone the complete `headShape` subtree and re-root it at the selected body part's `headAlternate` socket. Translate the cloned head's safe zone by the same socket delta and add it to `faceSafeZones`. For `aberration_misplaced_eye`, move the eyes node by the `head -> headAlternate` delta and add the equivalently translated face zone; metrics treat alpha inside either declared zone as in-zone. Nodes outside all declared zones remain blocking errors.

- [ ] **Step 5: Write pure composition-metric tests**

`composition-metrics.ts` consumes alpha masks, so tests do not depend on browser rasterization:

```ts
function alphaMask(width: number, height: number, points: readonly (readonly [number, number])[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (const [x, y] of points) pixels[(y * width + x) * 4 + 3] = 255
  return pixels
}

it('computes safe-zone and post-occluder alpha ratios', () => {
  const feature = alphaMask(4, 4, [[1, 1], [2, 1], [1, 2], [2, 2]])
  const occluder = alphaMask(4, 4, [[2, 1]])
  const metric = measureFeatureAlpha(feature, occluder, 4, 4, { x: 1, y: 1, width: 2, height: 2 })
  expect(metric.insideRatio).toBe(1)
  expect(metric.visibleRatio).toBe(0.75)
})

it('returns null bounds for a transparent image and exact bounds otherwise', () => {
  expect(measureVisibleBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  expect(measureVisibleBounds(alphaMask(4, 4, [[1, 2], [3, 3]]), 4, 4))
    .toEqual({ x: 1, y: 2, width: 3, height: 2 })
})
```

- [ ] **Step 6: Integrate body clipping and face-protected effects**

In the composition renderer allocate reusable 2048 surfaces for the body alpha, eyes alpha, mouth alpha, and later occluder alpha. Apply node clipping as follows:

```ts
switch (node.clipPolicy) {
  case 'body':
    layerContext.globalCompositeOperation = 'destination-in'
    layerContext.drawImage(bodyMask.canvas, 0, 0)
    break
  case 'protect-face':
    layerContext.save()
    layerContext.globalCompositeOperation = 'destination-out'
    for (const face of faceSafeZones) {
      layerContext.fillRect(face.x, face.y, face.width, face.height)
    }
    layerContext.restore()
    break
}
```

After drawing, read mask alpha once, calculate the Task 1 thresholds, and append:

```ts
COMPOSITION_FACE_OUT_OF_ZONE
COMPOSITION_FACE_OCCLUDED
COMPOSITION_BOUNDS_EXCEEDED
```

All are error diagnostics. Paths for eye/mouth errors are `['visualSlots', 'eyes']` and `['visualSlots', 'mouthShape']`; bounds errors use `['visualSlots', 'bodyFrame']`.

Update every existing `PreviewRenderer` test double in `App.test.tsx` and `PreviewCanvas.test.tsx` to return `compositionMetrics: null`; composition-specific tests return measured values. This keeps `RenderResult` required and prevents older mocks from weakening the contract.

- [ ] **Step 7: Preserve the exact legacy renderer path**

`expandRenderLayers` and `resolvePartPlacement` remain the `0.1.0` implementation. `renderMonster` selects the composition path only when `catalog.compositionPolicy` exists and `spec.rendererVersion === '0.2.0'`. Update spec validation to derive the required renderer version from the catalog rather than accepting only one global string.

```ts
const expectedRenderer = rendererVersionForCatalog(catalog)
if (spec.rendererVersion !== expectedRenderer) {
  diagnostics.push(error('SPEC_RENDERER_VERSION_UNSUPPORTED', ['rendererVersion'],
    `Catalog ${catalog.version} requires renderer ${expectedRenderer}.`))
}
```

- [ ] **Step 8: Add renderer integration tests**

Cover multi-node draw order, body-clipped surface, protected-face effect, under-85% visible alpha, under-80% inside alpha, bounds overflow, source `MonsterSpec` immutability, and no resolver calls after structural validation failure. Keep the existing `0.1.0` renderer tests byte-for-byte in intent and ensure they still pass.

- [ ] **Step 9: Run renderer verification**

Run: `npx vitest run packages/renderer-canvas/src/attachment-tree.test.ts packages/renderer-canvas/src/composition-metrics.test.ts packages/renderer-canvas/src/render.test.ts packages/generator-core/src/spec-validation.test.ts`

Expected: PASS.

Run: `npm run test:render-golden`

Expected: the legacy synthetic golden passes unchanged.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 10: Commit the renderer architecture**

```bash
git add packages/renderer-canvas packages/generator-core/src/spec-validation.ts packages/generator-core/src/spec-validation.test.ts
git commit -m "feat: render creatures through hierarchical attachments"
```

---

### Task 4: Versioned Production Pipeline and Installed-Catalog Registry

**Files:**
- Create: `scripts/production-paths.ts`
- Create: `scripts/production-paths.test.ts`
- Modify: `scripts/build-production-catalog.ts`
- Modify: `scripts/build-production-catalog.test.ts`
- Modify: `scripts/build-runtime-assets.ts`
- Modify: `scripts/build-runtime-assets.test.ts`
- Modify: `scripts/build-color-scheme-masks.ts`
- Modify: `scripts/render-production-contact-sheets.ts`
- Modify: `scripts/render-production-contact-sheets.test.ts`
- Modify: `packages/asset-catalog/src/cli.ts`
- Modify: `packages/asset-catalog/src/production-validation.ts`
- Modify: `packages/asset-catalog/src/production-validation.test.ts`
- Modify: `packages/asset-catalog/package.json`
- Modify: `apps/creator-web/src/components/PreviewCanvas.tsx`
- Modify: `apps/creator-web/src/components/PreviewCanvas.test.tsx`

**Interfaces:**
- Consumes: existing production scripts and Task 1 catalog contract.
- Produces: `productionPaths(version)`, CLI options `--source-index`/`--evidence-manifest`, version-neutral builders, and browser asset lookup for installed `0.1.0`/`0.2.0` catalogs.

- [ ] **Step 1: Write failing path tests**

```ts
it('derives every production root from a validated semantic version', () => {
  expect(productionPaths('0.2.0')).toEqual({
    catalogDirectory: 'packages/asset-catalog/catalog/v0.2.0',
    assetDirectory: 'packages/asset-catalog/assets/v0.2.0',
    sourceRoot: 'asset-source/v0.2.0',
    sourceIndexPath: 'packages/asset-catalog/source-index-v0.2.0.json',
    auditDirectory: 'packages/asset-catalog/audit/v0.2.0',
    reviewDirectory: 'packages/asset-catalog/review/v0.2.0',
    acceptanceDirectory: 'artifacts/acceptance/v0.2',
  })
})

it('rejects path separators and prerelease labels as production versions', () => {
  expect(() => productionPaths('../0.2.0')).toThrow('Invalid production version')
  expect(() => productionPaths('0.2.0-rc.1')).toThrow('Invalid production version')
})
```

- [ ] **Step 2: Run path tests and record failure**

Run: `npx vitest run scripts/production-paths.test.ts`

Expected: FAIL because the versioned path module does not exist.

- [ ] **Step 3: Implement and thread `ProductionPaths` through scripts**

```ts
export interface ProductionPaths {
  catalogDirectory: string
  assetDirectory: string
  sourceRoot: string
  sourceIndexPath: string
  auditDirectory: string
  reviewDirectory: string
  acceptanceDirectory: string
}

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
export function productionPaths(version: string): ProductionPaths {
  if (!RELEASE_VERSION.test(version)) throw new Error(`Invalid production version: ${version}`)
  const tag = `v${version}`
  const legacySourceIndex = version === '0.1.0'
  return {
    catalogDirectory: `packages/asset-catalog/catalog/${tag}`,
    assetDirectory: `packages/asset-catalog/assets/${tag}`,
    sourceRoot: `asset-source/${tag}`,
    sourceIndexPath: legacySourceIndex
      ? 'packages/asset-catalog/source-index.json'
      : `packages/asset-catalog/source-index-${tag}.json`,
    auditDirectory: `packages/asset-catalog/audit/${tag}`,
    reviewDirectory: `packages/asset-catalog/review/${tag}`,
    acceptanceDirectory: `artifacts/acceptance/v${version.split('.').slice(0, 2).join('.')}`,
  }
}
```

Replace hard-coded `v0.1.0` roots in the listed scripts with a `ProductionPaths` parameter. Builders accept a required `--version`; existing legacy tests pass `0.1.0` explicitly. No script may infer the version from the current date or Git branch.

- [ ] **Step 4: Make the production CLI accept explicit evidence paths**

Add:

```text
--source-index packages/asset-catalog/source-index-v0.2.0.json
--evidence-manifest packages/asset-catalog/audit/v0.2.0/evidence-manifest.json
```

Both are required together with `--production`; resolve and validate them using the same canonical path checks already used for source-root data. Remove the internal hard-coded `audit/v0.1.0` and `source-index.json` derivations.

- [ ] **Step 5: Validate node resources and composition evidence**

Extend file/stale-resource collection to include every `composition.renderNodes[].assetPath/pngPath` and hash. Production `0.2.0` rejects a part without composition metadata, a node without PNG/WebP hashes, a missing part-level `rework-record.json`, or evidence paths pointing at another version. Legacy `0.1.0` keeps its current production checks. Full-composite acceptance remains the Task 7 release gate so it does not circularly block the first valid catalog build.

- [ ] **Step 6: Add versioned browser asset resolution tests**

```ts
it('builds an exact versioned asset key without fallback', async () => {
  expect(catalogAssetKey('0.2.0', 'parts/eyes_glossy_pair.png'))
    .toContain('/assets/v0.2.0/parts/eyes_glossy_pair.png')
  await expect(resolveProductionAssetUrl('0.1.0', 'parts/eyes_glossy_pair.png')).resolves.toMatch(/v0\.1\.0/)
  await expect(resolveProductionAssetUrl('9.9.9', 'parts/eyes_glossy_pair.png')).rejects.toThrow('not bundled')
})
```

Export `catalogAssetKey(catalogVersion, assetPath): string`. Use one literal Vite glob rooted at `assets/v*/**/*.{png,webp}` and build the lookup key through that function; never fall back from `0.2.0` to a same-named `0.1.0` file.

- [ ] **Step 7: Add catalog validation scripts**

Set package scripts to:

```json
{
  "validate": "npm run validate:v0.1.0",
  "validate:v0.1.0": "tsx src/cli.ts catalog/v0.1.0/catalog.json assets/v0.1.0 --production --source-index source-index.json --evidence-manifest audit/v0.1.0/evidence-manifest.json",
  "validate:v0.2.0": "tsx src/cli.ts catalog/v0.2.0/catalog.json assets/v0.2.0 --production --source-index source-index-v0.2.0.json --evidence-manifest audit/v0.2.0/evidence-manifest.json"
}
```

Paths are relative to `packages/asset-catalog` because npm executes workspace scripts from that directory. Task 5 flips `validate` to `validate:v0.2.0` only after the new catalog exists and passes.

- [ ] **Step 8: Run pipeline tests**

Run: `npx vitest run scripts/production-paths.test.ts scripts/build-production-catalog.test.ts scripts/build-runtime-assets.test.ts scripts/render-production-contact-sheets.test.ts packages/asset-catalog/src/production-validation.test.ts apps/creator-web/src/components/PreviewCanvas.test.tsx`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 9: Commit versioned production support**

```bash
git add scripts packages/asset-catalog/src packages/asset-catalog/package.json apps/creator-web/src/components/PreviewCanvas.tsx apps/creator-web/src/components/PreviewCanvas.test.tsx
git commit -m "build: version composition asset production"
```

---

### Task 5: Build Catalog 0.2.0 and Selectively Repair Assets

**Files:**
- Create: `scripts/split-paired-part.ts`
- Create: `scripts/split-paired-part.test.ts`
- Create: `asset-source/v0.2.0/composition-manifest.json`
- Create: `asset-source/v0.2.0/generation/composition-rework.json`
- Create/Modify: `asset-source/v0.2.0/parts/*`
- Create: `packages/asset-catalog/catalog/v0.2.0/catalog.json`
- Create: `packages/asset-catalog/catalog/v0.2.0/themes.json`
- Create: `packages/asset-catalog/catalog/v0.2.0/rigs.json`
- Create: `packages/asset-catalog/catalog/v0.2.0/parts.json`
- Create: `packages/asset-catalog/catalog/v0.2.0/semantic-traits.json`
- Create: `packages/asset-catalog/catalog/v0.2.0/modifiers.json`
- Create/Modify: `packages/asset-catalog/assets/v0.2.0/**/*`
- Create: `packages/asset-catalog/source-index-v0.2.0.json`
- Create: `packages/asset-catalog/audit/v0.2.0/evidence-manifest.json`
- Create: `packages/asset-catalog/review/v0.2.0/rework-record.json`
- Create: `packages/asset-catalog/review/v0.2.0/contact-sheet-blob.png`
- Create: `packages/asset-catalog/review/v0.2.0/contact-sheet-biped.png`
- Create: `packages/asset-catalog/review/v0.2.0/contact-sheet-floating.png`
- Create: `packages/asset-catalog/review/v0.2.0/contact-sheet-index.json`
- Modify: `packages/asset-catalog/package.json`
- Modify: `scripts/qmonster-part-production.ts`
- Modify: `scripts/build-production-catalog.ts`
- Modify: `scripts/build-production-catalog.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 contracts, versioned paths, existing approved `0.1.0` sources, chroma extraction gates, masks, and asset provenance.
- Produces: a complete production-valid `0.2.0` catalog and runtime asset tree with explicit composition metadata for every part.

- [ ] **Step 1: Add a deterministic paired-part splitter**

The splitter accepts an input PNG and two explicit crops/anchors, trims transparent margins, writes left/right PNGs plus WebPs, and returns node origins relative to each cropped image:

```ts
export interface PairCrop {
  id: 'left' | 'right'
  rect: { left: number; top: number; width: number; height: number }
  anchor: { x: number; y: number }
  mirrorX: boolean
}
export interface SplitNodeResult {
  id: 'left' | 'right'
  pngPath: string
  webpPath: string
  pngSha256: string
  webpSha256: string
  width: number
  height: number
  origin: { x: number; y: number }
  mirrorX: boolean
}
export async function splitPairedPart(
  inputPath: string,
  outputDirectory: string,
  crops: readonly [PairCrop, PairCrop],
): Promise<readonly [SplitNodeResult, SplitNodeResult]>
```

Test that out-of-bounds crops reject before any writes, transparent trim preserves anchor coordinates, and rerunning produces identical decoded RGBA and node metadata.

- [ ] **Step 2: Run the splitter tests and record failure**

Run: `npx vitest run scripts/split-paired-part.test.ts`

Expected: FAIL because the splitter does not exist.

- [ ] **Step 3: Implement the splitter with Sharp and safe output roots**

Use `sharp.extract()`, alpha trim based on the existing production threshold, and the existing `safe-output.ts` canonical-root guard. PNG output uses fixed compression settings; WebP uses the same lossless production settings as `build-runtime-assets.ts`. Never delete or overwrite files outside `asset-source/v0.2.0` and `packages/asset-catalog/assets/v0.2.0`.

- [ ] **Step 4: Create the `0.2.0` source tree non-destructively**

Copy approved `asset-source/v0.1.0` inputs and runtime assets into new `v0.2.0` roots; do not modify or remove the legacy directories. Generate `composition-manifest.json` with this root policy:

```json
{
  "catalogVersion": "0.2.0",
  "rendererVersion": "0.2.0",
  "policy": {
    "motifSlots": ["headShape", "eyes", "mouthShape", "oralDetail", "headAppendage", "arms", "legs", "tail", "extraAppendage", "surfaceMaterial", "pattern", "effect"],
    "surpriseRatio": 0.3,
    "maxStrongFeatures": 2,
    "optionalNoneRate": { "min": 0.35, "max": 0.5 },
    "frameBounds": { "x": 96, "y": 64, "width": 1856, "height": 1888 },
    "faceInsideRatio": 0.8,
    "faceVisibleRatio": 0.85
  }
}
```

The build script migrates every unchanged single-node part using the exact parent map from Task 1. Body, head, and mouth records must explicitly supply geometry per compatible rig. Arms, legs, and paired wings must explicitly list left/right nodes. This guarantees all parts are represented without hand-copying generated catalog JSON.

- [ ] **Step 5: Record and execute the seven-part rework decision**

Write `composition-rework.json` with exactly these actions:

| Part | Action | Required result |
| --- | --- | --- |
| `legs_mushroom` | regenerate, then split | two weight-bearing foot nodes attached to `legLeft`/`legRight`; no cap-like mass in the face zone |
| `arms_long_noodle` | crop/split | separate left/right nodes with body contact at `armLeft`/`armRight` |
| `head_mushroom_cap` | metadata/scale | strong feature, one head node, explicit face safe zone |
| `surface_soft_scales` | metadata/clip | quiet feature clipped to body alpha |
| `oral_gummy_ridges` | metadata/anchor | quiet feature attached only to `mouthShape.oralDetail` |
| `effect_spore_glow` | metadata/clip | strong feature at `bodyFrame.effect` with `protect-face` |
| `eyes_triple_pearl` and `mouth_wide_grin` | intensity audit | both strong; generator cannot combine both with a third strong part |

For `legs_mushroom`, first inspect the `biped` base and the current leg asset, then use the current Codex image-generation workflow with this prompt:

```text
Create one modular paired-feet asset for the supplied friendly 3D cartoon monster base: two short mushroom-inspired feet with clear soles and narrow ankle attachment points, three-quarter front view, soft tactile fungal material, warm studio light matching the reference base. The feet must read as legs/feet, not hats or a second head. Keep left and right feet separated, include no body, face, eyes, mouth, spores, ground shadow, text, border, or background. Transparent RGBA output, centered on a 2048×2048 production canvas with generous clear space around each foot.
```

Generate four candidates, run the existing extraction gate on all four, and select exactly one machine-approved candidate through the review record. If no candidate passes both extraction and the “reads as feet at 256×256” visual check, generate a new four-candidate sheet rather than weakening thresholds.

Before the first generation call, read and follow the available `imagegen` skill; record that the supplied biped base was used as the reference image in source evidence.

- [ ] **Step 6: Calibrate explicit-none and strong metadata**

Set `none` base weights so a 10,000-seed normal-mode test for each optional slot lands inside 35%–50%. Mark the large mushroom cap, triple eyes, wide grin, lolling tongue, large extra appendages, full-body dominant surface, and foreground glow/orb effects as `strong`; all explicit-none, small patterns, simple texture overlays, and small oral details are `quiet`. Record the final per-part classification in `rework-record.json`.

- [ ] **Step 7: Build the catalog and observe production validation failures**

Run: `npm run validate:v0.2.0 -w @qmonster/asset-catalog`

Expected before completing metadata/assets: FAIL with composition/evidence/resource diagnostics, proving the new production gates are active.

- [ ] **Step 8: Generate runtime files, hashes, evidence, and part sheets**

Run the versioned builders in this order:

```powershell
npx tsx scripts/build-runtime-assets.ts --version 0.2.0
npx tsx scripts/build-color-scheme-masks.ts --version 0.2.0
npx tsx scripts/build-production-catalog.ts --version 0.2.0
npx tsx scripts/render-production-contact-sheets-browser.ts --version 0.2.0
```

The build must update split catalogs, `source-index-v0.2.0.json`, and `audit/v0.2.0/evidence-manifest.json` from actual file hashes. Review the three contact sheets at original resolution and record each as `approved` in `review/v0.2.0/rework-record.json`; rejected candidates stay under the source tree, never the runtime tree.

Change the asset-catalog default `validate` script from `validate:v0.1.0` to `validate:v0.2.0`, then add a browser integration assertion that `resolveProductionAssetUrl('0.2.0', 'parts/eyes_glossy_pair.png')` resolves to a bundled `v0.2.0` URL.

- [ ] **Step 9: Run asset and distribution gates**

Run: `npx vitest run scripts/split-paired-part.test.ts scripts/build-production-catalog.test.ts packages/asset-catalog/src/production-validation.test.ts`

Expected: PASS.

Run: `npm run validate:v0.1.0 -w @qmonster/asset-catalog`

Expected: PASS, proving legacy evidence remains intact.

Run: `npm run validate:v0.2.0 -w @qmonster/asset-catalog`

Expected: PASS with no warnings.

- [ ] **Step 10: Commit catalog 0.2.0 and reviewed assets**

```bash
git add scripts asset-source/v0.2.0 packages/asset-catalog/catalog/v0.2.0 packages/asset-catalog/assets/v0.2.0 packages/asset-catalog/audit/v0.2.0 packages/asset-catalog/review/v0.2.0 packages/asset-catalog/source-index-v0.2.0.json
git commit -m "feat: produce composition-aware creature assets"
```

---

### Task 6: Workbench Integration, Diagnostics, and Legacy Inspection

**Files:**
- Modify: `apps/creator-web/src/App.tsx`
- Modify: `apps/creator-web/src/App.test.tsx`
- Create: `apps/creator-web/src/components/CompositionStatus.tsx`
- Create: `apps/creator-web/src/components/CompositionStatus.test.tsx`
- Create: `apps/creator-web/src/components/LegacySpecViewer.tsx`
- Create: `apps/creator-web/src/components/LegacySpecViewer.test.tsx`
- Modify: `apps/creator-web/src/components/DiagnosticsPanel.tsx`
- Modify: `apps/creator-web/src/components/DiagnosticsPanel.test.tsx`
- Modify: `apps/creator-web/src/components/ExportControls.tsx`
- Modify: `apps/creator-web/src/components/ExportControls.test.tsx`
- Modify: `apps/creator-web/src/state/creator-reducer.ts`
- Modify: `apps/creator-web/src/state/creator-reducer.test.ts`
- Modify: `apps/creator-web/src/io/spec-file.ts`
- Modify: `apps/creator-web/src/io/spec-file.test.ts`
- Modify: `apps/creator-web/src/styles/workbench.css`

**Interfaces:**
- Consumes: production catalogs `0.1.0`/`0.2.0`, Task 2 composition helpers, Task 3 metrics/diagnostics, and existing transactional import/export.
- Produces: `0.2.0` default editing, readable budget status, actionable diagnostic targets, and exact-version read-only inspection for imported legacy specs.

- [ ] **Step 1: Add failing default-catalog and registry tests**

```ts
it('starts first-hatch with catalog and renderer 0.2.0', async () => {
  render(<App />)
  expect(await screen.findByText('目录 v0.2.0')).toBeVisible()
  expect(productionCatalog.version).toBe('0.2.0')
})

it('installs both exact catalog versions without fallback', async () => {
  await expect(productionCatalogRegistry.load('0.1.0')).resolves.toEqual(expect.objectContaining({ ok: true }))
  await expect(productionCatalogRegistry.load('0.2.0')).resolves.toEqual(expect.objectContaining({ ok: true }))
  await expect(productionCatalogRegistry.load('0.2.1')).resolves.toEqual(expect.objectContaining({ ok: false }))
})
```

- [ ] **Step 2: Switch the editable app to catalog `0.2.0`**

Import both JSON catalogs. Export `productionCatalog` as parsed `0.2.0` and register exact loaders for both. Change `parseSpecFile`'s current version default to `0.2.0`. Keep the default seed `qmonster-v0.1-first-hatch`; changing the seed would hide the regression rather than fix it.

- [ ] **Step 3: Add a composition status component**

Render three compact facts below the preview:

```tsx
<ul aria-label="组合约束" className="composition-status">
  <li>强特征 {strongCount}/{policy.maxStrongFeatures}</li>
  <li>惊喜位 {usedSurprise}/{allowedSurprise}</li>
  <li>{faceReady ? '面部清晰' : '面部需调整'}</li>
</ul>
```

Tests cover 0, 2, and 3 strong parts, a render error that marks face unready, and legacy catalogs where the component returns `null`.

- [ ] **Step 4: Reconcile composition diagnostics after local commands**

Add `COMPOSITION_THEME_FALLBACK` and `COMPOSITION_INTENSITY_EXCEEDED` to the set of diagnostics replaced when their affected slots are recomputed. Keep face/bounds render diagnostics in the render bucket so a new preview atomically replaces stale pixel diagnostics. Prove a warning does not set `session.blocked` while face errors do.

- [ ] **Step 5: Make diagnostic links actionable**

Map composition diagnostic paths to the responsible slot. `COMPOSITION_FACE_OCCLUDED` targets `effect` when the diagnostic path names an effect node, otherwise `eyes`/`mouthShape`; bounds targets `bodyFrame`. Add concise Chinese messages while retaining stable machine codes in the diagnostic heading.

- [ ] **Step 6: Keep imported `0.1.0` specimens read-only and exact**

Change successful import callback to carry both values already returned by `parseSpecFile`:

```ts
onImportComplete: (payload: { spec: MonsterSpec; catalog: Catalog }) => void
```

If `payload.catalog.version === '0.2.0'`, dispatch the current transactional `importSpec`. Otherwise open `LegacySpecViewer`, render using the returned legacy catalog, allow JSON/PNG/WebP export, and disable random, reroll, manual selection, and theme controls. The viewer includes a “返回新版生成器” button that closes inspection without mutating the current `0.2.0` session.

- [ ] **Step 7: Run UI tests**

Run: `npx vitest run apps/creator-web/src/App.test.tsx apps/creator-web/src/components/CompositionStatus.test.tsx apps/creator-web/src/components/LegacySpecViewer.test.tsx apps/creator-web/src/components/DiagnosticsPanel.test.tsx apps/creator-web/src/components/ExportControls.test.tsx apps/creator-web/src/state/creator-reducer.test.ts apps/creator-web/src/io/spec-file.test.ts`

Expected: PASS.

Run: `npm run typecheck && npm run build`

Expected: both exit 0.

- [ ] **Step 8: Commit workbench integration**

```bash
git add apps/creator-web
git commit -m "feat: surface coherent composition in the creator"
```

---

### Task 7: Full-Composite Acceptance and Release Gates

**Files:**
- Modify: `scripts/generate-acceptance-set.ts`
- Modify: `scripts/generate-acceptance-set.test.ts`
- Create: `scripts/composition-statistics.ts`
- Create: `scripts/composition-statistics.test.ts`
- Create: `scripts/validate-composite-review.ts`
- Create: `scripts/validate-composite-review.test.ts`
- Create: `tests/render/composition.spec.ts`
- Create: `tests/render/golden/first-hatch-v0.2.review.png`
- Create: `tests/render/golden/first-hatch-v0.2.rgba.sha256`
- Modify: `apps/creator-web/src/acceptance-render.ts`
- Modify: `apps/creator-web/src/components/PreviewCanvas.tsx`
- Modify: `apps/creator-web/src/components/PreviewCanvas.test.tsx`
- Modify: `tests/e2e/generator.spec.ts`
- Modify: `tests/e2e/performance.spec.ts`
- Modify: `package.json`
- Create: `docs/qa/v0.2-composition-acceptance.md`
- Create/Modify: `packages/asset-catalog/review/v0.2.0/full-composite-contact-sheet.png`
- Create/Modify: `packages/asset-catalog/review/v0.2.0/full-composite-acceptance.json`

**Interfaces:**
- Consumes: the product generation/render path, Task 2 selection metrics, Task 3 render metrics, and the production `0.2.0` catalog/assets.
- Produces: deterministic 21-entry acceptance evidence, reviewed first-hatch golden, statistical density gates, and a user-approved full-composite sheet.

- [ ] **Step 1: Add failing acceptance-manifest tests**

```ts
it('contains the fixed 20 creatures plus the first-hatch regression', async () => {
  const entries = await buildAcceptanceManifest(productionCatalog)
  expect(entries).toHaveLength(21)
  expect(entries.slice(0, 20).map(item => item.seed)).toEqual(
    Array.from({ length: 20 }, (_, index) => String(2026082101 + index)),
  )
  expect(entries[20]).toEqual(expect.objectContaining({
    seed: 'qmonster-v0.1-first-hatch', themeId: 'fungal', regression: true,
  }))
})

it('rejects warnings, over-budget parts, and missing face metrics', () => {
  const invalidRenderedEntry = { ...makeValidRenderedAcceptanceEntry(), strongFeatureCount: 3 }
  expect(() => assertCompositionAcceptance(invalidRenderedEntry)).toThrow('composition acceptance')
})
```

- [ ] **Step 2: Add the first-hatch entry and machine metrics**

Extend entries with `regression: boolean`, `strongFeatureCount`, `surpriseSlots`, and renderer `compositionMetrics`. Add optional `PreviewCanvas.onRenderComplete(result: RenderResult)` and invoke it only for the latest committed render; a stale promise and an unmounted preview must publish neither diagnostics nor metrics. Update `window.renderAcceptanceMonster` to return `RenderResult.compositionMetrics` beside the PNG data URL and diagnostics. `buildAcceptanceManifest` must reject generation warnings as well as errors. The output directory is `artifacts/acceptance/v0.2`; the contact sheet uses five columns and labels each cell with theme, seed, rig, strong count, and surprise count.

Export the assertion with this signature and define `makeValidRenderedAcceptanceEntry()` inside the test file with all ratios set to `1`, zero diagnostics, and counts within policy:

```ts
export function assertCompositionAcceptance(entry: RenderedAcceptanceEntry): void
```

`assertCompositionAcceptance` requires:

```ts
entry.strongFeatureCount <= 2
entry.surpriseSlots <= Math.floor(entry.motifOpportunityCount * 0.3)
entry.compositionMetrics.eyesInsideRatio >= 0.8
entry.compositionMetrics.eyesVisibleRatio >= 0.85
entry.compositionMetrics.mouthInsideRatio >= 0.8
entry.compositionMetrics.mouthVisibleRatio >= 0.85
entry.renderDiagnostics.length === 0
```

- [ ] **Step 3: Add 10,000-seed distribution tests**

`composition-statistics.ts` exposes:

```ts
export function measureCompositionDistribution(
  catalog: Catalog,
  seeds: readonly string[],
): {
  optionalNoneRates: Record<'headAppendage' | 'tail' | 'extraAppendage' | 'effect', number>
  maximumStrongFeatures: number
  maximumSurpriseSlots: number
}
```

The test generates seeds `composition-00000` through `composition-09999`, cycles all three themes, and asserts every none rate is in `[0.35, 0.5]`, maximum strong count is at most 2, and maximum surprise use is within policy. Keep this node-only; it must not load images.

- [ ] **Step 4: Add the first-hatch browser golden test**

Render `qmonster-v0.1-first-hatch` through the production preview route at 1024×1024 in bundled Chromium, decode RGBA, and compare `first-hatch-v0.2.rgba.sha256`. On the first run the test fails because the reviewed hash is absent. Save `first-hatch-v0.2.review.png`, inspect it at original size and 256×256, then record its decoded RGBA hash. Do not use encoded PNG bytes as the golden.

- [ ] **Step 5: Add real workflow assertions**

In `tests/e2e/generator.spec.ts`, assert the default preview reaches zero errors, shows `强特征 N/2` with `N <= 2`, and reports `面部清晰`. Lock one strong slot and repeatedly reroll another; each committed preview must remain within budget. Manually choose a third strong part and prove the warning appears while exports remain enabled.

- [ ] **Step 6: Generate and inspect the full-composite sheet**

Run: `npm run acceptance:generate`

Expected: 21 PNGs, `acceptance-set.json`, and `contact-sheet.png` under `artifacts/acceptance/v0.2`, with all machine assertions passing.

Copy the contact sheet and machine-readable manifest into `packages/asset-catalog/review/v0.2.0/` using the filenames in the task file list. Inspect every creature for one dominant body mass, readable face at 256×256, connected limbs, no face-stacked appendages, no second silhouette from surface/effects, and friendly-weird style. Any failure restarts the fixed 20-seed run after correction.

Pause implementation at this point and ask the user to approve `full-composite-contact-sheet.png`. Record the result in `full-composite-acceptance.json` using this exact contract; `reviewedAt` comes from the actual approval time and both hashes are computed from current file bytes:

```ts
interface CompositeReviewRecord {
  catalogVersion: '0.2.0'
  rendererVersion: '0.2.0'
  decision: 'approved'
  reviewedAt: string
  reviewer: 'user'
  entryCount: 21
  contactSheetSha256: string
  manifestSha256: string
  notes: string[]
}
```

Implement `validateCompositeReview(version)` to load the copied manifest, contact sheet, and review record; require `decision: "approved"`, catalog/renderer `0.2.0`, exactly 21 entries, and recorded SHA-256 values equal to current bytes. A missing decision or changed sheet returns exit 1 with `COMPOSITE_REVIEW_INVALID`.

- [ ] **Step 7: Re-run performance and full release gates**

Update root scripts before running the gates:

```json
{
  "test:render-golden": "playwright test tests/render/golden.spec.ts tests/render/composition.spec.ts --project=chromium --workers=1",
  "acceptance:verify": "tsx scripts/validate-composite-review.ts --version 0.2.0",
  "verify": "npm run typecheck && npm test && npm run test:coverage && npm run catalog:validate && npm run build && npm run test:render-golden && npm run test:e2e && npm run acceptance:generate && npm run acceptance:verify"
}
```

Run: `npm run test:performance`

Expected: 100 warmed rerolls p95 <= 150ms and each of 10 PNG exports <= 2000ms; attachment resolution and metric masks must not create monotonic cache growth.

Run: `npm run test:render-golden`

Expected: legacy synthetic and reviewed first-hatch goldens pass.

Run: `npx vitest run scripts/validate-composite-review.test.ts && npm run acceptance:verify`

Expected: the validator tests pass and the approved review record matches current evidence.

Run: `npm run verify`

Expected: typecheck, all Vitest projects, coverage, default `0.2.0` catalog validation, production build, browser workflows, and performance all exit 0.

- [ ] **Step 8: Record composition acceptance**

Create `docs/qa/v0.2-composition-acceptance.md` with exact Git commit, OS/Node/browser versions, catalog/schema/renderer versions, all commands and exit statuses, four none rates, maximum strong/surprise counts, 21 entry hashes, contact-sheet hash, first-hatch RGBA hash, and the user's contact-sheet decision. The document must contain actual measured values from this run.

- [ ] **Step 9: Commit acceptance evidence**

```bash
git add scripts tests package.json docs/qa/v0.2-composition-acceptance.md packages/asset-catalog/review/v0.2.0
git commit -m "test: gate full creature composition quality"
```

---

## Final Verification

- [ ] Confirm `git status --short` contains no unexpected generated files or unrelated edits.
- [ ] Run `npm run typecheck` and record exit 0.
- [ ] Run `npm test` and record the exact passing test count.
- [ ] Run `npm run test:coverage` twice from the same clean baseline and record both exit 0.
- [ ] Run `npm run validate:v0.1.0 -w @qmonster/asset-catalog` and record exit 0.
- [ ] Run `npm run validate:v0.2.0 -w @qmonster/asset-catalog` and record exit 0 with no warnings.
- [ ] Run `npm run build` and record exit 0.
- [ ] Run `npm run test:e2e` and record every configured browser project's applicable result.
- [ ] Run `npm run test:render-golden` and record both decoded-RGBA golden hashes.
- [ ] Run `npm run acceptance:generate` and verify the manifest/contact-sheet hashes match reviewed evidence.
- [ ] Open `http://localhost:5173/`, verify the default first-hatch preview at desktop and narrow widths, and confirm browser console/network contain no errors.
- [ ] Review the complete branch diff against `docs/superpowers/specs/2026-08-24-qmonster-composition-coherence-design.md` and resolve every unimplemented requirement before claiming completion.

## Execution Choice

After this plan is approved, choose exactly one execution workflow:

1. **Subagent-Driven (recommended):** use `superpowers:subagent-driven-development`, one fresh implementation agent per task, followed by requirements and quality review gates.
2. **Inline Execution:** use `superpowers:executing-plans` in this task, executing in batches with review checkpoints.
