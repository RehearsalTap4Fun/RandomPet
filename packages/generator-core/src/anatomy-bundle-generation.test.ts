import { describe, expect, it } from 'vitest'
import { generateMonster } from './generate.js'
import { rerollSlot } from './reroll.js'
import { parseCatalog } from './catalog-schema.js'
import { STRUCTURAL_SLOT_IDS } from './contracts.js'
import v06ProductionCatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'
import {
  applyAnatomyBundle,
  rerollAnatomyBundle,
  selectAnatomyBundle,
} from './anatomy-bundle-generation.js'

function productionCatalog() {
  const parsed = parseCatalog(v06ProductionCatalogDocument)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('Expected the v0.6 production catalog to parse.')
  return parsed.value
}

describe('anatomy bundle generation', () => {
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
})
