import { describe, expect, it } from 'vitest'
import {
  buildCandidates,
  createRng,
  generateMonster,
  rerollSlot,
  selectVisualPart,
  type Catalog,
  type GenerationRequest,
} from './index.js'
import { makeValidCatalogFixture } from './test-fixtures.js'

const baseRequest = {
  seed: '84721937',
  themeId: 'fungal',
  mode: 'normal',
} as const satisfies GenerationRequest

describe('generateMonster', () => {
  it('repeats the same spec for the same request and catalog', () => {
    const catalog = makeValidCatalogFixture()
    expect(generateMonster(baseRequest, catalog).spec).toEqual(generateMonster(baseRequest, catalog).spec)
  })

  it('isolates direct slot streams from unrelated catalog growth', () => {
    const catalog = makeValidCatalogFixture()
    const before = generateMonster(baseRequest, catalog).spec
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    const expanded: Catalog = {
      ...catalog,
      parts: [...catalog.parts, { ...eyes, id: 'eyes_unrelated_variant', baseWeight: 999 }],
    }
    const after = generateMonster(baseRequest, expanded).spec
    expect(after.visualSlots.bodyFrame).toEqual(before.visualSlots.bodyFrame)
    expect(after.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('retains an incompatible lock and blocks export', () => {
    const catalog = makeValidCatalogFixture()
    const legs = catalog.parts.find(part => part.slotId === 'legs')!
    const lockedPart = { ...legs, id: 'legs_spring', compatibleRigs: ['biped'] as const }
    const restricted: Catalog = {
      ...catalog,
      parts: [...catalog.parts, lockedPart],
    }
    const result = generateMonster(
      { ...baseRequest, lockedSelections: { bodyFrame: 'body_blob', legs: 'legs_spring' } },
      restricted,
    )
    expect(result.spec.visualSlots.legs.partId).toBe('legs_spring')
    expect(result.blocked).toBe(true)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'legs'] }),
    )
  })

  it('blocks modifier modes until deterministic modifiers are implemented', () => {
    const result = generateMonster({ ...baseRequest, mode: 'mutation' }, makeValidCatalogFixture())
    expect(result.blocked).toBe(true)
    expect(result.spec.mutation).toBeNull()
    expect(result.spec.aberrations).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'GENERATION_MODE_NOT_IMPLEMENTED' }))
  })

  it('includes structural catalog errors in generation diagnostics', () => {
    const catalog = makeValidCatalogFixture()
    catalog.parts = catalog.parts.filter(part => part.slotId !== 'arms')
    const result = generateMonster(baseRequest, catalog)
    expect(result.blocked).toBe(true)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CATALOG_SLOT_UNCOVERED' }))
  })
})

describe('candidate rules', () => {
  it('does not filter a reroll candidate because it excludes the stale same-slot selection', () => {
    const catalog = makeValidCatalogFixture()
    const oldTail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    const replacement = { ...oldTail, id: 'tail_fresh', excludes: [oldTail.id] }
    catalog.parts = [replacement]
    const candidate = buildCandidates({
      catalog,
      slotId: 'tail',
      themeId: 'fungal',
      rigId: 'blob',
      selections: { tail: { partId: oldTail.id, rigId: 'blob' } },
      rng: createRng(['candidate-reroll']),
    })
    expect(candidate.trace.candidateIds).toEqual(['tail_fresh'])
    expect(candidate.part?.id).toBe('tail_fresh')
  })

  it('combines base, active theme, and every active semantic boost multiplier', () => {
    const catalog = makeValidCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    const legs = catalog.parts.find(part => part.slotId === 'legs')!
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    const boostingLegs = { ...legs, boosts: { [eyes.semanticTraitId!]: 4 } }
    const boostingArms = { ...arms, boosts: { [eyes.semanticTraitId!]: 5 } }
    catalog.parts = [
      boostingLegs,
      boostingArms,
      { ...eyes, id: 'eyes_weighted', baseWeight: 3, themeWeights: { fungal: 2 } },
    ]
    const candidate = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {
        legs: { partId: boostingLegs.id, rigId: 'blob' },
        arms: { partId: boostingArms.id, rigId: 'blob' },
      },
      rng: { nextFloat: () => 0 },
    })
    expect(candidate.trace.finalWeights).toEqual({ eyes_weighted: 120 })
  })
})

