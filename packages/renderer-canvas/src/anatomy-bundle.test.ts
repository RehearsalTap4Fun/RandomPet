import { describe, expect, it } from 'vitest'
import { generateMonster, parseCatalog, type Catalog } from '@qmonster/generator-core'
import catalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'
import { resolveAnatomyBundleRenderPlan } from './anatomy-bundle.js'

const parsedCatalog = parseCatalog(catalogDocument)
if (!parsedCatalog.ok) throw new Error('Production v0.6.0 catalog is invalid.')
const catalog: Catalog = parsedCatalog.value

function v06Spec() {
  const generated = generateMonster({
    seed: 's11', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
  }, catalog)
  if (generated.blocked) throw new Error('Unable to create v0.6 anatomy fixture.')
  return generated.spec
}

describe('resolveAnatomyBundleRenderPlan', () => {
  it('resolves the exact v0.6 feline tuple to one structural bundle and no bridges', () => {
    const spec = v06Spec()
    const plan = resolveAnatomyBundleRenderPlan(spec, catalog)

    expect(plan).not.toBeNull()
    expect(plan?.bundle.id).toBe(spec.anatomyBundleId)
    expect(plan?.structuralNode.assetPath).toBe(plan?.bundle.structural.assetPath)
    expect(plan?.faceSafeZones).toEqual([plan?.bundle.faceSafeZone])
    expect(plan?.localClipMask).toEqual(plan?.bundle.clip)
    expect(plan?.bridges).toEqual([])
  })

  it('does not resolve a bundle plan for a non-exact v0.6 renderer tuple', () => {
    const spec = { ...v06Spec(), rendererVersion: '0.5.0' }

    expect(resolveAnatomyBundleRenderPlan(spec, catalog)).toBeNull()
  })
})
