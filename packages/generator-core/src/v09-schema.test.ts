import { describe, expect, it } from 'vitest'
import {
  V09_COMPOSITION_NODE_IDS,
  V09_TRAIT_SLOT_IDS,
  parseMonsterSpecV09,
  parseReleaseManifestV09,
  parseSealedTraitArtifactV1,
} from './index.js'

const sha256 = 'a'.repeat(64)

function pngRef(resourceId = 'v0.9.0/example.png') {
  return {
    resourceId,
    sha256,
    mediaType: 'image/png' as const,
    width: 2048 as const,
    height: 2048 as const,
  }
}

function jsonRef(resourceId = 'v0.9.0/example.json') {
  return {
    resourceId,
    sha256,
    mediaType: 'application/qmonster-manifest-v1+json' as const,
  }
}

function makeMonsterSpecV09Fixture() {
  return {
    schemaVersion: '0.4.0',
    catalogVersion: '0.9.0',
    rendererVersion: '0.9.0',
    seed: 'fixture-seed',
    speciesRigId: 'feline-sit-v2',
    skeletonFamilyId: 'feline-sit-v2-core',
    assemblyTemplateId: 'feline-sit-v2-core-template',
    skeletonSelection: { class: 'base', candidateId: 'feline-sit-v2-core', roll: 0 },
    visualSlots: Object.fromEntries(V09_TRAIT_SLOT_IDS.map(slotId => [slotId, {
      traitId: `${slotId}-common-01`, rarity: 'common', roll: 0,
    }])),
  }
}

function makeSealedTraitFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'qmonster-sealed-trait-v1',
    traitId: 'eyes-round',
    kind: 'eyePair',
    slotId: 'eyes',
    rarity: 'common',
    skeletonFamilyId: 'feline-sit-v2-core',
    assemblyTemplateId: 'feline-sit-v2-core-template',
    assemblyTemplateSha256: sha256,
    neutralMasterSha256: sha256,
    authoringInputs: [pngRef('v0.9.0/eyes-zone.png')],
    runtimeResources: { underlay: pngRef('v0.9.0/eyes-underlay.png'), content: pngRef('v0.9.0/eyes-content.png') },
    fullContextPreview: pngRef('v0.9.0/eyes-preview.png'),
    sealerVersion: '1.0.0',
    ...overrides,
  }
}

function makeReleaseManifestFixture() {
  return {
    schemaVersion: 'qmonster-release-v1',
    versionTuple: { schemaVersion: '0.4.0', catalogVersion: '0.9.0', rendererVersion: '0.9.0' },
    speciesRig: jsonRef('v0.9.0/feline/rig.json'),
    skeletonPool: jsonRef('v0.9.0/feline/pool.json'),
    skeletonFamilies: [jsonRef('v0.9.0/feline/skeleton.json')],
    assemblyTemplates: [jsonRef('v0.9.0/feline/template.json')],
    approvals: [jsonRef('v0.9.0/feline/approval.json')],
    traitApprovals: [jsonRef('v0.9.0/feline/trait-approval.json')],
    traitInventory: jsonRef('v0.9.0/feline/inventory.json'),
    sealedTraits: [jsonRef('v0.9.0/feline/trait.json')],
    compositionGraph: jsonRef('v0.9.0/feline/composition.json'),
    rendererBuildSha256: sha256,
  }
}

describe('v0.9 schema contracts', () => {
  it('accepts the exact v0.9 identity tuple and twelve slots', () => {
    const parsed = parseMonsterSpecV09(makeMonsterSpecV09Fixture())

    expect(parsed.ok).toBe(true)
  })

  it('freezes the exact composition order consumed by the v0.9 renderer', () => {
    expect(V09_COMPOSITION_NODE_IDS).toEqual([
      'backgroundEffect', 'attachment.behind', 'skeleton.base', 'surface.bodyColor',
      'surface.pattern', 'surface.texture', 'surface.forepawDetail', 'surface.hindpawDetail',
      'surface.tailSurface', 'targetedEffect.underlay', 'eyePair.underlay', 'eyePair.content',
      'eyePair.edgeOcclusionReplay', 'mouth.back', 'oralDetail', 'mouth.front',
      'mouth.edgeOcclusionReplay', 'attachment.front', 'skeleton.attachmentOcclusionReplay',
      'targetedEffect.overlay', 'foregroundAmbientEffect',
    ])
  })

  it.each(['anchor', 'transform', 'crop', 'zIndex'])('rejects forbidden field %s', field => {
    const input = { ...makeSealedTraitFixture(), [field]: {} }

    expect(parseSealedTraitArtifactV1(input)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'TRAIT_SCHEMA_INVALID' })]),
    })
  })

  it('rejects a missing eye-pair resource role', () => {
    const input = makeSealedTraitFixture({ runtimeResources: { underlay: pngRef() } })

    expect(parseSealedTraitArtifactV1(input).ok).toBe(false)
  })

  it('rejects a mouth without both fixed resource roles', () => {
    const input = makeSealedTraitFixture({
      kind: 'mouth',
      slotId: 'mouthShape',
      runtimeResources: { mouthBack: pngRef('v0.9.0/mouth-back.png') },
    })

    expect(parseSealedTraitArtifactV1(input)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'TRAIT_SCHEMA_INVALID' })]),
    })
  })

  it('allows an attachment front layer only in addition to its required behind layer', () => {
    const input = makeSealedTraitFixture({
      kind: 'attachment',
      slotId: 'headAppendage',
      interfaceId: 'ear-interface',
      shapeClass: 'ear-ornament',
      runtimeResources: {
        attachmentBehind: pngRef('v0.9.0/attachment-behind.png'),
        attachmentFront: pngRef('v0.9.0/attachment-front.png'),
      },
    })

    expect(parseSealedTraitArtifactV1(input).ok).toBe(true)
    expect(parseSealedTraitArtifactV1({ ...input, runtimeResources: {} }).ok).toBe(false)
  })

  it('rejects unknown fields in a release manifest boundary', () => {
    expect(parseReleaseManifestV09({ ...makeReleaseManifestFixture(), assetPath: 'outside-contract' }))
      .toMatchObject({ ok: false, diagnostics: expect.any(Array) })
  })
})
