# QMonster Random Genome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every newly generated QMonster a deterministic P/H1/H2/H3 genome while preserving its current visible phenotype, editor compatibility, legacy imports, and hatchery integration.

**Architecture:** `@qmonster/generator-core` extracts the current visual selection pass into a reusable layer generator, runs it once unchanged for P and three times with domain-separated seeds for hidden layers, and stores only stable `partId` values in `MonsterSpec.genome`. The existing renderer continues to consume `visualSlots`; validation, editor commands, persistence, a read-only genome panel, and the hatchery adapter keep genome and phenotype synchronized without synthesizing genetics for legacy specs.

**Tech Stack:** TypeScript 7, Zod 4, React 19, Vitest 4, fast-check, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-31-qmonster-random-genome-design.md`

## Global Constraints

- Preserve exactly 14 visual slots and store exactly four genes per slot: `P`, `H1`, `H2`, and `H3`.
- Gene values are existing catalog `partId` strings; do not add numeric gene codes or a second registry.
- `MonsterSpec.schemaVersion` stays `0.1.0`; `MonsterGenome.genomeVersion` is exactly `0.1.0`.
- `MonsterSpec.genome` is optional for legacy compatibility, but every newly generated spec contains a complete genome.
- For a new spec, `genome.genes[slotId].P === visualSlots[slotId].partId` for all 14 slots.
- The current seed/theme/mode/roll/lock inputs must keep the exact pre-genetics P phenotype.
- H1/H2/H3 each form a complete combination valid under at least one common catalog rig.
- P locks affect P only. Hidden layers are never locked.
- Ordinary rerolls preserve the existing dependency closure; genes outside that closure do not change.
- `bodyFrame` reroll rebuilds all four complete layers. Manual selection changes P only, except that manual `bodyFrame` selection rebuilds hidden layers.
- Imported legacy specs remain genome-free through ordinary editing; do not synthesize hidden genes.
- Invalid imported genomes are rejected with exact `genome.genes.<slotId>.<layer>` paths; never repair or substitute gene values silently.
- Mutation and aberration remain separate from genetics and do not affect hidden-layer expression.
- Do not modify renderer behavior, art assets, catalog JSON, theme weights, rarity weights, or approved visual evidence.
- Implement with tests first, keep each command atomic, and commit after every task passes its focused tests.

## File Structure

- `packages/generator-core/src/contracts.ts`: public genome constants/types and optional `MonsterSpec.genome`.
- `packages/generator-core/src/schema.ts`: strict optional genome decoding.
- `packages/generator-core/src/genome.ts`: pure layer seed, transpose, projection, and dominant-sync helpers.
- `packages/generator-core/src/genome.test.ts`: pure genetics helper tests.
- `packages/generator-core/src/generate.ts`: reusable visual-layer pass plus four-layer generation orchestration.
- `packages/generator-core/src/genome-validation.ts`: catalog-aware layer materialization and genome diagnostics.
- `packages/generator-core/src/genome-validation.test.ts`: missing, wrong-slot, incompatible, and P-mismatch tests.
- `packages/generator-core/src/reroll.ts`: genome-aware reroll/manual-select transactions built on the existing dependency behavior.
- `packages/generator-core/src/test-fixtures.ts`: explicit genome fixture helper while retaining a genome-free legacy fixture.
- `apps/creator-web/src/components/GenomePanel.tsx`: read-only P/H1/H2/H3 viewer and legacy empty state.
- `apps/creator-web/src/components/GenomePanel.test.tsx`: component accessibility and layer-switching tests.
- `apps/creator-web/src/components/SlotPanel.tsx`: mounts the genome viewer in the existing scrollable right panel.
- `apps/creator-web/src/styles/workbench.css`: compact genome viewer styling.
- `packages/incubator-adapter/src/contracts.ts` and `output.ts`: optional deep-copied genome output.
- `docs/integration/qmonster-hatchery-integration.md`: genome persistence and compatibility guidance.

---

### Task 1: Define and Decode the Genome Contract

**Files:**
- Modify: `packages/generator-core/src/contracts.ts:1-202`
- Modify: `packages/generator-core/src/schema.ts:1-85`
- Modify: `packages/generator-core/src/schema.test.ts`
- Modify: `packages/generator-core/src/test-fixtures.ts:1-75`

**Interfaces:**
- Consumes: `VISUAL_SLOT_IDS`, `VisualSlotId`, and current `MonsterSpecSchema`.
- Produces: `GENOME_VERSION`, `GENOME_LAYERS`, `GenomeLayer`, `SlotGenes`, `MonsterGenome`, `MonsterSpec.genome?`, and `makeGenomeForSpecFixture(spec)`.

- [ ] **Step 1: Add failing codec and legacy-compatibility tests**

Add these tests to `schema.test.ts`:

```ts
it('round-trips a strict four-layer genome without changing schemaVersion', () => {
  const input = makeValidMonsterSpecFixture()
  input.genome = makeGenomeForSpecFixture(input)

  expect(parseMonsterSpec(input)).toEqual({ ok: true, value: input })
  expect(input.schemaVersion).toBe('0.1.0')
  expect(Object.keys(input.genome.genes)).toEqual([...VISUAL_SLOT_IDS])
})

it('keeps a legacy genome-free spec parseable', () => {
  const input = makeValidMonsterSpecFixture()
  expect(input.genome).toBeUndefined()
  expect(parseMonsterSpec(input)).toEqual({ ok: true, value: input })
})

it('rejects a missing hidden gene at its exact path', () => {
  const input = makeValidMonsterSpecFixture()
  input.genome = makeGenomeForSpecFixture(input)
  delete (input.genome.genes.eyes as Partial<SlotGenes>).H2

  const parsed = parseMonsterSpec(input)
  expect(parsed.ok).toBe(false)
  if (!parsed.ok) expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
    path: ['genome', 'genes', 'eyes', 'H2'],
  }))
})

it('rejects unknown genome slots and layers', () => {
  const input = makeValidMonsterSpecFixture() as MonsterSpec & Record<string, unknown>
  input.genome = makeGenomeForSpecFixture(input)
  Object.assign(input.genome.genes.eyes, { H4: 'eyes_asymmetric' })
  Object.assign(input.genome.genes, { unknownSlot: input.genome.genes.eyes })

  expect(parseMonsterSpec(input)).toMatchObject({ ok: false })
})
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```powershell
npx vitest run packages/generator-core/src/schema.test.ts
```

