import { describe, expect, it } from 'vitest'
import {
  V09_TRAIT_SLOT_IDS,
  generateMonsterV09,
  parseMonsterSpecV09,
  type ResolvedV09Catalog,
  type SealedTraitArtifactV1,
  type V09TraitRarity,
  type V09TraitSlotId,
} from './index.js'

const rarities: readonly V09TraitRarity[] = ['common', 'rare', 'legendary']
const counts: Record<V09TraitRarity, number> = { common: 8, rare: 4, legendary: 1 }

function traitKind(slotId: V09TraitSlotId): SealedTraitArtifactV1['kind'] {
  if (slotId === 'eyes') return 'eyePair'
  if (slotId === 'mouthShape') return 'mouth'
  if (slotId === 'oralDetail') return 'oralDetail'
  if (slotId === 'headAppendage' || slotId === 'extraAppendage') return 'attachment'
  if (slotId === 'effect') return 'ambientEffect'
  return 'surface'
}

function trait(slotId: V09TraitSlotId, rarity: V09TraitRarity, index: number, skeletonFamilyId: string): SealedTraitArtifactV1 {
  const traitId = `${slotId}_${rarity[0]}_${skeletonFamilyId}_${index}`
  const base = {
    schemaVersion: 'qmonster-sealed-trait-v1' as const,
    traitId,
    rarity,
    skeletonFamilyId,
    assemblyTemplateId: `${skeletonFamilyId}-template`,
    assemblyTemplateSha256: 'a'.repeat(64),
    neutralMasterSha256: 'b'.repeat(64),
    authoringInputs: [{}],
    fullContextPreview: {},
    sealerVersion: 'fixture',
  }
  switch (traitKind(slotId)) {
    case 'surface': return { ...base, kind: 'surface', slotId, runtimeResources: { materialOperation: {} } } as SealedTraitArtifactV1
    case 'eyePair': return { ...base, kind: 'eyePair', slotId, runtimeResources: { underlay: {}, content: {} } } as SealedTraitArtifactV1
    case 'mouth': return { ...base, kind: 'mouth', slotId, oralSocketClass: index === 0 ? 'closed' : 'open', runtimeResources: { mouthBack: {}, mouthFront: {} } } as SealedTraitArtifactV1
    case 'oralDetail': return { ...base, kind: 'oralDetail', slotId, runtimeResources: { oralProjections: { open: {} } } } as SealedTraitArtifactV1
    case 'attachment': return { ...base, kind: 'attachment', slotId, interfaceId: 'fixture-interface', shapeClass: 'ear-ornament', runtimeResources: { attachmentBehind: {} } } as SealedTraitArtifactV1
    case 'ambientEffect': return { ...base, kind: 'ambientEffect', slotId, zoneId: 'background', runtimeResources: { effectLayer: {} } } as SealedTraitArtifactV1
    default: throw new Error(`Unknown kind for ${slotId}`)
  }
}

export function fixtureCatalog(withoutTraitId?: string): ResolvedV09Catalog {
  const skeletonFamilyIds = ['base-cat', 'legendary-cat']
  const sealedTraits = skeletonFamilyIds.flatMap(skeletonFamilyId => V09_TRAIT_SLOT_IDS.flatMap(slotId =>
    rarities.flatMap(rarity => Array.from({ length: counts[rarity] }, (_, index) => trait(slotId, rarity, index, skeletonFamilyId))),
  )).filter(item => item.traitId !== withoutTraitId)

  return {
    releaseManifestSha256: 'c'.repeat(64),
    releaseManifest: {} as ResolvedV09Catalog['releaseManifest'],
    speciesRig: {} as ResolvedV09Catalog['speciesRig'],
    skeletonPool: {
      schemaVersion: 'qmonster-skeleton-pool-v1',
      skeletonPoolId: 'fixture-pool',
      candidates: [
        { skeletonFamilyId: 'base-cat', skeletonClass: 'base', weight: 8 },
        { skeletonFamilyId: 'legendary-cat', skeletonClass: 'legendary', weight: 1 },
      ],
    },
    skeletonFamilies: skeletonFamilyIds.map(skeletonFamilyId => ({
      skeletonFamilyId,
      skeletonClass: skeletonFamilyId === 'base-cat' ? 'base' : 'legendary',
      assemblyTemplateId: `${skeletonFamilyId}-template`,
    } as ResolvedV09Catalog['skeletonFamilies'][number])),
    assemblyTemplates: [],
    sealedTraits,
    compositionGraph: {} as ResolvedV09Catalog['compositionGraph'],
  }
}

