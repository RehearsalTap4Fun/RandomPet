import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { V09_COMPOSITION_NODE_IDS, V09_TRAIT_SLOT_IDS } from '@qmonster/generator-core'
import { canonicalJsonBytes, canonicalJsonSha256, decodedPngSha256 } from './v09-content-identity.js'
import { __setV09AssemblyFailureHookForTest, assembleV09Release, validateV09Release, type V09ContentRecordV1, type V09ReleaseCandidate } from './v09-production-validation.js'

type JsonRef = { resourceId: string; sha256: string; mediaType: 'application/qmonster-manifest-v1+json' }
type PngRef = { resourceId: string; sha256: string; mediaType: 'image/png'; width: 2048; height: 2048 }
const graph = { schemaVersion: 'qmonster-composition-graph-v1', orderedNodes: [...V09_COMPOSITION_NODE_IDS], blendMode: 'source-over-premultiplied-srgb', transformPolicy: 'identity-only' }
const jsonRef = (value: unknown): JsonRef => { const sha256 = canonicalJsonSha256(value); return { resourceId: `sha256:${sha256}`, sha256, mediaType: 'application/qmonster-manifest-v1+json' } }

async function fixture(): Promise<V09ReleaseCandidate> {
  const image = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 9, g: 8, b: 7, alpha: 1 } } }).png().toBuffer()
  const digest = await decodedPngSha256(image); const png: PngRef = { resourceId: `sha256:${digest}`, sha256: digest, mediaType: 'image/png', width: 2048, height: 2048 }
  const material = { ownerMaterialId: 'owner' }; const materialRef = jsonRef(material)
  const families = ['base', 'legendary'].map((id, position) => ({ schemaVersion: 'qmonster-skeleton-family-v1', skeletonFamilyId: id, skeletonClass: position === 0 ? 'base' as const : 'legendary' as const, structuralShapeClasses: ['feline-standard'], archetypeId: 'feline', poseId: 'sit', speciesRigId: 'feline-sit-v2', canvas: { width: 2048, height: 2048 }, neutralMaster: png, materialMap: png, fixedOccluderMasks: { fixed: png }, assemblyTemplateId: `template-${id}` }))
  const templates = families.map(family => ({ schemaVersion: 'qmonster-assembly-template-v1', assemblyTemplateId: family.assemblyTemplateId, skeletonFamilyId: family.skeletonFamilyId, canvas: { width: 2048, height: 2048 }, neutralMasterSha256: digest, slots: {
    surface: ['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface'].map(slotId => ({ kind: 'surface' as const, slotId, ownerMaterialId: 'owner', authoringZone: png })),
    embedded: [{ kind: 'eyePair' as const, slotId: 'eyes', leftAuthoringZone: png, rightAuthoringZone: png, pairAuthoringZone: png, occlusionReplayZone: png }, { kind: 'mouth' as const, slotId: 'mouthShape', authoringZone: png, occlusionReplayZone: png }, { kind: 'oralDetail' as const, slotId: 'oralDetail', socketRegistry: { 'oral-none': { authoringZone: png, parentMouthTraitIds: ['mouthShape-common-0'] }, open: { authoringZone: png, parentMouthTraitIds: ['mouthShape-common-0'] } }, closedMouthSentinel: 'oral-none' }],
    attachment: ['headAppendage', 'extraAppendage'].map(slotId => ({ kind: 'attachment' as const, slotId, attachmentInterface: { interfaceId: `${slotId}-interface`, allowedShapeClasses: ['ear-horn-small'] as const, allowedZone: png, rearRootStencil: png, fixedOccluderMaskId: 'fixed' } })), effect: [{ kind: 'ambientEffect' as const, slotId: 'effect', zoneId: 'background' as const, authoringZone: png, compositionNode: 'backgroundEffect' as const }],
  }, compositionGraph: graph }))
  const inventory = { schemaVersion: 'qmonster-trait-inventory-v1' as const, traits: V09_TRAIT_SLOT_IDS.flatMap(slotId => (['common', 'rare', 'legendary'] as const).flatMap((rarity, tier) => Array.from({ length: [8, 4, 1][tier]! }, (_, index) => ({ slotId, traitId: slotId === 'oralDetail' && rarity === 'common' && index === 0 ? 'oral-none' : `${slotId}-${rarity}-${index}`, rarity, ...(slotId === 'oralDetail' ? { oralSocketClass: index === 0 && rarity === 'common' ? 'oral-none' : 'open' } : {}) })))) }
  const sealedTraits = families.flatMap(family => inventory.traits.map(entry => {
    const template = templates.find(item => item.skeletonFamilyId === family.skeletonFamilyId)!; const common = { schemaVersion: 'qmonster-sealed-trait-v1' as const, traitId: entry.traitId, rarity: entry.rarity, skeletonFamilyId: family.skeletonFamilyId, assemblyTemplateId: template.assemblyTemplateId, assemblyTemplateSha256: canonicalJsonSha256(template), neutralMasterSha256: digest, authoringInputs: [png], fullContextPreview: png, sealerVersion: '0.9.0' }
    if (entry.slotId === 'eyes') return { ...common, kind: 'eyePair' as const, slotId: 'eyes' as const, runtimeResources: { underlay: png, content: png } }
    if (entry.slotId === 'mouthShape') return { ...common, kind: 'mouth' as const, slotId: 'mouthShape' as const, oralSocketClass: 'open', runtimeResources: { mouthBack: png, mouthFront: png } }
    if (entry.slotId === 'oralDetail') return { ...common, kind: 'oralDetail' as const, slotId: 'oralDetail' as const, runtimeResources: { oralProjection: png } }
    if (entry.slotId === 'headAppendage' || entry.slotId === 'extraAppendage') return { ...common, kind: 'attachment' as const, slotId: entry.slotId, interfaceId: `${entry.slotId}-interface`, shapeClass: 'ear-horn-small' as const, runtimeResources: { attachmentBehind: png } }
    if (entry.slotId === 'effect') return { ...common, kind: 'ambientEffect' as const, slotId: 'effect' as const, zoneId: 'background' as const, runtimeResources: { effectLayer: png } }
    return { ...common, kind: 'surface' as const, slotId: entry.slotId as 'bodyColor', runtimeResources: { materialOperation: materialRef } }
  }))
  const traitApprovals = sealedTraits.map(artifact => ({ schemaVersion: 'qmonster-trait-visual-approval-v1' as const, skeletonFamilyId: artifact.skeletonFamilyId, assemblyTemplateSha256: artifact.assemblyTemplateSha256, sealedArtifactSha256: canonicalJsonSha256(artifact), fullContextPreviewSha256: digest, approvedBy: 'artist', approvedAt: '2026-09-09T00:00:00.000Z', approvalRevision: 1, status: 'approved' as const }))
  const allowlist = { schemaVersion: 'qmonster-approved-attachment-allowlist-v1' as const, entries: sealedTraits.filter(item => item.kind === 'attachment').map(artifact => ({ skeletonFamilyId: artifact.skeletonFamilyId, interfaceId: artifact.interfaceId, shapeClass: artifact.shapeClass, sealedArtifactSha256: canonicalJsonSha256(artifact), traitVisualApprovalSha256: canonicalJsonSha256(traitApprovals.find(item => item.sealedArtifactSha256 === canonicalJsonSha256(artifact))!) })) }
  const pool = { schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'pool', candidates: [{ skeletonFamilyId: 'base', skeletonClass: 'base' as const, weight: 8 as const }, { skeletonFamilyId: 'legendary', skeletonClass: 'legendary' as const, weight: 1 as const }] }
  const approvals = families.map(family => { const template = templates.find(item => item.skeletonFamilyId === family.skeletonFamilyId)!; return { schemaVersion: 'qmonster-assembly-approval-v1' as const, skeletonFamilyId: family.skeletonFamilyId, assemblyTemplateId: template.assemblyTemplateId, assemblyTemplateSha256: canonicalJsonSha256(template), neutralMasterSha256: digest, materialMapSha256: digest, fixedOccluderMasksSha256: canonicalJsonSha256(family.fixedOccluderMasks), attachmentAllowlistSha256: canonicalJsonSha256(allowlist), compositionGraphSha256: canonicalJsonSha256(graph), overlayPolicySha256: 'a'.repeat(64), approvedBy: 'artist', approvedAt: '2026-09-09T00:00:00.000Z', approvalRevision: 1, status: 'approved' as const } })
  const speciesRig = { speciesRigId: 'feline-sit-v2' }
  const manifest = { schemaVersion: 'qmonster-release-v1', versionTuple: { schemaVersion: '0.4.0', catalogVersion: '0.9.0', generatorVersion: '0.9.0' }, speciesRig: jsonRef(speciesRig), skeletonPool: jsonRef(pool), skeletonFamilies: families.map(jsonRef), assemblyTemplates: templates.map(jsonRef), approvals: approvals.map(jsonRef), traitApprovals: traitApprovals.map(jsonRef), traitInventory: jsonRef(inventory), sealedTraits: sealedTraits.map(jsonRef), compositionGraph: jsonRef(graph), rendererBuildSha256: 'b'.repeat(64) }
  const docs = [speciesRig, pool, ...families, ...templates, ...approvals, ...traitApprovals, allowlist, inventory, ...sealedTraits, graph]
  const resources: V09ContentRecordV1[] = [{ ref: png as any, bytes: image }, { ref: materialRef as any, bytes: canonicalJsonBytes(material) }, ...docs.map(value => ({ ref: jsonRef(value) as any, bytes: canonicalJsonBytes(value) }))]
  return { releaseManifest: manifest, speciesRig, skeletonPool: pool, skeletonFamilies: families, assemblyTemplates: templates, assemblyApprovals: approvals, traitApprovals, attachmentAllowlist: allowlist, traitInventory: inventory, sealedTraits, compositionGraph: graph, resources }
}