Expected: TypeScript/test collection fails because the genome contracts and fixture helper do not exist.

- [ ] **Step 3: Add the public types and optional spec field**

Add near the existing visual-slot constants and `MonsterSpec` contract:

```ts
export const GENOME_VERSION = '0.1.0' as const
export const GENOME_LAYERS = ['P', 'H1', 'H2', 'H3'] as const
export type GenomeLayer = typeof GENOME_LAYERS[number]

export interface SlotGenes {
  P: string
  H1: string
  H2: string
  H3: string
}

export interface MonsterGenome {
  genomeVersion: typeof GENOME_VERSION
  genes: Record<VisualSlotId, SlotGenes>
}
```

Add `genome?: MonsterGenome` immediately after `visualSlots` in `MonsterSpec`.

- [ ] **Step 4: Add a genome fixture without changing the legacy fixture**

Add this export to `test-fixtures.ts`; do not add a genome inside `makeValidMonsterSpecFixture()`:

```ts
export function makeGenomeForSpecFixture(spec: MonsterSpec): MonsterGenome {
  return {
    genomeVersion: GENOME_VERSION,
    genes: Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => {
      const partId = spec.visualSlots[slotId].partId
      return [slotId, { P: partId, H1: partId, H2: partId, H3: partId }]
    })) as Record<VisualSlotId, SlotGenes>,
  }
}
```

Import `GENOME_VERSION`, `MonsterGenome`, and `SlotGenes` from `contracts.ts`.

- [ ] **Step 5: Decode a strict optional genome**

Add to `schema.ts`:

```ts
const SlotGenesSchema = z.strictObject({
  P: z.string().min(1),
  H1: z.string().min(1),
  H2: z.string().min(1),
  H3: z.string().min(1),
})

const MonsterGenomeSchema = z.strictObject({
  genomeVersion: z.literal('0.1.0'),
  genes: z.record(z.enum(VISUAL_SLOT_IDS), SlotGenesSchema),
})
```

Add `genome: MonsterGenomeSchema.optional()` to `MonsterSpecSchema` immediately after `visualSlots`.

- [ ] **Step 6: Run focused tests and type checking**

Run:

```powershell
npx vitest run packages/generator-core/src/schema.test.ts packages/generator-core/src/contracts.test.ts
npm run typecheck
```

Expected: both Vitest files and TypeScript pass; legacy fixtures still have no `genome` property.

- [ ] **Step 7: Commit the contract**

```powershell
git add -- packages/generator-core/src/contracts.ts packages/generator-core/src/schema.ts packages/generator-core/src/schema.test.ts packages/generator-core/src/test-fixtures.ts
git commit -m "feat: define qmonster genome contract"
```

---

### Task 2: Add Pure Genome Layer Helpers

**Files:**
- Create: `packages/generator-core/src/genome.ts`
- Create: `packages/generator-core/src/genome.test.ts`
- Modify: `packages/generator-core/src/index.ts:1-15`

**Interfaces:**
- Consumes: `GenomeLayer`, `MonsterGenome`, `SlotGenes`, `VisualSelection`, and `VISUAL_SLOT_IDS` from Task 1.
- Produces: `genomeLayerSeed(seed, layer)`, `genomeFromVisualLayers(layers)`, `partIdsForGenomeLayer(genome, layer)`, and `syncDominantGenes(genome, visualSlots, affectedSlots)`.

- [ ] **Step 1: Write failing deterministic helper tests**

Create `genome.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GENOME_LAYERS, VISUAL_SLOT_IDS, type GenomeLayer, type VisualSelection } from './contracts.js'
import {
  genomeFromVisualLayers,
  genomeLayerSeed,
  partIdsForGenomeLayer,
  syncDominantGenes,
} from './genome.js'

function layer(suffix: string): Record<typeof VISUAL_SLOT_IDS[number], VisualSelection> {
  return Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
    slotId,
    { partId: `${slotId}_${suffix}`, rigId: 'blob' as const },
  ])) as Record<typeof VISUAL_SLOT_IDS[number], VisualSelection>
}

it('keeps the dominant seed exact and domain-separates hidden layers', () => {
  expect(genomeLayerSeed('seed', 'P')).toBe('seed')
  const hidden = GENOME_LAYERS.slice(1).map(item => genomeLayerSeed('seed', item))
  expect(new Set(hidden).size).toBe(3)
  expect(hidden).not.toContain('seed')
  expect(genomeLayerSeed('seed', 'H1')).toBe(genomeLayerSeed('seed', 'H1'))
})

it('transposes four complete visual layers into slot genes', () => {
  const layers = Object.fromEntries(GENOME_LAYERS.map(item => [item, layer(item)])) as Record<
    GenomeLayer,
    ReturnType<typeof layer>
  >
  const genome = genomeFromVisualLayers(layers)

  expect(genome.genes.eyes).toEqual({
    P: 'eyes_P', H1: 'eyes_H1', H2: 'eyes_H2', H3: 'eyes_H3',
  })
  expect(partIdsForGenomeLayer(genome, 'H2').mouthShape).toBe('mouthShape_H2')
})

it('synchronizes only affected dominant genes', () => {
  const layers = Object.fromEntries(GENOME_LAYERS.map(item => [item, layer(item)])) as Record<
    GenomeLayer,
    ReturnType<typeof layer>
  >
  const genome = genomeFromVisualLayers(layers)
  const visible = layer('changed')
  const updated = syncDominantGenes(genome, visible, ['eyes', 'mouthShape'])

  expect(updated.genes.eyes.P).toBe('eyes_changed')
  expect(updated.genes.mouthShape.P).toBe('mouthShape_changed')
  expect(updated.genes.tail).toEqual(genome.genes.tail)
  expect(updated.genes.eyes.H1).toBe('eyes_H1')
  expect(genome.genes.eyes.P).toBe('eyes_P')
})
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `npx vitest run packages/generator-core/src/genome.test.ts`

Expected: FAIL because `genome.ts` does not exist.

- [ ] **Step 3: Implement collision-safe seed domains and pure transforms**

Use these exact public signatures in `genome.ts`:

```ts
export type VisualGenomeLayers = Record<
  GenomeLayer,
  Record<VisualSlotId, VisualSelection>
>