describe('v0.9 deterministic generation', () => {
  it('selects only narrow-compatible oral candidates without changing the random domain', () => {
    const result = generateMonsterV09({ seed: 'fixed-generation' }, socketFixtureCatalog())
    expect(result.blocked).toBe(false)
    expect(result.spec.visualSlots.mouthShape.traitId).toBe('mouthShape_r_base-cat_2')
    expect(result.spec.visualSlots.oralDetail).toEqual({ traitId: 'oralDetail_c_base-cat_0', rarity: 'common', roll: 0 })
  })
  it('generates a wide-mouth spec from its own compatible oral pool at the unchanged oral roll', () => {
    const result = generateMonsterV09({ seed: 'closed-4', slotRolls: { mouthShape: 1 } }, socketFixtureCatalog())
    expect(result.blocked).toBe(false)
    expect(result.spec.visualSlots.mouthShape.traitId).toBe('mouthShape_c_base-cat_7')
    expect(result.spec.visualSlots.oralDetail).toEqual({ traitId: 'oralDetail_c_base-cat_7', rarity: 'common', roll: 0 })
  })
  it('fails closed when the rolled oral rarity has no current-socket projection', () => {
    const catalog = socketFixtureCatalog()
    catalog.sealedTraits = catalog.sealedTraits.filter(trait => !(trait.kind === 'oralDetail' && trait.rarity === 'common' && Object.hasOwn(trait.runtimeResources.oralProjections, 'narrow')))
    const result = generateMonsterV09({ seed: 'fixed-generation' }, catalog)
    expect(result.blocked).toBe(true)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SKELETON_PROJECTION_MISSING', path: ['visualSlots', 'oralDetail'] })])
    expect(result.spec.visualSlots.oralDetail.traitId).toBe('missing_oralDetail')
  })
  it('uses the fixed twelve-slot order and produces a strict v0.9 spec', () => {
    const result = generateMonsterV09({ seed: 'fixed-generation', slotRolls: {} }, fixtureCatalog())
    expect(result.spec.visualSlots).toEqual({
      bodyColor: { traitId: 'bodyColor_l_base-cat_0', rarity: 'legendary', roll: 0 },
      surfacePattern: { traitId: 'surfacePattern_r_base-cat_0', rarity: 'rare', roll: 0 },
      surfaceTexture: { traitId: 'surfaceTexture_c_base-cat_7', rarity: 'common', roll: 0 },
      forepawDetail: { traitId: 'forepawDetail_r_base-cat_1', rarity: 'rare', roll: 0 },
      hindpawDetail: { traitId: 'hindpawDetail_r_base-cat_0', rarity: 'rare', roll: 0 },
      tailSurface: { traitId: 'tailSurface_c_base-cat_4', rarity: 'common', roll: 0 },
      eyes: { traitId: 'eyes_c_base-cat_2', rarity: 'common', roll: 0 },
      mouthShape: { traitId: 'mouthShape_r_base-cat_2', rarity: 'rare', roll: 0 },
      oralDetail: { traitId: 'oralDetail_c_base-cat_1', rarity: 'common', roll: 0 },
      headAppendage: { traitId: 'headAppendage_r_base-cat_2', rarity: 'rare', roll: 0 },
      extraAppendage: { traitId: 'extraAppendage_c_base-cat_7', rarity: 'common', roll: 0 },
      effect: { traitId: 'effect_r_base-cat_3', rarity: 'rare', roll: 0 },
    })

    expect(result.blocked).toBe(false)
    expect(Object.keys(result.spec.visualSlots)).toEqual(V09_TRAIT_SLOT_IDS)
    expect(parseMonsterSpecV09(result.spec).ok).toBe(true)
    expect(result.spec).toMatchObject({
      seed: 'fixed-generation',
      speciesRigId: 'feline-sit-v2',
      skeletonSelection: { roll: 0 },
    })
  })

  it('does not substitute a trait when its selected skeleton projection is absent', () => {
    const result = generateMonsterV09(
      { seed: 'missing-2', slotRolls: {} },
      fixtureCatalog('eyes_l_base-cat_0'),
    )

    expect(result).toMatchObject({
      blocked: true,
      diagnostics: [expect.objectContaining({ code: 'SKELETON_PROJECTION_MISSING', path: ['visualSlots', 'eyes'] })],
    })
  })

  it('derives oral-none from a closed mouth without consuming an oral random domain', () => {
    const result = generateMonsterV09({
      seed: 'closed-4',
      slotRolls: { mouthShape: 0, oralDetail: 7 },
    }, fixtureCatalog())

    expect(result.spec.visualSlots.mouthShape.traitId).toBe('mouthShape_c_base-cat_0')
    expect(result.spec.visualSlots.oralDetail).toEqual({ traitId: 'oral-none', rarity: 'common', roll: 7 })
  })

  it('converges to the 8:4:1 rarity distribution for every independent slot domain', () => {
    const countsByRarity: Record<V09TraitRarity, number> = { common: 0, rare: 0, legendary: 0 }
    for (let index = 0; index < 13_000; index += 1) {
      const selection = generateMonsterV09({ seed: `distribution-${index}`, slotRolls: {} }, fixtureCatalog())
        .spec.visualSlots.bodyColor
      countsByRarity[selection.rarity] += 1
    }

    expect(countsByRarity.common).toBeGreaterThan(7_500)
    expect(countsByRarity.rare).toBeGreaterThan(3_500)
    expect(countsByRarity.legendary).toBeGreaterThan(700)
  })
})

export function socketFixtureCatalog(): ResolvedV09Catalog {
  const catalog = fixtureCatalog()
  for (const trait of catalog.sealedTraits) {
    const index = Number(trait.traitId.split('_').at(-1))
    if (trait.kind === 'mouth') trait.oralSocketClass = index % 2 === 0 ? 'narrow' : 'wide'
    if (trait.kind === 'oralDetail') trait.runtimeResources.oralProjections = (trait.rarity === 'legendary' ? { narrow: {}, wide: {} } : index % 2 === 0 ? { narrow: {} } : { wide: {} }) as any
  }
  return catalog
}
