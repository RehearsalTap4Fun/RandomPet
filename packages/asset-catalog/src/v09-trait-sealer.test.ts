import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { canonicalJsonSha256, decodedPngSha256, V09CatalogError } from './v09-content-identity.js'
import { createTraitVisualApproval, sealTraitBundle } from './v09-trait-sealer.js'

const SIZE = 2048
const hash = (letter: string) => letter.repeat(64)

async function raster(points: readonly (readonly [number, number, number, number, number])[]): Promise<Buffer> {
  const raw = Buffer.alloc(SIZE * SIZE * 4)
  for (const [x, y, r, g, b] of points) {
    const offset = (y * SIZE + x) * 4
    raw[offset] = r
    raw[offset + 1] = g
    raw[offset + 2] = b
    raw[offset + 3] = 255
  }
  return sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer()
}

function errorCode(code: string): { asymmetricMatch(value: unknown): boolean } {
  return { asymmetricMatch: value => value instanceof V09CatalogError && value.code === code }
}

async function fixture() {
  const neutral = await raster([])
  const allowedZone = await raster([[100, 100, 0, 0, 0], [101, 100, 0, 0, 0], [102, 100, 0, 0, 0]])
  const rearRoot = await raster([[100, 100, 1, 2, 3]])
  const frontRoot = await raster([[102, 100, 4, 5, 6]])
  const layer = await raster([[100, 100, 1, 2, 3], [101, 100, 9, 8, 7]])
  const front = await raster([[102, 100, 4, 5, 6]])
  const entries = new Map<string, Buffer>()
  const ref = async (bytes: Buffer, mediaType: 'image/png' | 'application/qmonster-material-v1+json' = 'image/png') => {
    const digest = mediaType === 'image/png' ? await decodedPngSha256(bytes) : canonicalJsonSha256(JSON.parse(bytes.toString('utf8')))
    const resourceId = `sha256:${digest}`
    entries.set(resourceId, bytes)
    return mediaType === 'image/png'
      ? { resourceId, sha256: digest, mediaType, width: 2048 as const, height: 2048 as const }
      : { resourceId, sha256: digest, mediaType }
  }
  const refs = {
    neutral: await ref(neutral), allowedZone: await ref(allowedZone), rearRoot: await ref(rearRoot), frontRoot: await ref(frontRoot),
    layer: await ref(layer), front: await ref(front), preview: await ref(neutral),
  }
  const family = {
    schemaVersion: 'qmonster-skeleton-family-v1' as const, skeletonFamilyId: 'feline', skeletonClass: 'base' as const,
    structuralShapeClasses: ['feline-standard'] as const, archetypeId: 'cat', poseId: 'sit', speciesRigId: 'feline-sit-v2',
    canvas: { width: 2048 as const, height: 2048 as const }, neutralMaster: refs.neutral, materialMap: refs.neutral,
    fixedOccluderMasks: { fixed: refs.allowedZone }, assemblyTemplateId: 'template',
  }
  const graph = { schemaVersion: 'qmonster-composition-graph-v1' as const, orderedNodes: ['skeleton.base'] as any, blendMode: 'source-over-premultiplied-srgb' as const, transformPolicy: 'identity-only' as const }
  const template = {
    schemaVersion: 'qmonster-assembly-template-v1' as const, assemblyTemplateId: 'template', skeletonFamilyId: 'feline',
    canvas: { width: 2048 as const, height: 2048 as const }, neutralMasterSha256: refs.neutral.sha256,
    slots: {
      surface: [{ kind: 'surface' as const, slotId: 'bodyColor' as const, ownerMaterialId: 'body', authoringZone: refs.allowedZone }],
      embedded: [{ kind: 'eyePair' as const, slotId: 'eyes' as const, leftAuthoringZone: refs.allowedZone, rightAuthoringZone: refs.allowedZone, pairAuthoringZone: refs.allowedZone, occlusionReplayZone: refs.allowedZone }, { kind: 'mouth' as const, slotId: 'mouthShape' as const, authoringZone: refs.allowedZone, occlusionReplayZone: refs.allowedZone }, { kind: 'oralDetail' as const, slotId: 'oralDetail' as const, socketRegistry: { tooth: { authoringZone: refs.allowedZone, parentMouthTraitIds: ['mouth'] } }, closedMouthSentinel: 'oral-none' as const }],
      attachment: [{ kind: 'attachment' as const, slotId: 'headAppendage' as const, attachmentInterface: { interfaceId: 'ears', allowedShapeClasses: ['ear-horn-small'] as any, allowedZone: refs.allowedZone, rearRootStencil: refs.rearRoot, frontRootStencil: refs.frontRoot, fixedOccluderMaskId: 'fixed' } }],
      effect: [{ kind: 'targetedEffect' as const, slotId: 'effect' as const, targetId: 'eyes', authoringZone: refs.allowedZone, compositionNode: 'targetedEffect.underlay' as const }, { kind: 'ambientEffect' as const, slotId: 'effect' as const, zoneId: 'background' as const, authoringZone: refs.allowedZone, compositionNode: 'backgroundEffect' as const }],
    }, compositionGraph: graph,
  }
  const templateHash = canonicalJsonSha256(template)
  const context = { family, template, assemblyTemplateSha256: templateHash, resources: entries }
  const draft = {
    traitId: 'horn', rarity: 'common' as const, kind: 'attachment' as const, slotId: 'headAppendage' as const,
    skeletonFamilyId: 'feline', assemblyTemplateId: 'template', assemblyTemplateSha256: templateHash, neutralMasterSha256: refs.neutral.sha256,
    interfaceId: 'ears', shapeClass: 'ear-horn-small', resources: { attachmentBehind: refs.layer, attachmentFront: refs.front },
    fullContextPreview: refs.preview, sealerVersion: '0.9.0',
  }
  return { context, draft, refs, layer, front, rearRoot, neutral }
}