export function genomeLayerSeed(seed: string, layer: GenomeLayer): string
export function genomeFromVisualLayers(layers: VisualGenomeLayers): MonsterGenome
export function partIdsForGenomeLayer(
  genome: MonsterGenome,
  layer: GenomeLayer,
): Record<VisualSlotId, string>
export function syncDominantGenes(
  genome: MonsterGenome,
  visualSlots: Record<VisualSlotId, VisualSelection>,
  affectedSlots: readonly VisualSlotId[],
): MonsterGenome
```

`genomeLayerSeed` returns `seed` for P and `JSON.stringify(['qmonster-genome', GENOME_VERSION, seed, layer])` for hidden layers. Every transform returns new objects and iterates `VISUAL_SLOT_IDS`/`GENOME_LAYERS` rather than relying on object insertion order.

- [ ] **Step 4: Export and verify the helpers**

Add `export * from './genome.js'` to `index.ts`, then run:

```powershell
npx vitest run packages/generator-core/src/genome.test.ts
npm run typecheck
```

Expected: helper tests and TypeScript pass.

- [ ] **Step 5: Commit the pure genetics helpers**

```powershell
git add -- packages/generator-core/src/genome.ts packages/generator-core/src/genome.test.ts packages/generator-core/src/index.ts
git commit -m "feat: add deterministic genome helpers"
```

---

### Task 3: Generate Four Compatible Deterministic Layers

**Files:**
- Modify: `packages/generator-core/src/generate.ts:40-190`
- Modify: `packages/generator-core/src/generate.test.ts:51-202`
- Modify: `packages/generator-core/src/generate.property.test.ts:1-25`

**Interfaces:**
- Consumes: Task 2 genome helpers plus existing `resolveSlot`, `selectRigId`, composition planning, and modifier projection.
- Produces: `generateVisualLayer(request, catalog)`, complete genomes on all new `generateMonster` results, and hidden diagnostics rooted at the matching gene layer.

- [ ] **Step 1: Freeze the current P phenotype in a failing regression test**

Load the production v0.3 catalog as existing application tests do, generate `qmonster-v0.1-first-hatch`, and assert this exact map:

```ts
expect(Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
  slotId,
  generated.spec.visualSlots[slotId],
]))).toEqual({
  bodyFrame: { partId: 'body_biped_peanut', rigId: 'biped' },
  headShape: { partId: 'head_round_dome', rigId: 'biped' },
  eyes: { partId: 'eyes_sleepy_crescent', rigId: 'biped' },
  mouthShape: { partId: 'mouth_soft_pout', rigId: 'biped' },
  oralDetail: { partId: 'oral_lolling_tongue', rigId: 'biped' },
  headAppendage: { partId: 'head_appendage_none', rigId: 'biped' },
  arms: { partId: 'arms_long_noodle', rigId: 'biped' },
  legs: { partId: 'legs_stub_feet', rigId: 'biped' },
  tail: { partId: 'tail_soft_curl', rigId: 'biped' },
  extraAppendage: { partId: 'extra_soft_tentacles', rigId: 'biped' },
  surfaceMaterial: { partId: 'surface_short_fur', rigId: 'biped' },
  pattern: { partId: 'pattern_soft_spots', rigId: 'biped' },
  colorScheme: { partId: 'color_fungal_amber', rigId: 'biped' },
  effect: { partId: 'effect_none', rigId: 'biped' },
})
```

Also add:

```ts
it('generates a deterministic complete genome whose P matches the phenotype', () => {
  const catalog = makeValidCatalogFixtureWithThreeRigs()
  const left = generateMonster(baseRequest, catalog)
  const right = generateMonster(baseRequest, catalog)

  expect(left.spec.genome).toEqual(right.spec.genome)
  expect(left.spec.genome?.genomeVersion).toBe('0.1.0')
  for (const slotId of VISUAL_SLOT_IDS) {
    expect(left.spec.genome?.genes[slotId].P).toBe(left.spec.visualSlots[slotId].partId)
    expect(Object.keys(left.spec.genome!.genes[slotId])).toEqual(['P', 'H1', 'H2', 'H3'])
  }
})

it('derives every hidden layer independently and ignores P locks', () => {
  const catalog = makeValidCatalogFixture()
  const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
  catalog.parts.push({ ...eyes, id: 'eyes_locked_only' })
  const request = { seed: 'independent-layers', themeId: 'fungal', mode: 'normal' } as const
  const unlocked = generateMonster(request, catalog).spec
  const locked = generateMonster({ ...request, lockedSelections: { eyes: 'eyes_locked_only' } }, catalog).spec

  expect(locked.genome!.genes.eyes.P).toBe('eyes_locked_only')
  for (const layer of ['H1', 'H2', 'H3'] as const) {
    const standalone = generateVisualLayer({
      seed: genomeLayerSeed(request.seed, layer),
      themeId: request.themeId,
    }, catalog)
    for (const slotId of VISUAL_SLOT_IDS) {
      expect(locked.genome!.genes[slotId][layer]).toBe(standalone.visualSlots[slotId].partId)
      expect(locked.genome!.genes[slotId][layer]).toBe(unlocked.genome!.genes[slotId][layer])
    }
  }
})
```

- [ ] **Step 2: Run focused generation tests and verify RED**

Run:

```powershell
npx vitest run packages/generator-core/src/generate.test.ts packages/generator-core/src/generate.property.test.ts
```

Expected: the baseline P assertion passes, while genome assertions fail because generation does not yet set `spec.genome`.

- [ ] **Step 3: Extract the existing selection pass without changing P behavior**

Add these internal/public-module contracts in `generate.ts`:

```ts
export interface GeneratedVisualLayer {
  visualSlots: Record<VisualSlotId, VisualSelection>
  diagnostics: Diagnostic[]
  rigId: RigId
}

