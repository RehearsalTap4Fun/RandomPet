import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { V09_COMPOSITION_NODE_IDS, V09_TRAIT_SLOT_IDS } from '@qmonster/generator-core'
import { canonicalJsonBytes, canonicalJsonSha256, decodedPngSha256 } from './v09-content-identity.js'
import { __setV09AssemblyFailureHookForTest, assembleV09Release, validateV09CandidatePointer, validateV09Release, type V09ContentRecordV1, type V09ReleaseCandidate } from './v09-production-validation.js'
import { runV09ValidationCli } from './v09-cli.js'

const ioFault = vi.hoisted(() => ({ role: '', phase: '', fired: false, foreign: false }))
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  const isTarget = (path: unknown) => typeof path === 'string' && (ioFault.role === 'owner' ? /[\\/]\.qmonster-v09-assemble-lock[\\/]owner$/.test(path) : ioFault.role === 'blocker' && /[\\/]\.qmonster-v09-release-gate[\\/][^\\/]+$/.test(path))
  const inject = async (path: string) => {
    ioFault.fired = true
    if (ioFault.foreign) { await fs.rename(path, path + '.foreign-held'); await fs.writeFile(path, 'foreign-replacement') }
    throw new Error('injected-' + ioFault.role + '-' + ioFault.phase)
  }
  return { ...fs,
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      await fs.writeFile(...args)
      if (!ioFault.fired && isTarget(args[0])) await inject(String(args[0]))
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[1] !== 'wx' || !isTarget(args[0])) return handle
      return new Proxy(handle, { get(target, key) {
        const value = Reflect.get(target, key, target)
        if (key === 'writeFile' || key === 'close') return async (...callArgs: unknown[]) => {
          const result = await value.apply(target, callArgs)
          if (!ioFault.fired && (key === 'writeFile' ? ioFault.phase === 'write' : ioFault.phase === 'close')) await inject(String(args[0]))
          return result
        }
        return typeof value === 'function' ? value.bind(target) : value
      } })
    },
  }
})

type JsonRef = { resourceId: string; sha256: string; mediaType: 'application/qmonster-manifest-v1+json' }
type PngRef = { resourceId: string; sha256: string; mediaType: 'image/png'; width: 2048; height: 2048 }
const graph = { schemaVersion: 'qmonster-composition-graph-v1', orderedNodes: [...V09_COMPOSITION_NODE_IDS], blendMode: 'source-over-premultiplied-srgb', transformPolicy: 'identity-only' }
const jsonRef = (value: unknown): JsonRef => { const sha256 = canonicalJsonSha256(value); return { resourceId: `sha256:${sha256}`, sha256, mediaType: 'application/qmonster-manifest-v1+json' } }

