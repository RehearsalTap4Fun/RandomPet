import { describe, expect, it } from 'vitest'
import { generateMonster } from './generate.js'
import { rerollSlot, selectVisualPart } from './reroll.js'
import { parseCatalog } from './catalog-schema.js'
import { STRUCTURAL_SLOT_IDS, VISUAL_SLOT_IDS } from './contracts.js'
import { validateAnatomyBundleSpec } from './anatomy-bundle.js'
import v06ProductionCatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'
import {
  applyAnatomyBundle,
  rerollAnatomyBundle,
  selectAnatomyBundle,
} from './anatomy-bundle-generation.js'
import { makeV07FelinePartLibraryFixture } from './test-fixtures.js'

function productionCatalog() {
  const parsed = parseCatalog(v06ProductionCatalogDocument)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('Expected the v0.6 production catalog to parse.')
  return parsed.value
}

describe('anatomy bundle generation', () => {
  it('selects one v0.7 bundle while retaining independently selected structural parts', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const generated = generateMonster({
      seed: 'v07-bundle-generation', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog)

    expect(generated.blocked).toBe(false)
    expect(generated.spec.anatomyBundleId).toBe('feline-sit')
    expect(generated.spec.visualSlots.tail.partId).toMatch(/^tail_[nrl]_/)
    expect(validateAnatomyBundleSpec(generated.spec, catalog)).toEqual([])
  })

  it('selects a deterministic exact-v0.6 bundle and applies all derived structural slots', () => {
    const catalog = productionCatalog()
    const request = { seed: 'bundle-selection', themeId: 'fungal', mode: 'normal' as const, archetypeId: 'feline' as const }
    const bundle = selectAnatomyBundle(request, catalog)
    const generated = generateMonster(request, catalog)

    expect(bundle).not.toBeNull()
    expect(generated.blocked).toBe(false)
    expect(generated.spec.anatomyBundleId).toBe(bundle!.id)
    expect(applyAnatomyBundle(generated.spec, bundle!)).toMatchObject({ anatomyBundleId: bundle!.id })
    for (const slotId of STRUCTURAL_SLOT_IDS) {
      expect(generated.spec.visualSlots[slotId]).toEqual({
        partId: bundle!.derivedSlots[slotId], rigId: bundle!.rigId,
      })
      expect(generated.spec.genome!.genes[slotId]).toEqual({
        P: bundle!.derivedSlots[slotId], H1: bundle!.derivedSlots[slotId],
        H2: bundle!.derivedSlots[slotId], H3: bundle!.derivedSlots[slotId],
      })
    }
  })

  it('rolls the available Bundle rarity tier before choosing a Bundle within that tier', () => {
    const catalog = structuredClone(productionCatalog())
    const rarityByBundleId = {
      'feline-sit-saffron-longtail': 'N',
      'feline-sit-silver-curl': 'N',
      'feline-sit-midnight-longtail': 'N',
      'feline-sit-moss-curl': 'N',
      'feline-sit-rose-longtail': 'R',
      'feline-sit-umber-curl': 'R',
      'feline-sit-ivory-longtail': 'N',
      'feline-sit-violet-curl': 'L',
    } as const
    for (const bundle of catalog.anatomyBundles ?? []) {
      Object.assign(bundle, {
        rarity: rarityByBundleId[bundle.id as keyof typeof rarityByBundleId],
        baseWeight: 1,
      })
    }

    const bundle = selectAnatomyBundle({
      seed: 'rarity-tier-10', themeId: 'shadow', mode: 'normal', archetypeId: 'feline',
      slotRolls: { bodyFrame: 0 },
    }, catalog)

    expect((bundle as { rarity?: string } | null)?.rarity).toBe('R')
  })

  it('keeps a locked appearance on its selected bundle', () => {
    const catalog = productionCatalog()
    const initial = generateMonster({
      seed: 'bundle-reroll', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog).spec

    const rerolled = rerollAnatomyBundle({ spec: initial, catalog, locked: true })

    expect(rerolled.blocked).toBe(true)
    expect(rerolled.spec.anatomyBundleId).toBe(initial.anatomyBundleId)
    expect(rerolled.spec).toEqual(initial)
  })

  it('blocks malformed local pools before they can choose a trait owned by another bundle', () => {
    const catalog = structuredClone(productionCatalog())
    const selectedBundle = catalog.anatomyBundles![0]!
    const foreignEye = catalog.anatomyBundles![1]!.allowedTraitPools.eyes![0]!
    catalog.anatomyBundles = [selectedBundle]
    delete (selectedBundle.allowedTraitPools as Partial<Record<string, string[]>>).eyes

    const generated = generateMonster({
      seed: 'remediation-0', themeId: 'shadow', mode: 'normal', archetypeId: 'feline',
    }, catalog)

    expect(generated.blocked).toBe(true)
    expect(generated.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CATALOG_ANATOMY_BUNDLE_TRAIT_POOL_REQUIRED',
      path: ['anatomyBundles', '0', 'allowedTraitPools', 'eyes'],
    }))
    expect(generated.spec.visualSlots.eyes.partId).not.toBe(foreignEye)
  })

  it('keeps bundle structure stable throughout local rerolls for every mode and seed', () => {
    const catalog = productionCatalog()
    for (const mode of ['normal', 'mutation', 'aberration'] as const) {
      for (let seed = 0; seed < 100; seed += 1) {
        const request = { seed: `bundle-matrix-${seed}`, themeId: 'fungal' as const, mode, archetypeId: 'feline' as const }
        const generated = generateMonster(request, catalog)
        const repeated = generateMonster(request, catalog)
        expect(generated.blocked).toBe(false)
        expect(generated.spec).toEqual(repeated.spec)
        expect(generated.spec.anatomyBundleId).toBeDefined()
        const bundle = catalog.anatomyBundles!.find(item => item.id === generated.spec.anatomyBundleId)!
        for (const [slotId, allowedPartIds] of Object.entries(bundle.allowedTraitPools)) {
          expect(allowedPartIds).toContain(generated.spec.visualSlots[slotId as keyof typeof generated.spec.visualSlots].partId)
        }
        expect(Object.values(generated.spec.visualSlots).filter(selection => (
          catalog.parts.find(part => part.id === selection.partId)?.featureTier === 'special'
        )).length).toBeLessThanOrEqual(1)
        const rerolled = rerollSlot({ spec: generated.spec, slotId: 'eyes', locks: {}, catalog })
        expect(rerolled.blocked).toBe(false)
        expect(rerolled.spec.anatomyBundleId).toBe(generated.spec.anatomyBundleId)
        for (const slotId of STRUCTURAL_SLOT_IDS) {
          expect(rerolled.spec.visualSlots[slotId]).toEqual(generated.spec.visualSlots[slotId])
        }
      }
    }
  })

  it('changes only the requested local slot when selecting an allowed v0.6 eye part', () => {
    const catalog = productionCatalog()
    const before = generateMonster({
      seed: 'bundle-local-eye-selection', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog).spec
    const bundle = catalog.anatomyBundles!.find(item => item.id === before.anatomyBundleId)!
    const selected = selectVisualPart({
      spec: before,
      slotId: 'eyes',
      partId: bundle.allowedTraitPools.eyes![0]!,
      locks: {},
      catalog,
    })

    expect(selected.blocked).toBe(false)
    expect(selected.affectedSlots).toEqual(['eyes'])
    expect(selected.spec.anatomyBundleId).toBe(before.anatomyBundleId)
    expect(selected.spec.visualSlots.eyes.partId).toBe(bundle.allowedTraitPools.eyes![0])
    for (const slotId of VISUAL_SLOT_IDS) {
      if (slotId !== 'eyes') expect(selected.spec.visualSlots[slotId]).toEqual(before.visualSlots[slotId])
    }
    for (const slotId of STRUCTURAL_SLOT_IDS) {
      expect(selected.spec.visualSlots[slotId]).toEqual(before.visualSlots[slotId])
    }
    expect(selected.spec.genome!.genes.eyes.P).toBe(bundle.allowedTraitPools.eyes![0])
    expect(selected.spec.genome!.genes).toEqual(before.genome!.genes)
    expect(validateAnatomyBundleSpec(selected.spec, catalog)).toEqual([])
  })

  it('publishes anatomy bundle APIs from the package root', async () => {
    const publicApi = await import('./index.js')

    expect(publicApi.selectAnatomyBundle).toBeTypeOf('function')
    expect(publicApi.applyAnatomyBundle).toBeTypeOf('function')
    expect(publicApi.rerollAnatomyBundle).toBeTypeOf('function')
  })
})