export function generateVisualLayer(
  request: Pick<GenerationRequest, 'seed' | 'themeId' | 'slotRolls' | 'lockedSelections'>,
  catalog: Catalog,
): GeneratedVisualLayer
```

Move the existing `lockedBodyRig/selectRigId`, `planComposition`, `generationOrderForCatalog`, strong-feature accounting, and `resolveSlot` loop into `generateVisualLayer` without changing their order or random inputs. Keep catalog/theme/version/modifier validation in `generateMonster`, so the P pass does not duplicate global diagnostics.

- [ ] **Step 4: Orchestrate P/H1/H2/H3 and transpose the genome**

In `generateMonster`, use this structure:

```ts
const layers = {} as VisualGenomeLayers
for (const layer of GENOME_LAYERS) {
  const hidden = layer !== 'P'
  const generatedLayer = generateVisualLayer({
    seed: genomeLayerSeed(request.seed, layer),
    themeId: request.themeId,
    slotRolls: request.slotRolls,
    ...(hidden ? {} : { lockedSelections: request.lockedSelections }),
  }, catalog)
  layers[layer] = generatedLayer.visualSlots
  diagnostics.push(...mapLayerDiagnostics(generatedLayer.diagnostics, layer))
}

const completeVisualSlots = layers.P
const genome = genomeFromVisualLayers(layers)
```

`mapLayerDiagnostics` leaves P diagnostic paths unchanged and maps a hidden `['visualSlots', slotId, ...rest]` path to `['genome', 'genes', slotId, layer, ...rest]`. Put `genome` next to `visualSlots` in the returned spec. Keep modifier PRNG calls on `request.seed` exactly as before.

- [ ] **Step 5: Extend the property test across all four layers**

Inside the successful branch of the existing arbitrary-seed property, add:

```ts
expect(result.spec.genome).toBeDefined()
for (const slotId of VISUAL_SLOT_IDS) {
  expect(result.spec.genome!.genes[slotId].P).toBe(result.spec.visualSlots[slotId].partId)
  for (const layer of GENOME_LAYERS) {
    expect(result.spec.genome!.genes[slotId][layer].length).toBeGreaterThan(0)
  }
}
```

Run the property at its existing 1,000 cases; do not reduce `numRuns`.

- [ ] **Step 6: Run focused tests, then type checking**

```powershell
npx vitest run packages/generator-core/src/genome.test.ts packages/generator-core/src/generate.test.ts packages/generator-core/src/generate.property.test.ts
npm run typecheck
```

Expected: all tests pass; the fixed production seed keeps the exact 14 P selections listed above.

- [ ] **Step 7: Commit four-layer generation**

```powershell
git add -- packages/generator-core/src/generate.ts packages/generator-core/src/generate.test.ts packages/generator-core/src/generate.property.test.ts
git commit -m "feat: generate four compatible genome layers"
```

---

### Task 4: Validate and Materialize Stored Genome Layers

**Files:**
- Create: `packages/generator-core/src/genome-validation.ts`
- Create: `packages/generator-core/src/genome-validation.test.ts`
- Modify: `packages/generator-core/src/spec-validation.ts:165-315`
- Modify: `packages/generator-core/src/spec-validation.test.ts`
- Modify: `packages/generator-core/src/generate.property.test.ts`
- Modify: `packages/generator-core/src/index.ts`
- Modify: `apps/creator-web/src/io/spec-file.test.ts`

**Interfaces:**
- Consumes: `genomeLayerSeed`, current part/rig/composition/connector validators, and generated complete genomes.
- Produces: `materializeGenomeLayer(spec, layer, catalog)`, `validateMonsterGenome(spec, catalog)`, and diagnostic codes `SPEC_GENOME_VERSION_UNSUPPORTED`, `SPEC_GENE_PART_MISSING`, `SPEC_GENE_PART_SLOT_MISMATCH`, `SPEC_GENOME_LAYER_INCOMPATIBLE`, and `SPEC_GENOME_P_MISMATCH`.

- [ ] **Step 1: Write failing genome catalog-validation tests**

Create `genome-validation.test.ts` with these cases:

```ts
it('accepts all four generated layers and materializes each under one common rig', () => {
  const catalog = makeValidCatalogFixtureWithThreeRigs()
  const spec = generateMonster({ seed: 'valid-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec

  expect(validateMonsterGenome(spec, catalog)).toEqual([])
  for (const layer of GENOME_LAYERS) {
    const materialized = materializeGenomeLayer(spec, layer, catalog)
    expect(materialized?.ok).toBe(true)
    if (materialized?.ok) expect(new Set(Object.values(materialized.value).map(item => item.rigId))).toHaveLength(1)
  }
})

it('rejects an unsupported genome version without changing schemaVersion', () => {
  const catalog = makeValidCatalogFixture()
  const spec = generateMonster({ seed: 'bad-genome-version', themeId: 'fungal', mode: 'normal' }, catalog).spec
  ;(spec.genome as { genomeVersion: string }).genomeVersion = '9.9.9'

  expect(validateMonsterGenome(spec, catalog)).toContainEqual(expect.objectContaining({
    code: 'SPEC_GENOME_VERSION_UNSUPPORTED',
    path: ['genome', 'genomeVersion'],
  }))
  expect(spec.schemaVersion).toBe('0.1.0')
})

it('rejects a dominant gene that differs from the phenotype', () => {
  const catalog = makeValidCatalogFixture()
  const spec = generateMonster({ seed: 'p-mismatch', themeId: 'fungal', mode: 'normal' }, catalog).spec
  spec.genome!.genes.eyes.P = 'eyes_other'

  expect(validateMonsterGenome(spec, catalog)).toContainEqual(expect.objectContaining({
    code: 'SPEC_GENOME_P_MISMATCH',
    path: ['genome', 'genes', 'eyes', 'P'],
  }))
})

it('reports missing and wrong-slot hidden parts at exact gene paths', () => {
  const catalog = makeValidCatalogFixture()
  const spec = generateMonster({ seed: 'bad-ids', themeId: 'fungal', mode: 'normal' }, catalog).spec
  spec.genome!.genes.eyes.H1 = 'missing_eyes'
  spec.genome!.genes.tail.H2 = spec.visualSlots.eyes.partId

  expect(validateMonsterGenome(spec, catalog)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'SPEC_GENE_PART_MISSING', path: ['genome', 'genes', 'eyes', 'H1'] }),
    expect.objectContaining({ code: 'SPEC_GENE_PART_SLOT_MISMATCH', path: ['genome', 'genes', 'tail', 'H2'] }),
  ]))
})