async function fixture(materialOverride?: Record<string, unknown>, oralMode?: 'multi' | 'unknown' | 'closed' | 'unreachable' | 'unused' | 'missing-resource'): Promise<V09ReleaseCandidate> {
  const image = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 9, g: 8, b: 7, alpha: 1 } } }).png().toBuffer()
  const digest = await decodedPngSha256(image); const png: PngRef = { resourceId: `sha256:${digest}`, sha256: digest, mediaType: 'image/png', width: 2048, height: 2048 }
  const material = materialOverride ?? { schemaVersion: 'qmonster-material-v1', ownerMaterialId: 'owner', colorLut: Array(1024).fill(128), alphaPolicy: 'preserve-skeleton-alpha', blendMode: 'replace-color' }; const materialRef = { ...jsonRef(material), mediaType: 'application/qmonster-material-v1+json' as const }
  const families = ['base', 'legendary'].map((id, position) => ({ schemaVersion: 'qmonster-skeleton-family-v1', skeletonFamilyId: id, skeletonClass: position === 0 ? 'base' as const : 'legendary' as const, structuralShapeClasses: ['feline-standard'], archetypeId: 'feline', poseId: 'sit', speciesRigId: 'feline-sit-v2', canvas: { width: 2048, height: 2048 }, neutralMaster: png, materialMap: png, fixedOccluderMasks: { fixed: png }, assemblyTemplateId: `template-${id}` }))
  const templates = families.map(family => ({ schemaVersion: 'qmonster-assembly-template-v1', assemblyTemplateId: family.assemblyTemplateId, skeletonFamilyId: family.skeletonFamilyId, canvas: { width: 2048, height: 2048 }, neutralMasterSha256: digest, materialRegistry: { owner: 7 }, slots: {
    surface: ['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface'].map(slotId => ({ kind: 'surface' as const, slotId, ownerMaterialId: 'owner', authoringZone: png })),
    embedded: [{ kind: 'eyePair' as const, slotId: 'eyes', leftAuthoringZone: png, rightAuthoringZone: png, pairAuthoringZone: png, occlusionReplayZone: png }, { kind: 'mouth' as const, slotId: 'mouthShape', authoringZone: png, occlusionReplayZone: png }, { kind: 'oralDetail' as const, slotId: 'oralDetail', socketRegistry: { 'oral-none': { authoringZone: png, parentMouthTraitIds: ['mouthShape-common-0'] }, open: { authoringZone: png, parentMouthTraitIds: ['common', 'rare', 'legendary'].flatMap((rarity, tier) => Array.from({ length: [8, 4, 1][tier]! }, (_, i) => `mouthShape-${rarity}-${i}`)) } }, closedMouthSentinel: 'oral-none' }],
    attachment: ['headAppendage', 'extraAppendage'].map(slotId => ({ kind: 'attachment' as const, slotId, attachmentInterface: { interfaceId: `${slotId}-interface`, allowedShapeClasses: ['ear-horn-small'] as const, allowedZone: png, rearRootStencil: png, fixedOccluderMaskId: 'fixed' } })), effect: [{ kind: 'ambientEffect' as const, slotId: 'effect', zoneId: 'background' as const, authoringZone: png, compositionNode: 'backgroundEffect' as const }],
  }, compositionGraph: graph }))
  const inventory = { schemaVersion: 'qmonster-trait-inventory-v1' as const, traits: V09_TRAIT_SLOT_IDS.flatMap(slotId => (['common', 'rare', 'legendary'] as const).flatMap((rarity, tier) => Array.from({ length: [8, 4, 1][tier]! }, (_, index) => ({ slotId, traitId: `${slotId}-${rarity}-${index}`, rarity, ...(slotId === 'oralDetail' ? { oralSocketClass: 'open' } : {}) })))) }
  if (oralMode !== undefined) for (const template of templates) Object.assign((template.slots.embedded[2] as any).socketRegistry, {
    narrow: { authoringZone: png, parentMouthTraitIds: ['mouthShape-common-1'] },
    wide: { authoringZone: png, parentMouthTraitIds: oralMode === 'unreachable' ? ['missing-mouth'] : ['mouthShape-common-2'] },
  })
  const oralImage = oralMode === undefined ? image : await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 22, g: 33, b: 44, alpha: 1 } } }).png().toBuffer()
  const oralDigest = await decodedPngSha256(oralImage); const oralPng: PngRef = { ...png, sha256: oralDigest, resourceId: `sha256:${oralDigest}` }
  const overlays = templates.map(template => ({ schemaVersion: 'qmonster-overlay-policy-v1', skeletonFamilyId: template.skeletonFamilyId, assemblyTemplateSha256: canonicalJsonSha256(template), fullContextOverlay: png, previewPolicy: 'full-context-identity-only' }))
  const sealedTraits = families.flatMap(family => inventory.traits.map(entry => {
    const template = templates.find(item => item.skeletonFamilyId === family.skeletonFamilyId)!; const common = { schemaVersion: 'qmonster-sealed-trait-v1' as const, traitId: entry.traitId, rarity: entry.rarity, skeletonFamilyId: family.skeletonFamilyId, assemblyTemplateId: template.assemblyTemplateId, assemblyTemplateSha256: canonicalJsonSha256(template), neutralMasterSha256: digest, authoringInputs: [png], fullContextPreview: png, sealerVersion: '0.9.0' }
    common.authoringInputs.push(jsonRef(overlays.find(item => item.skeletonFamilyId === family.skeletonFamilyId)) as any)
    if (entry.slotId === 'eyes') return { ...common, kind: 'eyePair' as const, slotId: 'eyes' as const, runtimeResources: { underlay: png, content: png } }
    if (entry.slotId === 'mouthShape') return { ...common, kind: 'mouth' as const, slotId: 'mouthShape' as const, oralSocketClass: oralMode !== undefined && entry.traitId === 'mouthShape-common-1' ? 'narrow' : oralMode !== undefined && oralMode !== 'unused' && entry.traitId === 'mouthShape-common-2' ? 'wide' : 'open', runtimeResources: { mouthBack: png, mouthFront: png } }
    if (entry.slotId === 'oralDetail') return { ...common, kind: 'oralDetail' as const, slotId: 'oralDetail' as const, runtimeResources: { oralProjections: oralMode === undefined ? { open: png } : { open: png, narrow: png, wide: oralPng, ...(oralMode === 'unknown' ? { unknown: png } : oralMode === 'closed' ? { closed: png } : {}) } } }
    if (entry.slotId === 'headAppendage' || entry.slotId === 'extraAppendage') return { ...common, kind: 'attachment' as const, slotId: entry.slotId, interfaceId: `${entry.slotId}-interface`, shapeClass: 'ear-horn-small' as const, runtimeResources: { attachmentBehind: png } }
    if (entry.slotId === 'effect') return { ...common, kind: 'ambientEffect' as const, slotId: 'effect' as const, zoneId: 'background' as const, runtimeResources: { effectLayer: png } }
    return { ...common, kind: 'surface' as const, slotId: entry.slotId as 'bodyColor', runtimeResources: { materialOperation: materialRef } }
  }))
  const traitApprovals = sealedTraits.map(artifact => ({ schemaVersion: 'qmonster-trait-visual-approval-v1' as const, skeletonFamilyId: artifact.skeletonFamilyId, assemblyTemplateSha256: artifact.assemblyTemplateSha256, sealedArtifactSha256: canonicalJsonSha256(artifact), fullContextPreviewSha256: digest, approvedBy: 'artist', approvedAt: '2026-09-09T00:00:00.000Z', approvalRevision: 1, status: 'approved' as const }))
  const allowlist = { schemaVersion: 'qmonster-approved-attachment-allowlist-v1' as const, entries: sealedTraits.filter(item => item.kind === 'attachment').map(artifact => ({ skeletonFamilyId: artifact.skeletonFamilyId, interfaceId: artifact.interfaceId, shapeClass: artifact.shapeClass, sealedArtifactSha256: canonicalJsonSha256(artifact), traitVisualApprovalSha256: canonicalJsonSha256(traitApprovals.find(item => item.sealedArtifactSha256 === canonicalJsonSha256(artifact))!) })) }
  const pool = { schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'pool', candidates: [{ skeletonFamilyId: 'base', skeletonClass: 'base' as const, weight: 8 as const }, { skeletonFamilyId: 'legendary', skeletonClass: 'legendary' as const, weight: 1 as const }] }
  const approvals = families.map(family => { const template = templates.find(item => item.skeletonFamilyId === family.skeletonFamilyId)!; return { schemaVersion: 'qmonster-assembly-approval-v1' as const, skeletonFamilyId: family.skeletonFamilyId, assemblyTemplateId: template.assemblyTemplateId, assemblyTemplateSha256: canonicalJsonSha256(template), neutralMasterSha256: digest, materialMapSha256: digest, fixedOccluderMasksSha256: canonicalJsonSha256(family.fixedOccluderMasks), attachmentAllowlistSha256: canonicalJsonSha256(allowlist), compositionGraphSha256: canonicalJsonSha256(graph), overlaySha256: canonicalJsonSha256(overlays.find(item => item.skeletonFamilyId === family.skeletonFamilyId)), approvedBy: 'artist', approvedAt: '2026-09-09T00:00:00.000Z', approvalRevision: 1, status: 'approved' as const } })
  const speciesRig = { speciesRigId: 'feline-sit-v2' }
  const manifest = { schemaVersion: 'qmonster-release-v1', versionTuple: { schemaVersion: '0.4.0', catalogVersion: '0.9.0', generatorVersion: '0.9.0' }, speciesRig: jsonRef(speciesRig), skeletonPool: jsonRef(pool), skeletonFamilies: families.map(jsonRef), assemblyTemplates: templates.map(jsonRef), approvals: approvals.map(jsonRef), traitApprovals: traitApprovals.map(jsonRef), traitInventory: jsonRef(inventory), sealedTraits: sealedTraits.map(jsonRef), compositionGraph: jsonRef(graph), rendererBuildSha256: 'b'.repeat(64) }
  const docs = [speciesRig, pool, ...families, ...templates, ...approvals, ...traitApprovals, allowlist, inventory, ...sealedTraits, graph, ...overlays]
  const resources: V09ContentRecordV1[] = [{ ref: png as any, bytes: image }, { ref: materialRef as any, bytes: canonicalJsonBytes(material) }, ...docs.map(value => ({ ref: jsonRef(value) as any, bytes: canonicalJsonBytes(value) }))]
  if (oralMode !== undefined && oralMode !== 'missing-resource') resources.push({ ref: oralPng as any, bytes: oralImage })
  return { releaseManifest: manifest, speciesRig, skeletonPool: pool, skeletonFamilies: families, assemblyTemplates: templates, assemblyApprovals: approvals, traitApprovals, attachmentAllowlist: allowlist, traitInventory: inventory, sealedTraits, compositionGraph: graph, resources }
}