describe('local changes', () => {
  it('rerolls a slot without changing independent slots', () => {
    const catalog = makeValidCatalogFixture()
    const before = generateMonster(baseRequest, catalog).spec
    const after = rerollSlot({ spec: before, slotId: 'eyes', locks: {}, catalog }).spec
    expect(after.slotRolls.eyes).toBe(before.slotRolls.eyes + 1)
    expect(after.visualSlots.bodyFrame).toEqual(before.visualSlots.bodyFrame)
    expect(after.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('matches direct slot generation when rerolling the same isolated stream', () => {
    const catalog = makeValidCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push({ ...eyes, id: 'eyes_second' })
    const before = generateMonster(baseRequest, catalog).spec
    const direct = generateMonster({ ...baseRequest, slotRolls: { eyes: 1 } }, catalog).spec
    const rerolled = rerollSlot({ spec: before, slotId: 'eyes', locks: {}, catalog }).spec
    expect(rerolled.visualSlots.eyes).toEqual(direct.visualSlots.eyes)
    expect(rerolled.visualSlots.bodyFrame).toEqual(before.visualSlots.bodyFrame)
    expect(rerolled.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('rerolls a parent stream without stale unlocked descendant constraints', () => {
    const baseCatalog = makeValidCatalogFixture()
    baseCatalog.dependencies = { arms: ['eyes'] }
    const before = generateMonster(baseRequest, baseCatalog).spec
    const arms = baseCatalog.parts.find(part => part.slotId === 'arms')!
    const eyes = baseCatalog.parts.find(part => part.slotId === 'eyes')!
    const expanded: Catalog = {
      ...baseCatalog,
      parts: [
        ...baseCatalog.parts.filter(part => part.id !== arms.id),
        { ...arms, baseWeight: 0 },
        { ...arms, id: 'arms_rerolled', baseWeight: 999, excludes: [eyes.id] },
        { ...eyes, id: 'eyes_descendant' },
      ],
    }
    const direct = generateMonster({ ...baseRequest, slotRolls: { arms: 1 } }, expanded).spec
    const rerolled = rerollSlot({ spec: before, slotId: 'arms', locks: {}, catalog: expanded }).spec
    expect(direct.visualSlots.arms.partId).toBe('arms_rerolled')
    expect(rerolled.visualSlots.arms).toEqual(direct.visualSlots.arms)
    expect(rerolled.visualSlots.eyes).toEqual(direct.visualSlots.eyes)
  })

  it('rerolls only unlocked descendants', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { bodyFrame: ['legs', 'tail'], legs: ['effect'] }
    const before = generateMonster(baseRequest, catalog).spec
    const result = rerollSlot({ spec: before, slotId: 'bodyFrame', locks: { tail: true }, catalog })
    expect(result.spec.slotRolls.bodyFrame).toBe(1)
    expect(result.spec.slotRolls.legs).toBe(0)
    expect(result.spec.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('checks locked descendants after unlocked descendants finish recomputing', () => {
    const baseCatalog = makeValidCatalogFixture()
    baseCatalog.dependencies = { bodyFrame: ['arms', 'eyes'] }
    const before = generateMonster(baseRequest, baseCatalog).spec
    const arms = baseCatalog.parts.find(part => part.slotId === 'arms')!
    const eyes = baseCatalog.parts.find(part => part.slotId === 'eyes')!
    const changed: Catalog = {
      ...baseCatalog,
      parts: [
        ...baseCatalog.parts.filter(part => part.id !== arms.id),
        { ...arms, excludes: [eyes.id] },
        { ...eyes, id: 'eyes_after_lock' },
      ],
    }
    const rerolled = rerollSlot({ spec: before, slotId: 'bodyFrame', locks: { arms: true }, catalog: changed })
    expect(rerolled.spec.visualSlots.arms).toEqual(before.visualSlots.arms)
    expect(rerolled.spec.visualSlots.eyes.partId).toBe('eyes_after_lock')
    expect(rerolled.blocked).toBe(false)
  })

  it('manual selection bypasses weights but rejects a hard-incompatible part', () => {
    const catalog = makeValidCatalogFixture()
    const tail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    catalog.parts.push({ ...tail, id: 'tail_manual', baseWeight: 0 })
    const before = generateMonster(baseRequest, catalog).spec
    const selected = selectVisualPart({ spec: before, slotId: 'tail', partId: 'tail_manual', locks: {}, catalog })
    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.tail.partId).toBe('tail_manual')

    catalog.parts.push({ ...tail, id: 'tail_wrong_rig', compatibleRigs: ['biped'] })
    const rejected = selectVisualPart({ spec: before, slotId: 'tail', partId: 'tail_wrong_rig', locks: {}, catalog })
    expect(rejected.blocked).toBe(true)
    expect(rejected.spec.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('manual selection does not treat the replaced same-slot part as an active exclusion', () => {
    const catalog = makeValidCatalogFixture()
    const tail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    catalog.parts.push({ ...tail, id: 'tail_replacement', excludes: [tail.id] })
    const before = generateMonster(baseRequest, catalog).spec
    const selected = selectVisualPart({ spec: before, slotId: 'tail', partId: 'tail_replacement', locks: {}, catalog })
    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.tail.partId).toBe('tail_replacement')
  })

  it('manual parent selection replaces an incompatible unlocked descendant', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { arms: ['eyes'] }
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push(
      { ...arms, id: 'arms_manual', baseWeight: 0, excludes: [eyes.id] },
      { ...eyes, id: 'eyes_compatible' },
    )
    const before = generateMonster(baseRequest, catalog).spec
    expect(before.visualSlots.eyes.partId).toBe(eyes.id)
    const selected = selectVisualPart({ spec: before, slotId: 'arms', partId: 'arms_manual', locks: {}, catalog })
    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.arms.partId).toBe('arms_manual')
    expect(selected.spec.visualSlots.eyes.partId).toBe('eyes_compatible')
  })

  it('manual parent selection preserves an incompatible locked descendant and blocks', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { arms: ['eyes'] }
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push({ ...arms, id: 'arms_manual', baseWeight: 0, excludes: [eyes.id] })
    const before = generateMonster(baseRequest, catalog).spec
    const selected = selectVisualPart({
      spec: before,
      slotId: 'arms',
      partId: 'arms_manual',
      locks: { eyes: true },
      catalog,
    })
    expect(selected.spec.visualSlots.arms.partId).toBe('arms_manual')
    expect(selected.spec.visualSlots.eyes).toEqual(before.visualSlots.eyes)
    expect(selected.blocked).toBe(true)
    expect(selected.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'eyes'] }),
    )
  })
})