it('rejects a hidden layer that has no common compatible rig', () => {
  const catalog = makeValidCatalogFixture()
  const spec = generateMonster({ seed: 'cross-rig', themeId: 'fungal', mode: 'normal' }, catalog).spec
  catalog.parts.find(part => part.id === 'body_blob')!.compatibleRigs = ['blob']
  const legs = catalog.parts.find(part => part.id === 'legs_webbed')!
  catalog.parts.push({ ...legs, id: 'legs_biped_only', compatibleRigs: ['biped'] })
  spec.genome!.genes.legs.H3 = 'legs_biped_only'

  expect(validateMonsterGenome(spec, catalog)).toContainEqual(expect.objectContaining({
    code: 'SPEC_GENOME_LAYER_INCOMPATIBLE',
    path: ['genome', 'genes', expect.any(String), 'H3'],
  }))
})
```

- [ ] **Step 2: Run the validation test and verify RED**

Run: `npx vitest run packages/generator-core/src/genome-validation.test.ts`

Expected: FAIL because `genome-validation.ts` does not exist.

- [ ] **Step 3: Implement layer materialization**

Use these exact signatures:

```ts
export function materializeGenomeLayer(
  spec: MonsterSpec,
  layer: GenomeLayer,
  catalog: Catalog,
): ParseResult<Record<VisualSlotId, VisualSelection>> | null

export function validateMonsterGenome(spec: MonsterSpec, catalog: Catalog): Diagnostic[]
```

Return `null` from `materializeGenomeLayer` when `spec.genome` is absent. For a present genome, reject any version other than `GENOME_VERSION` at `['genome', 'genomeVersion']`, then resolve all 14 IDs to correct-slot parts. Try `catalog.rigs` in stable catalog order. A rig succeeds only when every part supports it, sequential `checkPartCompatibility` succeeds in `generationOrderForCatalog(catalog)`, and temporary layer selections produce no error from `validateCompositionSelections` or `validateStructuralSelections`. Build the temporary spec with `genome: undefined`, its layer seed, and semantic traits from `projectSemanticTraits`. If every rig fails, report the first stable failing slot at `['genome', 'genes', slotId, layer]`.

For P, require every part ID to match `visualSlots` before materialization. If `spec.genome` is absent, `validateMonsterGenome` returns no diagnostics and does not create data.

- [ ] **Step 4: Integrate genome diagnostics into full spec validation**

At the end of `validateMonsterSpecAgainstCatalog`, before returning, append:

```ts
diagnostics.push(...validateMonsterGenome(spec, catalog))
```

Export the new module from `index.ts`. Add a spec-validation assertion that a legacy fixture still returns its previous diagnostic sequence unchanged.

Add `validateMonsterSpecAgainstCatalog` to the existing `./index.js` import in `generate.property.test.ts`. In the successful branch of the arbitrary-seed property test, prove generated genetics also passes installed-catalog validation:

```ts
expect(validateMonsterSpecAgainstCatalog(result.spec, catalog)
  .filter(item => item.severity === 'error')).toEqual([])
```

- [ ] **Step 5: Prove invalid imports are rejected without repair**

Add to `spec-file.test.ts`:

```ts
it('rejects a catalog-invalid genome without changing the imported bytes', async () => {
  const spec = generateMonster({ seed: 'invalid-import-genome', themeId: 'fungal', mode: 'normal' }, currentCatalog).spec
  spec.genome!.genes.eyes.H1 = 'missing_hidden_eyes'
  const snapshot = structuredClone(spec)

  const result = await parseSpecFile(createSpecFile(spec), registry)

  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: 'SPEC_GENE_PART_MISSING',
    path: ['genome', 'genes', 'eyes', 'H1'],
  }))
  expect(spec).toEqual(snapshot)
})
```

- [ ] **Step 6: Run validation, import, and type tests**

```powershell
npx vitest run packages/generator-core/src/genome-validation.test.ts packages/generator-core/src/spec-validation.test.ts packages/generator-core/src/generate.property.test.ts apps/creator-web/src/io/spec-file.test.ts
npm run typecheck
```

Expected: generated genomes validate; malformed genomes fail at exact gene paths; legacy validation output remains stable.

- [ ] **Step 7: Commit genome validation**

```powershell
git add -- packages/generator-core/src/genome-validation.ts packages/generator-core/src/genome-validation.test.ts packages/generator-core/src/spec-validation.ts packages/generator-core/src/spec-validation.test.ts packages/generator-core/src/generate.property.test.ts packages/generator-core/src/index.ts apps/creator-web/src/io/spec-file.test.ts
git commit -m "feat: validate stored genome layers"
```

---

### Task 5: Keep Genome and Phenotype Atomic During Editing

**Files:**
- Modify: `packages/generator-core/src/reroll.ts:56-275`
- Modify: `packages/generator-core/src/reroll.test.ts`
- Modify: `packages/generator-core/src/generate.test.ts:439-690`
- Modify: `apps/creator-web/src/state/creator-reducer.test.ts:517-810`

**Interfaces:**
- Consumes: `generateVisualLayer`, `materializeGenomeLayer`, `syncDominantGenes`, `genomeFromVisualLayers`, and the existing phenotype reroll/manual-selection behavior.
- Produces: genome-aware `rerollSlot` and `selectVisualPart` with dependency closure, P-only locks, body-frame full rebuild, legacy preservation, and transactional rollback.

- [ ] **Step 1: Add failing reroll invariants**

Add tests using a catalog with `dependencies = { arms: ['eyes'], eyes: ['mouthShape'] }`:

```ts
it('rerolls the same dependency closure in all four genome layers', () => {
  const catalog = makeValidCatalogFixture()
  catalog.dependencies = { arms: ['eyes'], eyes: ['mouthShape'] }
  const before = generateMonster({ seed: 'genome-closure', themeId: 'fungal', mode: 'normal' }, catalog).spec
  const result = rerollSlot({ spec: before, slotId: 'arms', locks: {}, catalog })

  expect(result.affectedSlots).toEqual(['arms', 'eyes', 'mouthShape'])
  for (const slotId of VISUAL_SLOT_IDS) {
    expect(result.spec.genome!.genes[slotId].P).toBe(result.spec.visualSlots[slotId].partId)
    if (!result.affectedSlots.includes(slotId)) {
      expect(result.spec.genome!.genes[slotId]).toEqual(before.genome!.genes[slotId])
    }
  }
})