describe('v0.9 production validation', () => {
  it('accepts a complete independent 312-projection fixture', async () => { await expect(validateV09Release(await fixture())).resolves.toEqual([]) }, 30000)
  it('rejects frozen-inventory and release-chain mutations', async () => {
    const candidate = await fixture()
    const cases: Array<[unknown, string]> = [
      [{ ...candidate, skeletonPool: { ...candidate.skeletonPool, candidates: candidate.skeletonPool.candidates.slice(0, 1) } }, 'SKELETON_POOL_INVALID'],
      [{ ...candidate, traitInventory: { ...candidate.traitInventory, traits: candidate.traitInventory.traits.slice(1), expectedCounts: { common: 7 } } }, 'RELEASE_CANDIDATE_INVALID'],
      [{ ...candidate, sealedTraits: [...candidate.sealedTraits, candidate.sealedTraits[0]] }, 'SKELETON_PROJECTION_MISSING'],
      [{ ...candidate, traitApprovals: [] }, 'TRAIT_APPROVAL_MISSING'],
      [{ ...candidate, assemblyApprovals: candidate.assemblyApprovals.map(item => ({ ...item, status: 'revoked' })) }, 'ASSEMBLY_TEMPLATE_UNAPPROVED'],
      [{ ...candidate, compositionGraph: { ...graph, orderedNodes: [...graph.orderedNodes].reverse() } }, 'COMPOSITION_GRAPH_MISMATCH'],
      [{ ...candidate, attachmentAllowlist: { ...candidate.attachmentAllowlist, nested: { path: 'outside' } } }, 'RESOURCE_HASH_MISMATCH'],
    ]
    for (const [input, code] of cases) expect((await validateV09Release(input)).some(item => item.code === code)).toBe(true)
  }, 30000)

  it('assembles only immutable resources, manifest, candidate pointer, and audit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-assemble-'))
    const active = join(root, 'releases', 'active-release.json'); const sentinel = Buffer.from('do-not-touch')
    await mkdir(join(root, 'releases'), { recursive: true }); await writeFile(active, sentinel)
    try {
      const candidate = await fixture(); const first = await assembleV09Release({ root, candidate }); const second = await assembleV09Release({ root, candidate })
      expect(second.releaseManifestSha256).toBe(first.releaseManifestSha256)
      expect(await readFile(active)).toEqual(sentinel)
      expect(JSON.parse(await readFile(first.candidatePointerPath, 'utf8'))).toMatchObject({ schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: first.releaseManifestSha256 })
      await expect(readFile(first.auditPath)).resolves.toBeInstanceOf(Buffer)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it('uses the same verified snapshot for assembly instead of rereading the caller candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-toctou-'))
    const good = await fixture(); const bad = { ...good, resources: good.resources.map((resource, index) => index === 0 ? { ...resource, bytes: Buffer.from('tampered') } : resource) }
    let reads = 0
    const options = { root, get candidate() { return reads++ === 0 ? good : bad } } as unknown as { root: string; candidate: unknown }
    try {
      const result = await assembleV09Release(options)
      expect(await readFile(join(root, 'resources', 'by-sha256', good.resources[0]!.ref.sha256))).toEqual(Buffer.from(good.resources[0]!.bytes))
      expect(result.releaseManifestSha256).toBe(canonicalJsonSha256(good.releaseManifest))
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it.each(['resource', 'manifest', 'audit', 'pointer'] as const)('rolls back official output after an injected %s-stage failure', async (stage) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-rollback-')); const active = join(root, 'releases', 'active-release.json'); const sentinel = Buffer.from('active-sentinel')
    await mkdir(join(root, 'releases'), { recursive: true }); await writeFile(active, sentinel)
    __setV09AssemblyFailureHookForTest(async current => { if (current === stage) throw new Error(`fail-${stage}`) })
    try {
      await expect(assembleV09Release({ root, candidate: await fixture() })).rejects.toThrow(`fail-${stage}`)
      expect(await readFile(active)).toEqual(sentinel)
      await expect(readFile(join(root, 'releases', 'candidate-v0.9.0.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { __setV09AssemblyFailureHookForTest(); await rm(root, { recursive: true, force: true }) }
  }, 30000)
})