// Rebuild content identities independently so malformed-document tests cannot pass
// merely because changing a document invalidated its old digest.
function recatalog(candidate: V09ReleaseCandidate): V09ReleaseCandidate {
  const c = candidate as any
  c.assemblyApprovals = c.assemblyApprovals.map((item: any) => ({ ...item, attachmentAllowlistSha256: canonicalJsonSha256(c.attachmentAllowlist) }))
  const manifest = { ...c.releaseManifest, speciesRig: jsonRef(c.speciesRig), skeletonPool: jsonRef(c.skeletonPool), skeletonFamilies: c.skeletonFamilies.map(jsonRef), assemblyTemplates: c.assemblyTemplates.map(jsonRef), approvals: c.assemblyApprovals.map(jsonRef), traitApprovals: c.traitApprovals.map(jsonRef), traitInventory: jsonRef(c.traitInventory), sealedTraits: c.sealedTraits.map(jsonRef), compositionGraph: jsonRef(c.compositionGraph) }
  const docs = [c.speciesRig, c.skeletonPool, ...c.skeletonFamilies, ...c.assemblyTemplates, ...c.assemblyApprovals, ...c.traitApprovals, c.attachmentAllowlist, c.traitInventory, ...c.sealedTraits, c.compositionGraph]
  const leaf = candidate.resources.filter(resource => resource.ref.mediaType === 'image/png' || ['qmonster-material-v1', 'qmonster-overlay-policy-v1'].includes(JSON.parse(Buffer.from(resource.bytes).toString()).schemaVersion))
  return { ...candidate, releaseManifest: manifest, resources: [...leaf, ...new Map(docs.map(value => [canonicalJsonSha256(value), { ref: jsonRef(value), bytes: canonicalJsonBytes(value) }])).values()] as V09ContentRecordV1[] }
}

async function publishUnchecked(root: string, candidate: V09ReleaseCandidate): Promise<string> {
  await mkdir(join(root, 'resources', 'by-sha256'), { recursive: true })
  await mkdir(join(root, 'releases', 'by-sha256'), { recursive: true })
  for (const resource of candidate.resources) await writeFile(join(root, 'resources', 'by-sha256', resource.ref.sha256), resource.bytes)
  const digest = canonicalJsonSha256(candidate.releaseManifest)
  await writeFile(join(root, 'releases', 'by-sha256', `${digest}.json`), canonicalJsonBytes(candidate.releaseManifest))
  const pointer = join(root, 'releases', 'candidate-v0.9.0.json')
  await writeFile(pointer, JSON.stringify({ schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: digest }))
  return realpath(pointer)
}

async function files(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(root, join(prefix, entry.name)) : [join(prefix, entry.name)]))).flat().sort()
}