it('applies locks to P but not hidden dependency descendants', () => {
  const catalog = makeValidCatalogFixture()
  catalog.dependencies = { arms: ['eyes'] }
  const before = generateMonster({ seed: 'genome-locks', themeId: 'fungal', mode: 'normal' }, catalog).spec
  const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
  eyes.baseWeight = 0
  catalog.parts.push({ ...eyes, id: 'eyes_hidden_rerolled', baseWeight: 999 })
  const result = rerollSlot({ spec: before, slotId: 'arms', locks: { eyes: true }, catalog })

  expect(result.spec.genome!.genes.eyes.P).toBe(before.genome!.genes.eyes.P)
  expect(result.spec.visualSlots.eyes).toEqual(before.visualSlots.eyes)
  for (const layer of ['H1', 'H2', 'H3'] as const) {
    expect(result.spec.genome!.genes.eyes[layer]).toBe('eyes_hidden_rerolled')
  }
})

it('does not synthesize a genome while editing a legacy spec', () => {
  const catalog = makeValidCatalogFixture()
  const legacy = makeValidMonsterSpecFixture()

  expect(rerollSlot({ spec: legacy, slotId: 'eyes', locks: {}, catalog }).spec.genome).toBeUndefined()
  expect(selectVisualPart({
    spec: legacy,
    slotId: 'eyes',
    partId: legacy.visualSlots.eyes.partId,
    locks: {},
    catalog,
  }).spec.genome).toBeUndefined()
})
```

- [ ] **Step 2: Add failing body-frame and manual-selection tests**

```ts
it('rebuilds all four complete layers for a body-frame reroll', () => {
  const catalog = makeValidCatalogFixtureWithThreeRigs()
  const before = generateMonster({ seed: 'body-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec
  const after = rerollSlot({ spec: before, slotId: 'bodyFrame', locks: { tail: true }, catalog })

  expect(after.affectedSlots).toEqual([...generationOrderForCatalog(catalog)])
  expect(after.spec.slotRolls.bodyFrame).toBe(before.slotRolls.bodyFrame + 1)
  expect(after.spec.genome!.genes.tail.P).toBe(before.genome!.genes.tail.P)
  expect(validateMonsterGenome(after.spec, catalog)).toEqual([])
})

it('synchronizes every affected P gene after manual parent selection', () => {
  const catalog = makeValidCatalogFixture()
  catalog.dependencies = { arms: ['eyes'] }
  const arms = catalog.parts.find(part => part.slotId === 'arms')!
  catalog.parts.push({ ...arms, id: 'arms_manual_gene', baseWeight: 0 })
  const before = generateMonster({ seed: 'manual-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec
  const after = selectVisualPart({ spec: before, slotId: 'arms', partId: 'arms_manual_gene', locks: {}, catalog })

  for (const slotId of after.affectedSlots) {
    expect(after.spec.genome!.genes[slotId].P).toBe(after.spec.visualSlots[slotId].partId)
  }
  expect(after.spec.genome!.genes.arms.H1).toBe(before.genome!.genes.arms.H1)
})

it('rolls back phenotype and genome together when one hidden layer cannot materialize', () => {
  const catalog = makeValidCatalogFixture()
  const before = generateMonster({ seed: 'atomic-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec
  before.genome!.genes.eyes.H2 = 'missing_hidden_eyes'
  const result = rerollSlot({ spec: before, slotId: 'tail', locks: {}, catalog })

  expect(result.blocked).toBe(true)
  expect(result.spec.visualSlots).toEqual(before.visualSlots)
  expect(result.spec.genome).toEqual(before.genome)
  expect(result.spec.slotRolls.tail).toBe(before.slotRolls.tail + 1)
})
```

- [ ] **Step 3: Run edit tests and verify RED**

```powershell
npx vitest run packages/generator-core/src/reroll.test.ts packages/generator-core/src/generate.test.ts apps/creator-web/src/state/creator-reducer.test.ts
```

Expected: genome synchronization and full body-frame assertions fail while existing phenotype tests still pass.

- [ ] **Step 4: Isolate the existing phenotype transaction**

Inside `reroll.ts`, retain the current algorithms as internal functions with these signatures:

```ts
function rerollPhenotypeSlot(request: RerollSlotRequest): GenerationResult
function selectPhenotypePart(request: SelectVisualPartRequest): GenerationResult
```

The exported wrappers call these unchanged for a legacy spec. This preserves legacy behavior and prevents recursion when hidden layers use the same dependency logic.

- [ ] **Step 5: Apply ordinary rerolls independently to all four layers**

For new specs:

1. Run `rerollPhenotypeSlot` for P with the caller's locks.
2. Materialize each hidden layer into a temporary genome-free spec whose seed is `genomeLayerSeed(spec.seed, layer)`.
3. Run `rerollPhenotypeSlot` on that temporary spec with `{}` locks.
4. Copy each hidden result's `affectedSlots` part IDs into the same layer keys.
5. Sync every P `affectedSlot` from the committed `visualSlots`.
6. Remap hidden diagnostics to `genome.genes.<slot>.<layer>`.
7. If any layer blocks, return the original spec with only the attempted slot-roll counter advanced; do not return a partial genome/phenotype pair.

Use `orderedAffectedSlots` as the single dependency-closure source so P and hidden layers cannot disagree about affected slots.

- [ ] **Step 6: Implement body-frame full rebuild and manual P synchronization**

For a body-frame reroll, call `generateVisualLayer` four times using the incremented `slotRolls`. Pass `lockedSelections` only for P, built from P-locked slots other than the origin. Replace all P `visualSlots`, all genome genes, and projected semantic traits only after all four layers succeed. Return `generationOrderForCatalog(catalog)` as `affectedSlots`.

For manual selection, run `selectPhenotypePart`, then call `syncDominantGenes` for its full `affectedSlots`. Leave H1/H2/H3 unchanged for an ordinary slot. For manual `bodyFrame`, regenerate H1/H2/H3 as complete layers after P succeeds, then commit the result atomically.

- [ ] **Step 7: Run focused edit and reducer tests**

```powershell
npx vitest run packages/generator-core/src/reroll.test.ts packages/generator-core/src/generate.test.ts packages/generator-core/src/genome-validation.test.ts apps/creator-web/src/state/creator-reducer.test.ts
npm run typecheck
```

Expected: all current editor behavior remains green; new genome invariants pass; legacy specs remain genome-free.

- [ ] **Step 8: Commit atomic genome editing**

```powershell
git add -- packages/generator-core/src/reroll.ts packages/generator-core/src/reroll.test.ts packages/generator-core/src/generate.test.ts apps/creator-web/src/state/creator-reducer.test.ts
git commit -m "feat: keep genome synchronized during editing"
```

---

### Task 6: Add the Read-only Genome Viewer and Persistence Coverage

**Files:**
- Create: `apps/creator-web/src/components/GenomePanel.tsx`
- Create: `apps/creator-web/src/components/GenomePanel.test.tsx`
- Modify: `apps/creator-web/src/components/SlotPanel.tsx:1-135`
- Modify: `apps/creator-web/src/styles/workbench.css:543-719`
- Modify: `apps/creator-web/src/App.test.tsx:210-260`
- Modify: `apps/creator-web/src/state/persistence.test.ts:290-312`

**Interfaces:**
- Consumes: optional `MonsterSpec.genome`, `GENOME_LAYERS`, `GenomeLayer`, `VISUAL_SLOT_IDS`, and existing `SLOT_LABELS`.
- Produces: `GenomePanel({ genome })`, four accessible layer tabs, 14 read-only IDs, and a legacy empty state.

- [ ] **Step 1: Write failing component tests**

Create `GenomePanel.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { GenomePanel } from './GenomePanel.js'

it('shows P first and switches to a hidden layer without edit controls', async () => {
  const user = userEvent.setup()
  const catalog = makeValidCatalogFixture()
  const spec = generateMonster({ seed: 'gene-panel', themeId: 'fungal', mode: 'normal' }, catalog).spec
  render(<GenomePanel genome={spec.genome} />)

  const panel = screen.getByRole('region', { name: '基因记录' })
  expect(within(panel).getByRole('tab', { name: 'P · 显性' })).toHaveAttribute('aria-selected', 'true')
  expect(within(panel).getAllByTestId('gene-row')).toHaveLength(14)
  expect(within(panel).queryByRole('textbox')).toBeNull()
  expect(within(panel).queryByRole('combobox')).toBeNull()

  await user.click(within(panel).getByRole('tab', { name: 'H2 · 隐藏' }))
  expect(within(panel).getByRole('tab', { name: 'H2 · 隐藏' })).toHaveAttribute('aria-selected', 'true')
  expect(within(panel).getByText(spec.genome!.genes.eyes.H2)).toBeTruthy()
})

it('shows a compact legacy state when no genome exists', () => {
  render(<GenomePanel genome={undefined} />)
  expect(screen.getByRole('region', { name: '基因记录' })).toHaveTextContent('旧版形象没有基因记录')
})
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npx vitest run apps/creator-web/src/components/GenomePanel.test.tsx`

Expected: FAIL because `GenomePanel.tsx` does not exist.

- [ ] **Step 3: Implement the read-only accessible panel**

Use this component contract:

```tsx
import { useState } from 'react'
import {
  GENOME_LAYERS,
  VISUAL_SLOT_IDS,
  type GenomeLayer,
  type MonsterGenome,
} from '@qmonster/generator-core'
import { SLOT_LABELS } from './slot-config.js'

interface GenomePanelProps {
  genome: MonsterGenome | undefined
}

const GENOME_LAYER_LABELS: Record<GenomeLayer, string> = {
  P: 'P · 显性',
  H1: 'H1 · 隐藏',
  H2: 'H2 · 隐藏',
  H3: 'H3 · 隐藏',
}

export function GenomePanel({ genome }: GenomePanelProps) {
  const [layer, setLayer] = useState<GenomeLayer>('P')
  const titleId = 'genome-panel-title'

  return (
    <section className="genome-panel" role="region" aria-labelledby={titleId}>
      <div className="genome-panel__heading">
        <div>
          <p className="eyebrow">GENETIC RECORD</p>
          <h3 id={titleId}>基因记录</h3>
        </div>
        {genome !== undefined && <code>v{genome.genomeVersion}</code>}
      </div>
      {genome === undefined ? (
        <p className="genome-panel__legacy">旧版形象没有基因记录</p>
      ) : (
        <>
          <div className="genome-tabs" role="tablist" aria-label="基因层">
            {GENOME_LAYERS.map(item => (
              <button
                className="genome-tab"
                type="button"
                role="tab"
                id={`genome-tab-${item}`}
                aria-controls={`genome-layer-${item}`}
                aria-selected={layer === item}
                onClick={() => setLayer(item)}
                key={item}
              >
                {GENOME_LAYER_LABELS[item]}
              </button>
            ))}
          </div>
          <dl
            className="genome-grid"
            role="tabpanel"
            id={`genome-layer-${layer}`}
            aria-labelledby={`genome-tab-${layer}`}
          >
            {VISUAL_SLOT_IDS.map(slotId => (
              <div className="gene-row" data-testid="gene-row" key={slotId}>
                <dt>{SLOT_LABELS[slotId]}</dt>
                <dd><code>{genome.genes[slotId][layer]}</code></dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
```

Render values in `<code>` elements and labels from `SLOT_LABELS`. Do not render inputs, selects, promotion buttons, probabilities, or breeding controls. If `genome` becomes undefined after import, keep the state harmless and show only the legacy message.

- [ ] **Step 4: Mount and style the panel in the existing right-side scroll area**

Render `<GenomePanel genome={session.spec.genome} />` inside `SlotPanel` after its heading and before the slot groups. Add these styles, keeping the existing grid columns and mobile breakpoints unchanged so `.slot-panel` remains the only right-column scroll container:

```css
.genome-panel {
  margin-bottom: 15px;
  padding: 10px;
  border: 1px solid #d8c9e8;
  border-radius: 12px;
  background: rgba(244, 239, 251, 0.72);
}

.genome-panel__heading,
.gene-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.genome-panel__heading h3 { margin: 0; font-size: 13px; }
.genome-panel__heading code,
.gene-row code { font-family: var(--font-mono); font-size: 8px; }
.genome-panel__legacy { margin: 8px 0 0; color: var(--ink-soft); font-size: 10px; }

.genome-tabs {
  margin-top: 9px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.genome-tab {
  min-width: 0;
  padding: 5px 2px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.65);
  font-size: 8px;
}

.genome-tab[aria-selected="true"] {
  color: white;
  border-color: var(--purple-deep);
  background: var(--purple-deep);
}

.genome-grid { margin: 8px 0 0; }
.gene-row { padding: 3px 0; border-top: 1px dashed rgba(120, 95, 150, 0.18); }
.gene-row dt { color: var(--ink-soft); font-size: 8px; }
.gene-row dd { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 5: Extend workbench and persistence tests**

In the complete-shell test, assert:

```ts
expect(screen.getByRole('region', { name: '基因记录' })).toBeTruthy()
expect(screen.getByRole('tab', { name: 'P · 显性' })).toBeTruthy()
```

In the session round-trip test, add:

```ts
expect(session.spec.genome).toBeDefined()
expect(loadSession(() => makeFreshSession(), storage).session.spec.genome)
  .toEqual(session.spec.genome)
```

Also create a session from `makeValidMonsterSpecFixture()` and assert saving/loading preserves `genome === undefined`.

- [ ] **Step 6: Run creator tests and production build**

```powershell
npx vitest run apps/creator-web/src/components/GenomePanel.test.tsx apps/creator-web/src/App.test.tsx apps/creator-web/src/state/persistence.test.ts apps/creator-web/src/io/spec-file.test.ts
npm run typecheck
npm run build
```

Expected: component, import, persistence, TypeScript, and Vite build all pass.

- [ ] **Step 7: Commit the read-only genome UI**

```powershell
git add -- apps/creator-web/src/components/GenomePanel.tsx apps/creator-web/src/components/GenomePanel.test.tsx apps/creator-web/src/components/SlotPanel.tsx apps/creator-web/src/styles/workbench.css apps/creator-web/src/App.test.tsx apps/creator-web/src/state/persistence.test.ts
git commit -m "feat: show read-only creature genome"
```

---

### Task 7: Extend the Hatchery Contract, Document It, and Verify Delivery

**Files:**
- Modify: `packages/incubator-adapter/src/contracts.ts:15-23`
- Modify: `packages/incubator-adapter/src/output.ts:1-75`
- Modify: `packages/incubator-adapter/src/adapter.test.ts:100-185`
- Modify: `docs/integration/qmonster-hatchery-integration.md`

**Interfaces:**
- Consumes: validated optional `MonsterSpec.genome` and the existing `visualExtension` adapter output.
- Produces: optional deep-copied genome in `IncubatorCreatureRecord.visualExtension`, documented persistence rules, and a fully verified/pushed branch.

- [ ] **Step 1: Write failing adapter copy and legacy tests**

Add to `adapter.test.ts`:

```ts
it('exports an isolated genome alongside the resolved phenotype', () => {
  const catalog = productionCatalog()
  const spec = generatedSpec(catalog)
  const result = toIncubatorRecord(spec, catalog)

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.visualExtension.genome).toEqual(spec.genome)
  expect(result.value.visualExtension.genome).not.toBe(spec.genome)
  result.value.visualExtension.genome!.genes.eyes.H1 = 'mutated_adapter_copy'
  expect(spec.genome!.genes.eyes.H1).not.toBe('mutated_adapter_copy')
})

it('omits genome for a valid legacy phenotype', () => {
  const catalog = productionCatalog()
  const spec = generatedSpec(catalog)
  delete spec.genome
  const result = toIncubatorRecord(spec, catalog)

  expect(result.ok).toBe(true)
  if (result.ok) expect('genome' in result.value.visualExtension).toBe(false)
})
```

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `npx vitest run packages/incubator-adapter/src/adapter.test.ts`

Expected: the new generated genome is absent from `visualExtension`.

- [ ] **Step 3: Extend the adapter type and deep-copy output**

Change the type to:

```ts
visualExtension: Pick<
  MonsterSpec,
  'schemaVersion' | 'catalogVersion' | 'visualSlots' | 'genome'
>
```

Add a focused copy helper:

```ts
function copyGenome(spec: MonsterSpec): MonsterSpec['genome'] {
  return spec.genome === undefined ? undefined : structuredClone(spec.genome)
}
```

Construct `visualExtension` with:

```ts
visualExtension: {
  schemaVersion: spec.schemaVersion,
  catalogVersion: spec.catalogVersion,
  visualSlots: copyVisualSlots(spec),
  ...(spec.genome === undefined ? {} : { genome: copyGenome(spec) }),
}
```

- [ ] **Step 4: Update the hatchery integration guide**

Update the result, persistence, restoration, cache-key, and acceptance sections to state:

```text
- New MonsterSpec records persist genome and visualSlots together.
- genome.genes[slotId].P must equal visualSlots[slotId].partId.
- A missing genome is valid only for legacy records; do not synthesize hidden genes.
- An invalid present genome blocks READY and is never silently repaired.
- Canonical spec hashing includes genome, so two hereditary identities cannot share a stale image cache entry.
```

Add the exact `MonsterGenome` TypeScript contract and update the displayed `visualExtension` shape. Keep the current direct-module integration recommendation and image-cache guidance unchanged.

- [ ] **Step 5: Run adapter and documentation checks**

```powershell
npx vitest run packages/incubator-adapter/src/adapter.test.ts
rg -n "MonsterGenome|genome\.genes|legacy|旧版|visualExtension" docs/integration/qmonster-hatchery-integration.md
git diff --check
```

Expected: adapter tests pass; the guide contains contract, invariant, legacy, and adapter sections; Git reports no whitespace errors.

- [ ] **Step 6: Run the complete project verification gate**

Run from the linked worktree:

```powershell
npm run typecheck
npm test
npm run catalog:validate
npm run build
```

Expected: every command exits 0. No renderer, asset catalog JSON, source asset, or approved review artifact is modified.

- [ ] **Step 7: Inspect the final diff and commit integration work**

```powershell
git status --short
git diff --check
git diff --stat origin/feature/qmonster-v0.1...HEAD
git add -- packages/incubator-adapter/src/contracts.ts packages/incubator-adapter/src/output.ts packages/incubator-adapter/src/adapter.test.ts docs/integration/qmonster-hatchery-integration.md
git commit -m "docs: integrate qmonster genome with hatchery"
git status --short
```

Expected: the worktree is clean after the commit, and the branch contains the design, plan, generator, validation, editor, UI, adapter, and documentation commits.

- [ ] **Step 8: Push the verified branch using the existing authorization**

```powershell
git push origin feature/qmonster-v0.1
git rev-parse HEAD
git rev-parse origin/feature/qmonster-v0.1
git status --short --branch
```

Expected: local HEAD equals `origin/feature/qmonster-v0.1`, and status reports a clean synchronized branch.
