import { describe, expect, it } from 'vitest'
import type { AnatomyBundleDefinition, Catalog, MonsterSpec, VisualSlotId } from './contracts.js'
import {
  deriveBundleStructuralSlots,
  resolveAnatomyBundle,
  validateAnatomyBundleSpec,
} from './anatomy-bundle.js'
import { makeValidMonsterSpecFixture } from './test-fixtures.js'

const hash = 'a'.repeat(64)
const resource = (name: string) => ({
  assetPath: `assets/v0.6.0/bundles/${name}.webp`,
  assetSha256: hash,
  pngPath: `assets/v0.6.0/bundles/${name}.png`,
  pngSha256: hash,
})

function bundle(id: string, partIds: Partial<Record<VisualSlotId, string>> = {}): AnatomyBundleDefinition {
  return {
    id,
    archetypeId: 'feline',
    rigId: 'feline-sit',
    poseId: 'sit',
    structural: resource(`${id}-structural`),
    alpha: resource(`${id}-alpha`),
    clip: resource(`${id}-clip`),
    faceSafeZone: { x: 400, y: 300, width: 800, height: 700 },
    featureSockets: { ears: { x: 900, y: 500 } },
    mutationAnchors: { tail: { x: 1400, y: 1300, width: 120, height: 100 } },
    derivedSlots: {
      bodyFrame: partIds.bodyFrame ?? `${id}-body`,
      headShape: partIds.headShape ?? `${id}-head`,
      arms: partIds.arms ?? `${id}-arms`,
      legs: partIds.legs ?? `${id}-legs`,
      tail: partIds.tail ?? `${id}-tail`,
      extraAppendage: partIds.extraAppendage ?? `${id}-extra`,
    },
    allowedTraitPools: {
      eyes: [`${id}-eyes`],
      mouthShape: [`${id}-mouth`],
      oralDetail: [`${id}-oral-detail`],
      headAppendage: [`${id}-head-appendage`],
      surfaceMaterial: [`${id}-surface`],
      pattern: [`${id}-pattern`],
      colorScheme: [`${id}-color`],
      effect: [`${id}-effect`],
    },
  }
}

function catalogWithBundles(...bundles: AnatomyBundleDefinition[]): Catalog {
  return {
    version: '0.6.0', themes: [], rigs: [], parts: [], semanticTraits: [], modifiers: [], dependencies: {},
    anatomyBundles: bundles,
  }
}

function specForBundle(bundleId: string): MonsterSpec {
  const spec = makeValidMonsterSpecFixture()
  spec.schemaVersion = '0.2.0'
  spec.catalogVersion = '0.6.0'
  spec.rendererVersion = '0.6.0'
  spec.archetypeId = 'feline'
  spec.anatomyBundleId = bundleId
  for (const slotId of Object.keys(spec.visualSlots) as VisualSlotId[]) {
    spec.visualSlots[slotId] = { ...spec.visualSlots[slotId], rigId: 'feline-sit' }
  }
  return spec
}

describe('anatomy bundles', () => {
  it('resolves the selected bundle and derives its structural selections', () => {
    const selected = bundle('round')
    const catalog = catalogWithBundles(selected)
    const spec = specForBundle(selected.id)

    expect(resolveAnatomyBundle(spec, catalog)).toBe(selected)
    expect(deriveBundleStructuralSlots(selected)).toEqual({
      bodyFrame: { partId: 'round-body', rigId: 'feline-sit' },
      headShape: { partId: 'round-head', rigId: 'feline-sit' },
      arms: { partId: 'round-arms', rigId: 'feline-sit' },
      legs: { partId: 'round-legs', rigId: 'feline-sit' },
      tail: { partId: 'round-tail', rigId: 'feline-sit' },
      extraAppendage: { partId: 'round-extra', rigId: 'feline-sit' },
    })
  })

  it('reports a forged derived structural selection from another bundle', () => {
    const round = bundle('round')
    const tufted = bundle('tufted')
    const spec = specForBundle(round.id)
    spec.visualSlots.tail = { partId: tufted.derivedSlots.tail, rigId: 'feline-sit' }

    expect(validateAnatomyBundleSpec(spec, catalogWithBundles(round, tufted))).toContainEqual(
      expect.objectContaining({
        code: 'SPEC_ANATOMY_BUNDLE_SLOT_MISMATCH', path: ['visualSlots', 'tail'],
      }),
    )
  })
})