describe('v0.9 round 5 contracts', () => {
  it('validates and reloads multi-socket oral resources through CLI with unchanged 312 projection count', async () => {
    const candidate = await fixture(undefined, 'multi')
    expect(candidate.sealedTraits).toHaveLength(312); expect(candidate.traitInventory.traits).toHaveLength(156)
    expect(await validateV09Release(candidate)).toEqual([])
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-oral-multi-'))
    try { expect(await runV09ValidationCli(['--release-pointer', await publishUnchecked(root, candidate)])).toBe(0) }
    finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)
  it.each(['unknown', 'closed', 'unreachable', 'unused'] as const)('rejects oral projection class %s in validator and CLI', async mode => {
    const candidate = await fixture(undefined, mode)
    expect((await validateV09Release(candidate)).some(item => item.code === 'ORAL_SOCKET_INCOMPATIBLE')).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-oral-invalid-'))
    try { expect(await runV09ValidationCli(['--release-pointer', await publishUnchecked(root, candidate)])).toBe(1) }
    finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)
  it('rejects a missing PNG reachable only through an oral projection record', async () => {
    const candidate = await fixture(undefined, 'missing-resource')
    expect((await validateV09Release(candidate)).some(item => item.code === 'RESOURCE_HASH_MISMATCH')).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-oral-missing-'))
    try { expect(await runV09ValidationCli(['--release-pointer', await publishUnchecked(root, candidate)])).toBe(1) }
    finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)
  it.each(['missing', 'duplicate', 'range', 'fraction', 'blank', 'surface-owner'])('rejects template material registry %s', async mode => {
    const candidate = await fixture(); const template = candidate.assemblyTemplates[0] as any
    if (mode === 'missing') delete template.materialRegistry
    if (mode === 'duplicate') template.materialRegistry.other = 7
    if (mode === 'range') template.materialRegistry.owner = 256
    if (mode === 'fraction') template.materialRegistry.owner = 0.5
    if (mode === 'blank') template.materialRegistry[' '] = 8
    if (mode === 'surface-owner') template.slots.surface[0].ownerMaterialId = 'absent'
    const diagnostics = await validateV09Release(recatalog(candidate))
    expect(diagnostics.some(item => item.code === (mode === 'surface-owner' ? 'SURFACE_OWNER_VIOLATION' : 'SKELETON_PROJECTION_MISSING') && item.path[0] === 'assemblyTemplates')).toBe(true)
  }, 30000)
  it.each([Array(1023).fill(0), Array(1024).fill(0.5), Array(1024).fill(-1), Array(1024).fill(256)])('rejects non-RGBA8 LUT %#', async colorLut => {
    const candidate = await fixture({ schemaVersion: 'qmonster-material-v1', ownerMaterialId: 'owner', colorLut, alphaPolicy: 'preserve-skeleton-alpha', blendMode: 'replace-color' })
    expect((await validateV09Release(candidate)).some(item => item.code === 'RESOURCE_HASH_MISMATCH')).toBe(true)
  }, 30000)
  it.each(['owner-write', 'owner-close', 'blocker-write', 'blocker-close'])('cleans partial %s initialization and permits the next assembler', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-partial-lock-')); const candidate = await fixture()
    Object.assign(ioFault, { role: mode.split('-')[0], phase: mode.split('-')[1], fired: false, foreign: false })
    try {
      const error = await assembleV09Release({ root, candidate }).catch(error => error)
      expect(ioFault.fired).toBe(true)
      expect(error).toBeInstanceOf(Error)
      expect((await readdir(root)).filter(name => name.startsWith('.qmonster-v09-staging-') || name.startsWith('.qmonster-v09-assemble-lock'))).toEqual([])
      expect(await readdir(join(root, '.qmonster-v09-release-gate'))).toEqual([])
      Object.assign(ioFault, { role: '' })
      await expect(assembleV09Release({ root, candidate })).resolves.toHaveProperty('releaseManifestSha256')
    } finally { Object.assign(ioFault, { role: '', phase: '', fired: false, foreign: false }); await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it.each(['owner', 'blocker'])('preserves foreign replacement during %s initialization cleanup', async role => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-partial-foreign-')); const candidate = await fixture()
    Object.assign(ioFault, { role, phase: 'close', fired: false, foreign: true })
    try {
      await expect(assembleV09Release({ root, candidate })).rejects.toBeInstanceOf(Error)
      expect(ioFault.fired).toBe(true)
      const names = await files(root); const path = names.find(name => role === 'owner' ? name.endsWith('owner') : name.startsWith('.qmonster-v09-release-gate') && !name.endsWith('.foreign-held'))!
      expect(await readFile(join(root, path), 'utf8')).toBe('foreign-replacement')
    } finally { Object.assign(ioFault, { role: '', phase: '', fired: false, foreign: false }); await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it('accepts the real finite colorLut material in the complete 312 fixture', async () => {
    expect(await validateV09Release(await fixture())).toEqual([])
  }, 30000)

  it.each(['missing-schema', 'missing-alpha', 'missing-blend', 'extra', 'policy', 'blend', 'empty-owner', 'no-color', 'empty-lut', 'huge-lut', 'nonfinite-lut', 'bad-color-ref'])('rejects strict material %s through validator and CLI', async mode => {
    const material: any = { schemaVersion: 'qmonster-material-v1', ownerMaterialId: 'owner', colorLut: Array(1024).fill(128), alphaPolicy: 'preserve-skeleton-alpha', blendMode: 'replace-color' }
    if (mode === 'missing-schema') delete material.schemaVersion
    if (mode === 'missing-alpha') delete material.alphaPolicy
    if (mode === 'missing-blend') delete material.blendMode
    if (mode === 'extra') material.extra = true
    if (mode === 'policy') material.alphaPolicy = 'replace-alpha'
    if (mode === 'blend') material.blendMode = 'arbitrary'
    if (mode === 'empty-owner') material.ownerMaterialId = ''
    if (mode === 'no-color') delete material.colorLut
    if (mode === 'empty-lut') material.colorLut = []
    if (mode === 'huge-lut') material.colorLut = Array(1025).fill(0)
    // JSON exponent overflow parses to Infinity while remaining valid JSON.
    if (mode === 'nonfinite-lut') material.colorLut = [null]
    if (mode === 'bad-color-ref') material.colorMap = { resourceId: 'bad' }
    const candidate = await fixture(material)
    if (mode === 'nonfinite-lut') candidate.resources[1]!.bytes = Buffer.from(Buffer.from(candidate.resources[1]!.bytes).toString().replace('[null]', '[1e999]'))
    expect((await validateV09Release(candidate)).some(item => item.code === 'RESOURCE_HASH_MISMATCH')).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-material-'))
    try { expect(await runV09ValidationCli(['--release-pointer', await publishUnchecked(root, candidate)])).toBe(1) }
    finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it('resolves a PNG reachable only inside material colorMap and rejects its tampering in validator and CLI', async () => {
    const image = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 77, g: 22, b: 1, alpha: 1 } } }).png().toBuffer()
    const sha256 = await decodedPngSha256(image)
    const png: PngRef = { resourceId: `sha256:${sha256}`, sha256, mediaType: 'image/png', width: 2048, height: 2048 }
    const candidate = await fixture({ schemaVersion: 'qmonster-material-v1', ownerMaterialId: 'owner', colorMap: png, alphaPolicy: 'preserve-skeleton-alpha', blendMode: 'multiply' })
    candidate.resources.push({ ref: png, bytes: image })
    expect(await validateV09Release(candidate)).toEqual([])
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-material-png-'))
    try {
      const pointer = await publishUnchecked(root, candidate)
      expect(await runV09ValidationCli(['--release-pointer', pointer])).toBe(0)
      candidate.resources.at(-1)!.bytes = Buffer.from('tampered')
      expect((await validateV09Release(candidate)).some(item => item.code === 'RESOURCE_HASH_MISMATCH')).toBe(true)
      await writeFile(join(root, 'resources', 'by-sha256', sha256), 'tampered')
      expect(await runV09ValidationCli(['--release-pointer', pointer])).toBe(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it.each(['missing', 'random', 'cross-wire', 'alias', 'missing-source', 'unreferenced-source', 'missing-resource', 'tampered-source'])('rejects overlay %s binding with the same diagnostic in validator and CLI', async mode => {
    let c = await fixture() as any
    if (mode === 'missing') delete c.assemblyApprovals[0].overlaySha256
    if (mode === 'random') c.assemblyApprovals[0].overlaySha256 = 'f'.repeat(64)
    if (mode === 'cross-wire') c.assemblyApprovals[0].overlaySha256 = c.assemblyApprovals[1].overlaySha256
    if (mode === 'alias') { c.assemblyApprovals[0].overlayPolicySha256 = c.assemblyApprovals[0].overlaySha256; delete c.assemblyApprovals[0].overlaySha256 }
    if (mode === 'unreferenced-source' || mode === 'missing-source') for (const trait of c.sealedTraits) trait.authoringInputs = trait.authoringInputs.filter((ref: any) => ref.sha256 !== c.assemblyApprovals[0].overlaySha256)
    if (mode === 'missing-source') c.resources = c.resources.filter((resource: any) => resource.ref.sha256 !== c.assemblyApprovals[0].overlaySha256)
    c = recatalog(c)
    if (mode === 'missing-resource') c.resources = c.resources.filter((resource: any) => resource.ref.sha256 !== c.assemblyApprovals[0].overlaySha256)
    if (mode === 'tampered-source') { const resource = c.resources.find((resource: any) => resource.ref.sha256 === c.assemblyApprovals[0].overlaySha256); const policy = JSON.parse(Buffer.from(resource.bytes).toString()); policy.previewPolicy = 'different-policy'; resource.bytes = canonicalJsonBytes(policy) }
    expect((await validateV09Release(c)).some(item => item.code === 'ASSEMBLY_TEMPLATE_HASH_MISMATCH')).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-overlay-'))
    try { const pointer = await publishUnchecked(root, c); expect((await validateV09CandidatePointer({ root: await realpath(root), releasePointer: pointer })).some(item => item.code === 'ASSEMBLY_TEMPLATE_HASH_MISMATCH')).toBe(true) }
    finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)
})

describe('v0.9 round 4 boundaries', () => {
  it.each([
    ['ninth-common', 'RARITY_INVENTORY_MISMATCH'], ['duplicate-semantic', 'RARITY_INVENTORY_MISMATCH'],
    ['wrong-template', 'SKELETON_PROJECTION_MISSING'], ['missing-assembly', 'ASSEMBLY_TEMPLATE_UNAPPROVED'],
    ['fish-tail', 'SHAPE_CLASS_NOT_ALLOWED'], ['multi-head', 'SHAPE_CLASS_NOT_ALLOWED'], ['detached-limb', 'SHAPE_CLASS_NOT_ALLOWED'], ['dog-tail-curled', 'SHAPE_CLASS_NOT_ALLOWED'],
    ['missing-eye-role', 'TRAIT_SCHEMA_INVALID'], ['missing-mouth-role', 'TRAIT_SCHEMA_INVALID'], ['missing-attachment-role', 'TRAIT_SCHEMA_INVALID'],
    ['missing-fixed-mask', 'SKELETON_PROJECTION_MISSING'], ['surface-owner', 'SURFACE_OWNER_VIOLATION'], ['resource-orphan', 'RESOURCE_HASH_MISMATCH'],
  ])('retains the full-validator invariant for %s', async (mode, code) => {
    const c = await fixture() as any
    if (mode === 'ninth-common' || mode === 'duplicate-semantic') { const eye = c.traitInventory.traits.find((item: any) => item.traitId === 'eyes-common-0'); c.traitInventory.traits.push({ ...eye, traitId: mode === 'ninth-common' ? 'ninth-eye' : eye.traitId }) }
    if (mode === 'wrong-template') c.sealedTraits[0].assemblyTemplateId = 'other-template'
    if (mode === 'missing-assembly') c.assemblyApprovals = []
    if (['fish-tail', 'multi-head', 'detached-limb', 'dog-tail-curled'].includes(mode!)) c.sealedTraits.find((item: any) => item.kind === 'attachment').shapeClass = mode
    if (mode === 'missing-eye-role') delete c.sealedTraits.find((item: any) => item.kind === 'eyePair').runtimeResources.underlay
    if (mode === 'missing-mouth-role') delete c.sealedTraits.find((item: any) => item.kind === 'mouth').runtimeResources.mouthFront
    if (mode === 'missing-attachment-role') delete c.sealedTraits.find((item: any) => item.kind === 'attachment').runtimeResources.attachmentBehind
    if (mode === 'missing-fixed-mask') c.skeletonFamilies[0].fixedOccluderMasks = {}
    if (mode === 'surface-owner') c.assemblyTemplates[0].slots.surface[0].ownerMaterialId = 'foreign-owner'
    if (mode === 'resource-orphan') { const doc = { orphan: true }; c.resources.push({ ref: jsonRef(doc), bytes: canonicalJsonBytes(doc) }) }
    expect((await validateV09Release(c)).some(item => item.code === code)).toBe(true)
  }, 30000)
  it('returns diagnostics rather than throwing for null sealed documents', async () => {
    const candidate = await fixture(); candidate.sealedTraits[0] = null
    await expect(validateV09Release(candidate)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error' })]))
  }, 30000)

  it('reports conflicting canonical refs instead of allowing the last occurrence to overwrite the first', async () => {
    const c = await fixture() as any
    c.releaseManifest.speciesRig = { ...c.releaseManifest.speciesRig, mediaType: 'application/qmonster-material-v1+json' }
    c.sealedTraits[0].authoringInputs.push(jsonRef(c.speciesRig))
    expect((await validateV09Release(c)).some(item => item.message.includes('Conflicting canonical refs'))).toBe(true)
  }, 30000)

  it('rejects a mouth projection that cannot reach its declared template socket', async () => {
    const c = await fixture() as any
    c.sealedTraits.find((item: any) => item.kind === 'mouth').oralSocketClass = 'nonexistent'
    expect((await validateV09Release(recatalog(c))).some(item => item.code === 'ORAL_SOCKET_INCOMPATIBLE')).toBe(true)
  }, 30000)

  it('rejects conflicting preexisting immutable bytes without overwriting or leaving partial output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-conflict-')); const candidate = await fixture()
    await mkdir(join(root, 'resources', 'by-sha256'), { recursive: true })
    const target = join(root, 'resources', 'by-sha256', candidate.resources[1]!.ref.sha256)
    await writeFile(target, 'preexisting-conflict')
    try { await expect(assembleV09Release({ root, candidate })).rejects.toMatchObject({ code: 'IMMUTABLE_CONTENT_CONFLICT' }); expect(await files(root)).toEqual([join('resources', 'by-sha256', candidate.resources[1]!.ref.sha256)]); expect(await readFile(target, 'utf8')).toBe('preexisting-conflict') }
    finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)
  it('executes the real CLI entrypoint and returns nonzero for an invalid supplied pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-cli-process-'))
    try {
      const candidate = await fixture(); const pointer = await publishUnchecked(root, candidate)
      const command = [ '--import', 'tsx', 'packages/asset-catalog/src/v09-cli.ts', '--release-pointer', pointer ]
      await expect(promisify(execFile)(process.execPath, command)).resolves.toMatchObject({ stderr: '' })
      await rm(join(root, 'resources', 'by-sha256', candidate.resources[0]!.ref.sha256))
      await expect(promisify(execFile)(process.execPath, command)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('RESOURCE_HASH_MISMATCH') })
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it.each(['root', 'pointer-parent', 'manifest-parent', 'resource-parent'] as const)('rejects a junction in the %s trusted read chain', async location => {
    const temp = await mkdtemp(join(tmpdir(), 'qmonster-v09-read-link-')); const root = join(temp, 'catalog')
    try {
      const pointer = await publishUnchecked(root, await fixture())
      let releasePointer = pointer; let catalogRoot = await realpath(root)
      const original = location === 'root' ? catalogRoot : location === 'pointer-parent' ? join(catalogRoot, 'releases') : location === 'manifest-parent' ? join(catalogRoot, 'releases', 'by-sha256') : join(catalogRoot, 'resources', 'by-sha256')
      const moved = join(temp, 'moved'); await rename(original, moved); await symlink(moved, original, 'junction')
      if (location === 'root') { catalogRoot = root; releasePointer = join(root, 'releases', 'candidate-v0.9.0.json') }
      expect((await validateV09CandidatePointer({ root: catalogRoot, releasePointer })).some(item => item.code === 'RESOURCE_OUTSIDE_CATALOG_ROOT')).toBe(true)
    } finally { await rm(temp, { recursive: true, force: true }) }
  }, 30000)

  it.each(['staging-create', 'resource', 'manifest', 'audit', 'pointer', 'restore'] as const)('cleans every owned output and retains preexisting bytes after %s failure', async failing => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-all-rollback-')); const candidate = await fixture()
    const manifestHash = canonicalJsonSha256(candidate.releaseManifest)
    const resource = join(root, 'resources', 'by-sha256', candidate.resources[0]!.ref.sha256)
    const pointer = join(root, 'releases', 'candidate-v0.9.0.json'); const active = join(root, 'releases', 'active-release.json'); const audit = join(root, 'audit', 'v0.9.0', `release-${manifestHash}.json`)
    await mkdir(join(root, 'resources', 'by-sha256'), { recursive: true }); await mkdir(join(root, 'releases'), { recursive: true }); await mkdir(join(root, 'audit', 'v0.9.0'), { recursive: true })
    await writeFile(resource, candidate.resources[0]!.bytes); await writeFile(pointer, 'prior-candidate'); await writeFile(active, 'active-sentinel'); await writeFile(audit, 'prior-audit')
    const before = await files(root); let resources = 0; let restoreFailures = 0
    __setV09AssemblyFailureHookForTest(stage => {
      if (stage === 'resource' && ++resources < 2) return
      if (failing === 'restore') {
        if (stage === 'pointer') throw new Error('original-publication-failure')
        if (stage === 'restore' && restoreFailures++ === 0) throw new Error('transient-restore-failure')
      } else if (stage === failing) throw new Error('original-publication-failure')
    })
    try {
      const error = await assembleV09Release({ root, candidate }).catch(error => error)
      expect(error.message).toBe('original-publication-failure')
      if (failing === 'restore') expect(error.rollbackDiagnostics.join(' ')).toContain('transient-restore-failure')
      expect(await files(root)).toEqual(before)
      expect((await readdir(root)).filter(name => name.startsWith('.qmonster-v09-staging-') || name.startsWith('.qmonster-v09-assemble-lock'))).toEqual([])
      expect(await readFile(pointer, 'utf8')).toBe('prior-candidate'); expect(await readFile(audit, 'utf8')).toBe('prior-audit'); expect(await readFile(active, 'utf8')).toBe('active-sentinel'); expect(await readFile(resource)).toEqual(Buffer.from(candidate.resources[0]!.bytes))
    } finally { __setV09AssemblyFailureHookForTest(); await rm(root, { recursive: true, force: true }) }
  }, 30000)
  it.each(['missing', 'tampered-json', 'tampered-png', 'seven-eyes', 'revoked', 'allowlist'] as const)('CLI rejects a canonically addressed %s release', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-cli-'))
    try {
      let candidate = await fixture()
      if (mode === 'seven-eyes') candidate.traitInventory.traits = candidate.traitInventory.traits.filter(item => item.traitId !== 'eyes-common-0')
      if (mode === 'revoked') candidate.traitApprovals[0]!.status = 'revoked'
      if (mode === 'allowlist') (candidate.attachmentAllowlist.entries[0] as any).unexpected = true
      candidate = recatalog(candidate)
      const pointer = await publishUnchecked(root, candidate)
      if (mode === 'missing') await rm(join(root, 'resources', 'by-sha256', candidate.resources[0]!.ref.sha256))
      if (mode.startsWith('tampered')) await writeFile(join(root, 'resources', 'by-sha256', candidate.resources[mode === 'tampered-json' ? 1 : 0]!.ref.sha256), 'tampered')
      expect(await runV09ValidationCli(['--release-pointer', pointer])).toBe(1)
      expect((await files(root)).some(path => path.endsWith('active-release.json'))).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it('CLI fully validates the successful 312-projection release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-cli-good-'))
    try { const result = await assembleV09Release({ root, candidate: await fixture() }); expect(await runV09ValidationCli(['--release-pointer', result.candidatePointerPath])).toBe(0) }
    finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it.each(['approvedAt', 'allowlist-duplicate', 'allowlist-orphan', 'allowlist-malformed', 'trait-orphan', 'assembly-orphan', 'family-extra', 'pool-extra', 'template-extra', 'inventory-type'] as const)('strictly rejects %s with schema/relational diagnostics', async mode => {
    const c = await fixture() as any
    if (mode === 'approvedAt') c.traitApprovals[0].approvedAt = '2026-02-30T00:00:00Z'
    if (mode === 'allowlist-duplicate') c.attachmentAllowlist.entries.push({ ...c.attachmentAllowlist.entries[0] })
    if (mode === 'allowlist-orphan') c.attachmentAllowlist.entries.push({ ...c.attachmentAllowlist.entries[0], sealedArtifactSha256: 'f'.repeat(64) })
    if (mode === 'allowlist-malformed') c.attachmentAllowlist.entries[0].unknown = true
    if (mode === 'trait-orphan') c.traitApprovals.push({ ...c.traitApprovals[0], sealedArtifactSha256: 'f'.repeat(64) })
    if (mode === 'assembly-orphan') c.assemblyApprovals.push({ ...c.assemblyApprovals[0], skeletonFamilyId: 'orphan' })
    if (mode === 'family-extra') c.skeletonFamilies[0].unrecognized = true
    if (mode === 'pool-extra') c.skeletonPool.unrecognized = true
    if (mode === 'template-extra') c.assemblyTemplates[0].slots.surface[0].unrecognized = true
    if (mode === 'inventory-type') c.traitInventory.traits[0].oralSocketClass = 17
    const diagnostics = await validateV09Release(recatalog(c))
    const prefix = mode.startsWith('allowlist') ? 'attachmentAllowlist' : mode === 'approvedAt' || mode === 'trait-orphan' ? 'traitApprovals' : mode === 'assembly-orphan' ? 'assemblyApprovals' : mode === 'family-extra' ? 'skeletonFamilies' : mode === 'pool-extra' ? 'skeletonPool' : mode === 'template-extra' ? 'assemblyTemplates' : 'traitInventory'
    expect(diagnostics.some(item => item.path[0] === prefix && item.code !== 'RESOURCE_HASH_MISMATCH')).toBe(true)
  }, 30000)

  it('stages every final byte before creating any official output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-staging-')); const candidate = await fixture(); let checked = false
    __setV09AssemblyFailureHookForTest(async stage => {
      if (String(stage) !== 'staged') return
      checked = true
      const paths = await files(root)
      expect(paths.filter(path => path.includes('.qmonster-v09-staging-')).length).toBe(candidate.resources.length + 3)
      expect(paths.some(path => /^(resources|releases|audit)[\\/]/.test(path))).toBe(false)
      throw new Error('staged-failure')
    })
    try { await expect(assembleV09Release({ root, candidate })).rejects.toThrow('staged-failure'); expect(checked).toBe(true); expect(await files(root)).toEqual([]) }
    finally { __setV09AssemblyFailureHookForTest(); await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it('rollback preserves a replacement immutable file and candidate pointer owned by another writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-owner-')); const candidate = await fixture()
    const resource = join(root, 'resources', 'by-sha256', candidate.resources[0]!.ref.sha256); const pointer = join(root, 'releases', 'candidate-v0.9.0.json')
    __setV09AssemblyFailureHookForTest(async stage => {
      if (stage !== 'pointer') return
      await rm(resource); await writeFile(resource, 'new-owner-resource')
      await rm(pointer); await writeFile(pointer, 'new-owner-pointer')
      throw new Error('original-failure')
    })
    try { await expect(assembleV09Release({ root, candidate })).rejects.toThrow('original-failure'); expect(await readFile(resource, 'utf8')).toBe('new-owner-resource'); expect(await readFile(pointer, 'utf8')).toBe('new-owner-pointer') }
    finally { __setV09AssemblyFailureHookForTest(); await rm(root, { recursive: true, force: true }) }
  }, 30000)

  it('release protects a replacement lock owner across the check-to-rename gap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-lock-handoff-')); const candidate = await fixture(); let replaced = false
    const payload = join(root, 'candidate-input.json'); await writeFile(payload, JSON.stringify(candidate, (_key, value) => value instanceof Uint8Array ? Array.from(value) : value))
    __setV09AssemblyFailureHookForTest(async stage => {
      if (stage === 'lock-after-move') {
        const source = pathToFileURL(join(process.cwd(), 'packages/asset-catalog/src/v09-production-validation.ts')).href
        const code = `import { readFile } from 'node:fs/promises'; import { assembleV09Release } from ${JSON.stringify(source)}; const c = JSON.parse(await readFile(${JSON.stringify(payload)}, 'utf8')); c.resources = c.resources.map(r => ({...r, bytes: Buffer.from(r.bytes.data ?? r.bytes)})); try { await assembleV09Release({ root: ${JSON.stringify(root)}, candidate:c }); process.exitCode = 9; } catch(e) { if(e.code !== 'V09_ASSEMBLY_LOCKED') throw e; }`
        await expect(promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code])).resolves.toMatchObject({ stderr: '' })
        return
      }
      if (stage !== 'lock-before-move') return
      replaced = true
      const lock = join(root, '.qmonster-v09-assemble-lock')
      await rename(lock, join(root, 'old-owner-lock'))
      await mkdir(lock); await writeFile(join(lock, 'owner'), 'replacement-owner')
    })
    try {
      await assembleV09Release({ root, candidate }); expect(replaced).toBe(true)
      expect(await readFile(join(root, '.qmonster-v09-assemble-lock', 'owner'), 'utf8')).toBe('replacement-owner')
      await expect(assembleV09Release({ root, candidate })).rejects.toMatchObject({ code: 'V09_ASSEMBLY_LOCKED' })
    } finally { __setV09AssemblyFailureHookForTest(); await rm(root, { recursive: true, force: true }) }
  }, 30000)
})

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

  it('fails a concurrent assembler closed while the root lock is owned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-lock-')); const candidate = await fixture()
    let unblock!: () => void; const held = new Promise<void>(resolve => { unblock = resolve })
    __setV09AssemblyFailureHookForTest(async stage => { if (stage === 'resource') await held })
    try {
      const first = assembleV09Release({ root, candidate })
      await new Promise(resolve => setTimeout(resolve, 20))
      await expect(assembleV09Release({ root, candidate })).rejects.toMatchObject({ code: 'V09_ASSEMBLY_LOCKED' })
      unblock(); await expect(first).resolves.toMatchObject({ releaseManifestSha256: expect.any(String) })
    } finally { __setV09AssemblyFailureHookForTest(); await rm(root, { recursive: true, force: true }) }
  }, 30000)
})
