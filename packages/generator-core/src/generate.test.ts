import { describe, expect, it } from 'vitest'
import {
  buildCandidates,
  createRng,
  generateMonster,
  rerollSlot,
  selectVisualPart,
  VISUAL_SLOT_IDS,
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

  it('selects the same mutation for the same request', () => {
    const request = { ...baseRequest, mode: 'mutation' } as const
    const catalog = makeValidCatalogFixture()
    const first = generateMonster(request, catalog)
    const second = generateMonster(request, catalog)

    expect(first.blocked).toBe(false)
    expect(first.spec.mutation).toEqual(second.spec.mutation)
    expect(first.spec.mutation).not.toBeNull()
    expect(first.spec.aberrations).toEqual([])
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
  function makeRigSwitchCatalog(): Catalog {
    const catalog = makeValidCatalogFixture()
    const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    const descendants = VISUAL_SLOT_IDS.filter(slotId => slotId !== 'bodyFrame')
    const originalParts = catalog.parts.filter(part => part.slotId !== 'bodyFrame')
    catalog.dependencies = { bodyFrame: descendants }
    catalog.parts = [
      { ...body, compatibleRigs: ['blob'] },
      {
        ...body,
        id: 'body_biped_manual',
        baseWeight: 0,
        compatibleRigs: ['biped'],
        semanticTraitId: 'frame_biped',
      },
      {
        ...body,
        id: 'body_floating_manual',
        baseWeight: 0,
        compatibleRigs: ['floating'],
        semanticTraitId: 'frame_floating',
      },
      ...originalParts.map(part => ({ ...part, compatibleRigs: ['blob'] as const })),
      ...descendants.flatMap(slotId => {
        const source = originalParts.find(part => part.slotId === slotId)!
        return [
          { ...source, id: `${slotId}_biped`, compatibleRigs: ['biped'] as const },
          { ...source, id: `${slotId}_floating`, compatibleRigs: ['floating'] as const },
        ]
      }),
    ]
    catalog.semanticTraits.push(
      { id: 'frame_biped', semanticSlotId: 'frame' },
      { id: 'frame_floating', semanticSlotId: 'frame' },
    )
    return catalog
  }

  it.each([
    ['body_biped_manual', 'biped', 'frame_biped'],
    ['body_floating_manual', 'floating', 'frame_floating'],
  ] as const)('manual body selection changes to the target %s rig and rebuilds every unlocked descendant', (
    partId,
    targetRig,
    frameTrait,
  ) => {
    const catalog = makeRigSwitchCatalog()
    const before = generateMonster(baseRequest, catalog).spec
    const snapshot = structuredClone(before)

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId,
      locks: {},
      catalog,
    })

    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.bodyFrame).toEqual({ partId, rigId: targetRig })
    for (const slotId of VISUAL_SLOT_IDS) {
      expect(selected.spec.visualSlots[slotId].rigId, slotId).toBe(targetRig)
      if (slotId !== 'bodyFrame') {
        expect(selected.spec.visualSlots[slotId].partId, slotId).toBe(`${slotId}_${targetRig}`)
      }
    }
    expect(selected.spec.semanticTraits.frame.primaryTraitId).toBe(frameTrait)
    expect(before).toEqual(snapshot)
  })

  it('keeps the current rig when a manual body part supports it', () => {
    const catalog = makeRigSwitchCatalog()
    const body = catalog.parts.find(part => part.id === 'body_biped_manual')!
    catalog.parts.push({
      ...body,
      id: 'body_current_rig',
      compatibleRigs: ['floating', 'blob'],
    })
    const before = generateMonster(baseRequest, catalog).spec

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_current_rig',
      locks: {},
      catalog,
    })

    expect(selected.spec.visualSlots.bodyFrame.rigId).toBe('blob')
  })

  it('uses stable catalog rig order when a manual body part supports multiple new rigs', () => {
    const catalog = makeRigSwitchCatalog()
    const body = catalog.parts.find(part => part.id === 'body_biped_manual')!
    catalog.parts.push({
      ...body,
      id: 'body_catalog_order',
      compatibleRigs: ['floating', 'biped'],
    })
    const before = generateMonster(baseRequest, catalog).spec

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_catalog_order',
      locks: {},
      catalog,
    })

    expect(selected.spec.visualSlots.bodyFrame.rigId).toBe('biped')
  })

  it('manual cross-rig body selection preserves a compatible locked descendant', () => {
    const catalog = makeRigSwitchCatalog()
    const eyes = catalog.parts.find(part => part.id === 'eyes_asymmetric')!
    catalog.parts = catalog.parts.map(part => (
      part.id === eyes.id ? { ...part, compatibleRigs: ['blob', 'biped'] } : part
    ))
    const before = generateMonster(baseRequest, catalog).spec

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_biped_manual',
      locks: { eyes: true },
      catalog,
    })

    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.eyes).toEqual({
      partId: before.visualSlots.eyes.partId,
      rigId: 'biped',
    })
  })

  it('manual cross-rig body selection preserves an incompatible lock and reports the blocker', () => {
    const catalog = makeRigSwitchCatalog()
    const before = generateMonster(baseRequest, catalog).spec

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_biped_manual',
      locks: { legs: true },
      catalog,
    })

    expect(selected.spec.visualSlots.bodyFrame).toEqual({ partId: 'body_biped_manual', rigId: 'biped' })
    expect(selected.spec.visualSlots.legs).toEqual({
      partId: before.visualSlots.legs.partId,
      rigId: 'biped',
    })
    expect(selected.blocked).toBe(true)
    expect(selected.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'legs'] }),
    )
  })

  it('manual color selection is bound to the current theme without hard-binding other slots', () => {
    const catalog = makeValidCatalogFixture()
    const color = catalog.parts.find(part => part.slotId === 'colorScheme')!
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push(
      { ...color, id: 'color_deep_sea_only', themeIds: ['deep-sea'] },
      { ...eyes, id: 'eyes_deep_sea_only', themeIds: ['deep-sea'] },
    )
    const before = generateMonster(baseRequest, catalog).spec
    const snapshot = structuredClone(before)

    const rejected = selectVisualPart({
      spec: before,
      slotId: 'colorScheme',
      partId: 'color_deep_sea_only',
      locks: {},
      catalog,
    })
    const crossThemeEyes = selectVisualPart({
      spec: before,
      slotId: 'eyes',
      partId: 'eyes_deep_sea_only',
      locks: {},
      catalog,
    })

    expect(rejected.blocked).toBe(true)
    expect(rejected.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'PART_INCOMPATIBLE', path: ['visualSlots', 'colorScheme'] }),
    )
    expect(rejected.spec).toEqual(snapshot)
    expect(before).toEqual(snapshot)
    expect(crossThemeEyes.blocked).toBe(false)
    expect(crossThemeEyes.spec.visualSlots.eyes.partId).toBe('eyes_deep_sea_only')
  })

  it('rerolls a slot without changing independent slots', () => {
    const catalog = makeValidCatalogFixture()
    const before = generateMonster(baseRequest, catalog).spec
    const after = rerollSlot({ spec: before, slotId: 'eyes', locks: {}, catalog }).spec
    expect(after.slotRolls.eyes).toBe(before.slotRolls.eyes + 1)
    expect(after.visualSlots.bodyFrame).toEqual(before.visualSlots.bodyFrame)
    expect(after.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('uses rerollIndex to change only the target slot stream and counter', () => {
    const catalog = makeValidCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push({ ...eyes, id: 'eyes_second' })
    const before = generateMonster(baseRequest, catalog).spec
    const direct = generateMonster({ ...baseRequest, slotRolls: { eyes: 1 } }, catalog).spec
    const rerolled = rerollSlot({ spec: before, slotId: 'eyes', locks: {}, catalog }).spec

    expect(before.visualSlots.eyes.partId).toBe('eyes_asymmetric')
    expect(direct.visualSlots.eyes.partId).toBe('eyes_second')
    expect(rerolled.visualSlots.eyes).toEqual(direct.visualSlots.eyes)
    expect(rerolled.slotRolls).toEqual({ ...before.slotRolls, eyes: 1 })
    for (const slotId of VISUAL_SLOT_IDS) {
      if (slotId === 'eyes') continue
      expect(rerolled.visualSlots[slotId], slotId).toEqual(before.visualSlots[slotId])
      expect(rerolled.slotRolls[slotId], slotId).toBe(before.slotRolls[slotId])
    }
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

  it('changes exactly the target and unlocked transitive descendants while preserving a locked descendant', () => {
    const baseCatalog = makeValidCatalogFixture()
    baseCatalog.dependencies = { arms: ['eyes'], eyes: ['mouthShape'], mouthShape: ['effect'] }
    const before = generateMonster(baseRequest, baseCatalog).spec
    const arms = baseCatalog.parts.find(part => part.slotId === 'arms')!
    const eyes = baseCatalog.parts.find(part => part.slotId === 'eyes')!
    const mouth = baseCatalog.parts.find(part => part.slotId === 'mouthShape')!
    const effect = baseCatalog.parts.find(part => part.slotId === 'effect')!
    const changed: Catalog = {
      ...baseCatalog,
      parts: [
        ...baseCatalog.parts.filter(part => part.id !== arms.id),
        { ...arms, baseWeight: 0 },
        { ...arms, id: 'arms_changed', baseWeight: 999, excludes: [eyes.id] },
        { ...eyes, id: 'eyes_changed', excludes: [mouth.id] },
        { ...mouth, id: 'mouth_changed', excludes: [effect.id] },
      ],
    }
    const after = rerollSlot({
      spec: before,
      slotId: 'arms',
      locks: { effect: true },
      catalog: changed,
    })
    const changedSlots = VISUAL_SLOT_IDS.filter(
      slotId => after.spec.visualSlots[slotId].partId !== before.visualSlots[slotId].partId,
    )

    expect(changedSlots).toEqual(['eyes', 'mouthShape', 'arms'])
    expect(after.spec.visualSlots.arms.partId).toBe('arms_changed')
    expect(after.spec.visualSlots.eyes.partId).toBe('eyes_changed')
    expect(after.spec.visualSlots.mouthShape.partId).toBe('mouth_changed')
    expect(after.spec.visualSlots.effect).toEqual(before.visualSlots.effect)
    expect(after.spec.slotRolls).toEqual({ ...before.slotRolls, arms: 1 })
    expect(after.blocked).toBe(true)
    expect(after.diagnostics).toEqual([
      expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'effect'] }),
    ])
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