async function oralFixture() {
  const f = await fixture(); const template: any = f.context.template
  template.slots.embedded[2].socketRegistry = {
    narrow: { authoringZone: f.refs.allowedZone, parentMouthTraitIds: ['mouth-narrow'] },
    wide: { authoringZone: f.refs.allowedZone, parentMouthTraitIds: ['mouth-wide'] },
  }
  const draft: any = { ...f.draft, kind: 'oralDetail', slotId: 'oralDetail', oralSocketClasses: ['narrow', 'wide'], resources: { oralProjections: { narrow: f.refs.layer, wide: f.refs.front } } }
  return { ...f, draft }
}

describe('v0.9 socket-indexed oral sealing', () => {
  it('seals all declared socket projections in deterministic class order', async () => {
    const f = await oralFixture(); const first = await sealTraitBundle(f.draft, f.context)
    expect(first.artifact).toMatchObject({ runtimeResources: { oralProjections: f.draft.resources.oralProjections } })
    expect(first.artifact.authoringInputs).toEqual([f.refs.layer, f.refs.front])
    f.draft.resources.oralProjections = { wide: f.refs.front, narrow: f.refs.layer }; f.draft.oralSocketClasses.reverse()
    expect((await sealTraitBundle(f.draft, f.context)).artifactSha256).toBe(first.artifactSha256)
  })
  it.each(['missing', 'extra', 'empty', 'duplicate-class', 'closed', 'unknown', 'outside', 'hash'])('rejects invalid oral projections: %s', async mode => {
    const f = await oralFixture()
    if (mode === 'missing') delete f.draft.resources.oralProjections.wide
    if (mode === 'extra') f.draft.resources.oralProjections.other = f.refs.layer
    if (mode === 'empty') { f.draft.resources.oralProjections = {}; f.draft.oralSocketClasses = [] }
    if (mode === 'duplicate-class') f.draft.oralSocketClasses = ['narrow', 'narrow', 'wide']
    if (mode === 'closed' || mode === 'unknown') { f.draft.resources.oralProjections[mode] = f.refs.layer; f.draft.oralSocketClasses.push(mode) }
    if (mode === 'outside') (f.context.template.slots.embedded[2] as any).socketRegistry.wide.authoringZone = f.refs.neutral
    if (mode === 'hash') f.context.resources.set(f.refs.front.resourceId, await raster([]))
    await expect(sealTraitBundle(f.draft, f.context)).rejects.toEqual(errorCode(mode === 'outside' ? 'AUTHORING_ZONE_VIOLATION' : mode === 'hash' ? 'RESOURCE_HASH_MISMATCH' : 'ORAL_SOCKET_INCOMPATIBLE'))
  })
})

async function withReplacedPng(fixed: Awaited<ReturnType<typeof fixture>>, role: 'attachmentBehind' | 'attachmentFront', bytes: Buffer) {
  const previous = fixed.draft.resources[role]
  const digest = await decodedPngSha256(bytes)
  const replacement = { ...previous, resourceId: `sha256:${digest}`, sha256: digest }
  return {
    draft: { ...fixed.draft, resources: { ...fixed.draft.resources, [role]: replacement } },
    context: { ...fixed.context, resources: new Map(fixed.context.resources).set(replacement.resourceId, bytes) },
  }
}

describe('v0.9 trait sealer', () => {
  it('seals a valid allowed attachment with stable identity without mutating inputs', async () => {
    const { context, draft } = await fixture()
    const before = JSON.stringify({ context, draft })
    const first = await sealTraitBundle(draft, context)
    const second = await sealTraitBundle(draft, context)

    expect(first.artifact.kind).toBe('attachment')
    expect(first.artifactSha256).toBe(second.artifactSha256)
    expect(JSON.stringify({ context, draft })).toBe(before)
  })

  it('seals a no-front-root attachment without an undefined front resource property', async () => {
    const fixed = await fixture()
    const attachment = fixed.context.template.slots.attachment[0]!
    const { frontRootStencil: _removed, ...interfaceWithoutFront } = attachment.attachmentInterface
    const template = {
      ...fixed.context.template,
      slots: { ...fixed.context.template.slots, attachment: [{ ...attachment, attachmentInterface: interfaceWithoutFront }] },
    }
    const templateHash = canonicalJsonSha256(template)
    const context = { ...fixed.context, template, assemblyTemplateSha256: templateHash }
    const draft = { ...fixed.draft, assemblyTemplateSha256: templateHash, resources: { attachmentBehind: fixed.refs.layer } }

    const sealed = await sealTraitBundle(draft, context)

    expect(sealed.artifact).toMatchObject({ kind: 'attachment', runtimeResources: { attachmentBehind: fixed.refs.layer } })
    expect(Object.hasOwn(sealed.artifact.runtimeResources, 'attachmentFront')).toBe(false)
  })

  it('rejects deleted or recolored fixed rear and front roots', async () => {
    const fixed = await fixture()
    const { draft, rearRoot, front } = fixed
    const deleted = await raster([[101, 100, 9, 8, 7]])
    const recolored = await raster([[100, 100, 9, 8, 7], [101, 100, 9, 8, 7]])
    const missingFront = await raster([])
    const deletedCase = await withReplacedPng(fixed, 'attachmentBehind', deleted)
    const recoloredCase = await withReplacedPng(fixed, 'attachmentBehind', recolored)
    const frontCase = await withReplacedPng(fixed, 'attachmentFront', missingFront)
    await expect(sealTraitBundle(deletedCase.draft, deletedCase.context)).rejects.toEqual(errorCode('ATTACHMENT_INTERFACE_INVALID'))
    await expect(sealTraitBundle(recoloredCase.draft, recoloredCase.context)).rejects.toEqual(errorCode('ATTACHMENT_INTERFACE_INVALID'))
    await expect(sealTraitBundle(frontCase.draft, frontCase.context)).rejects.toEqual(errorCode('ATTACHMENT_INTERFACE_INVALID'))
    expect(rearRoot).toBeInstanceOf(Buffer)
    expect(front).toBeInstanceOf(Buffer)
  })

  it('rejects disconnected alpha and visible alpha outside the attachment interface zone', async () => {
    const fixed = await fixture()
    const detached = await raster([[100, 100, 1, 2, 3], [102, 100, 9, 8, 7]])
    const outside = await raster([[100, 100, 1, 2, 3], [101, 100, 9, 8, 7], [103, 100, 9, 8, 7]])
    const detachedCase = await withReplacedPng(fixed, 'attachmentBehind', detached)
    const outsideCase = await withReplacedPng(fixed, 'attachmentBehind', outside)
    await expect(sealTraitBundle(detachedCase.draft, detachedCase.context)).rejects.toEqual(errorCode('ATTACHMENT_INTERFACE_INVALID'))
    await expect(sealTraitBundle(outsideCase.draft, outsideCase.context)).rejects.toEqual(errorCode('AUTHORING_ZONE_VIOLATION'))
  })

  it('rejects unknown, structural, and disallowed shape classes before output', async () => {
    const { context, draft } = await fixture()
    for (const shapeClass of ['fish-tail', 'multi-head', 'detached-limb', 'dog-tail', 'cat-tail-long', 'ear-ornament']) {
      await expect(sealTraitBundle({ ...draft, shapeClass }, context)).rejects.toEqual(errorCode('SHAPE_CLASS_NOT_ALLOWED'))
    }
  })

  it('rejects every nested placement or path key', async () => {
    const { context, draft } = await fixture()
    for (const key of ['anchor', 'anchorX', 'anchorY', 'x', 'y', 'offset', 'position', 'transform', 'translate', 'scale', 'rotation', 'crop', 'zIndex', 'layerOrder', 'occluderMask', 'occluderMasks', 'assetPath', 'path', 'url']) {
      await expect(sealTraitBundle({ ...draft, note: { deep: { [key]: 'forbidden' } } }, context))
        .rejects.toEqual(errorCode(['assetPath', 'path', 'url'].includes(key) ? 'RESOURCE_HASH_MISMATCH' : 'NON_IDENTITY_TRANSFORM'))
    }
  })

  it('fails closed on case variants, inherited keys, symbols, instances, and accessors without invoking accessors', async () => {
    const { context, draft } = await fixture()
    for (const key of ['Anchor', 'aNcHoRx', 'PATH', 'Url']) {
      await expect(sealTraitBundle({ ...draft, note: { [key]: 'forbidden' } }, context))
        .rejects.toEqual(errorCode(key.toLowerCase() === 'path' || key.toLowerCase() === 'url' ? 'RESOURCE_HASH_MISMATCH' : 'NON_IDENTITY_TRANSFORM'))
    }
    const inherited = Object.create({ path: 'forbidden' })
    const withInherited = { ...draft, note: inherited }
    const withSymbol = { ...draft, note: { [Symbol('path')]: 'forbidden' } }
    class DraftInstance { readonly note = 'invalid' }
    let calls = 0
    const withAccessor = { ...draft } as Record<string, unknown>
    Object.defineProperty(withAccessor, 'shapeClass', { enumerable: true, get: () => { calls += 1; return calls === 1 ? 'ear-horn-small' : 'collar' } })
    await expect(sealTraitBundle(withInherited, context)).rejects.toEqual(errorCode('TRAIT_SCHEMA_INVALID'))
    await expect(sealTraitBundle(withSymbol, context)).rejects.toEqual(errorCode('TRAIT_SCHEMA_INVALID'))
    await expect(sealTraitBundle({ ...draft, note: new Date('2026-09-09T00:00:00.000Z') }, context)).rejects.toEqual(errorCode('TRAIT_SCHEMA_INVALID'))
    await expect(sealTraitBundle({ ...draft, note: new DraftInstance() }, context)).rejects.toEqual(errorCode('TRAIT_SCHEMA_INVALID'))
    await expect(sealTraitBundle(withAccessor as any, context)).rejects.toEqual(errorCode('TRAIT_SCHEMA_INVALID'))
    expect(calls).toBe(0)
  })

  it('rejects a JSON __proto__ payload before forbidden-key traversal while accepting ordinary metadata', async () => {
    const { context, draft } = await fixture()
    const malicious = { ...draft, note: JSON.parse('{"__proto__":{"Anchor":"forbidden"}}') }

    await expect(sealTraitBundle(malicious, context)).rejects.toEqual(errorCode('TRAIT_SCHEMA_INVALID'))
    await expect(sealTraitBundle({ ...draft, note: { label: 'ordinary metadata' } }, context)).resolves.toMatchObject({ artifact: { kind: 'attachment' } })
  })

  it('uses fixed role order regardless of caller resource insertion order', async () => {
    const { context, draft } = await fixture()
    const reordered = { ...draft, resources: { attachmentFront: draft.resources.attachmentFront, attachmentBehind: draft.resources.attachmentBehind } }
    const first = await sealTraitBundle(draft, context)
    const second = await sealTraitBundle(reordered, context)

    expect(first.artifact.authoringInputs).toEqual([draft.resources.attachmentBehind, draft.resources.attachmentFront])
    expect(second.artifactSha256).toBe(first.artifactSha256)
  })

  it('rejects canonically hashed non-object or ownerless surface material JSON with a stable error', async () => {
    const fixed = await fixture()
    for (const payload of [null, [], 'color', { operation: 'paint' }]) {
      const bytes = Buffer.from(JSON.stringify(payload), 'utf8')
      const digest = canonicalJsonSha256(payload)
      const material = { resourceId: `sha256:${digest}`, sha256: digest, mediaType: 'application/qmonster-material-v1+json' as const }
      const context = { ...fixed.context, resources: new Map(fixed.context.resources).set(material.resourceId, bytes) }
      const draft = { ...fixed.draft, kind: 'surface' as const, slotId: 'bodyColor' as const, resources: { materialOperation: material } }
      await expect(sealTraitBundle(draft, context)).rejects.toEqual(errorCode('RESOURCE_SCHEMA_INVALID'))
    }
  })

  it('rejects missing or extra runtime resource roles for every trait kind', async () => {
    const { context, draft, refs } = await fixture()
    for (const kind of ['surface', 'eyePair', 'mouth', 'oralDetail', 'attachment', 'targetedEffect', 'ambientEffect'] as const) {
      const partial = { ...draft, kind, resources: { only: refs.layer } }
      const extra = { ...draft, kind, resources: { attachmentBehind: refs.layer, attachmentFront: refs.front, extra: refs.layer } }
      await expect(sealTraitBundle(partial, context)).rejects.toEqual(errorCode('RESOURCE_HASH_MISMATCH'))
      await expect(sealTraitBundle(extra, context)).rejects.toEqual(errorCode('RESOURCE_HASH_MISMATCH'))
    }
  })

  it('rejects resource-hash and family/template/neutral mismatches', async () => {
    const { context, draft } = await fixture()
    await expect(sealTraitBundle({ ...draft, skeletonFamilyId: 'other' }, context)).rejects.toEqual(errorCode('ASSEMBLY_TEMPLATE_HASH_MISMATCH'))
    await expect(sealTraitBundle({ ...draft, assemblyTemplateSha256: hash('a') }, context)).rejects.toEqual(errorCode('ASSEMBLY_TEMPLATE_HASH_MISMATCH'))
    await expect(sealTraitBundle({ ...draft, neutralMasterSha256: hash('b') }, context)).rejects.toEqual(errorCode('RESOURCE_HASH_MISMATCH'))
    await expect(sealTraitBundle({ ...draft, resources: { ...draft.resources, attachmentBehind: { ...draft.resources.attachmentBehind, sha256: hash('c') } } }, context)).rejects.toEqual(errorCode('RESOURCE_HASH_MISMATCH'))
  })

  it('binds visual approval to exact family, template, artifact, and decoded preview identity', async () => {
    const { draft, neutral } = await fixture()
    const input = { skeletonFamilyId: 'feline', assemblyTemplateSha256: draft.assemblyTemplateSha256, sealedArtifactSha256: hash('d'), fullContextPreview: draft.fullContextPreview, fullContextPreviewBytes: neutral, approvedBy: 'artist', approvedAt: '2026-09-09T00:00:00.000Z', approvalRevision: 1, status: 'approved' as const }
    const first = await createTraitVisualApproval(input)
    const second = await createTraitVisualApproval(input)

    expect(first.approval.fullContextPreviewSha256).toBe(draft.fullContextPreview.sha256)
    expect(first.approvalSha256).toBe(second.approvalSha256)
  })
})
