import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { canonicalJsonBytes, canonicalJsonSha256, decodedPngSha256 } from './v09-content-identity.js'
import * as publicAssetCatalog from './index.js'
import { __setV09StableReadHookForTest, loadActiveV09Release, resolveV09Resource } from './v09-release-loader.js'

type JsonRef = { resourceId: string; sha256: string; mediaType: 'application/qmonster-manifest-v1+json' }
type PngRef = { resourceId: string; sha256: string; mediaType: 'image/png'; width: 2048; height: 2048 }

const compositionGraph = {
  schemaVersion: 'qmonster-composition-graph-v1',
  orderedNodes: [
    'backgroundEffect', 'attachment.behind', 'skeleton.base', 'surface.bodyColor', 'surface.pattern', 'surface.texture',
    'surface.forepawDetail', 'surface.hindpawDetail', 'surface.tailSurface', 'targetedEffect.underlay', 'eyePair.underlay',
    'eyePair.content', 'eyePair.edgeOcclusionReplay', 'mouth.back', 'oralDetail', 'mouth.front', 'mouth.edgeOcclusionReplay',
    'attachment.front', 'skeleton.attachmentOcclusionReplay', 'targetedEffect.overlay', 'foregroundAmbientEffect',
  ],
  blendMode: 'source-over-premultiplied-srgb',
  transformPolicy: 'identity-only',
}

function asJsonRef(value: unknown): JsonRef {
  const sha256 = canonicalJsonSha256(value)
  return { resourceId: `sha256:${sha256}`, sha256, mediaType: 'application/qmonster-manifest-v1+json' }
}

async function createRelease(options: {
  pool?: unknown
  versionTuple?: unknown
  skeletonFamilyIds?: string[]
  templateFamilyIds?: string[]
  familyProjection?: 'complete' | 'missing'
  speciesRigValue?: unknown
  approvalValue?: unknown
  inventoryValue?: unknown
  templateGraph?: unknown
  attachmentMaskId?: string
  materialRegistry?: unknown
  omitMaterialRegistry?: boolean
  surfaceOwner?: string
  oralMode?: 'multi' | 'empty' | 'legacy' | 'sentinel'
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-release-'))
  const resources = join(root, 'resources', 'by-sha256')
  await mkdir(resources, { recursive: true })
  const addJson = async (value: unknown): Promise<JsonRef> => {
    const ref = asJsonRef(value)
    await writeFile(join(resources, ref.sha256), canonicalJsonBytes(value))
    return ref
  }
  const pngBytes = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer()
  const pngSha256 = await decodedPngSha256(pngBytes)
  await writeFile(join(resources, pngSha256), pngBytes)
  const png: PngRef = { resourceId: `sha256:${pngSha256}`, sha256: pngSha256, mediaType: 'image/png', width: 2048, height: 2048 }
  const oralBytes = options.oralMode === undefined ? undefined : await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 80, g: 70, b: 60, alpha: 1 } } }).png().toBuffer()
  const oralSha256 = oralBytes === undefined ? undefined : await decodedPngSha256(oralBytes)
  if (oralBytes && oralSha256) await writeFile(join(resources, oralSha256), oralBytes)
  const oralPng = { ...png, resourceId: `sha256:${oralSha256}`, sha256: oralSha256 }
  const template = (skeletonFamilyId: string) => ({
    schemaVersion: 'qmonster-assembly-template-v1',
    assemblyTemplateId: `template-${skeletonFamilyId}`,
    skeletonFamilyId,
    canvas: { width: 2048, height: 2048 },
    neutralMasterSha256: pngSha256,
    ...(options.omitMaterialRegistry ? {} : { materialRegistry: options.materialRegistry ?? { fur: 7 } }),
    slots: {
      surface: options.surfaceOwner === undefined ? [] : [{ kind: 'surface', slotId: 'bodyColor', ownerMaterialId: options.surfaceOwner, authoringZone: png }], embedded: [],
      attachment: options.attachmentMaskId === undefined ? [] : [{
        kind: 'attachment', slotId: 'headAppendage',
        attachmentInterface: {
          interfaceId: 'test-interface', allowedShapeClasses: ['ear-horn-small'], allowedZone: png,
          rearRootStencil: png, fixedOccluderMaskId: options.attachmentMaskId,
        },
      }],
      effect: [],
    },
    compositionGraph: options.templateGraph ?? compositionGraph,
  })
  const family = (skeletonFamilyId: string, skeletonClass: 'base' | 'legendary') => ({
    schemaVersion: 'qmonster-skeleton-family-v1',
    skeletonFamilyId,
    skeletonClass,
    structuralShapeClasses: ['feline-standard'],
    archetypeId: 'feline',
    poseId: 'sit',
    speciesRigId: 'feline-sit-v2',
    canvas: { width: 2048, height: 2048 },
    ...(options.familyProjection === 'missing' ? {} : { neutralMaster: png, materialMap: png }),
    fixedOccluderMasks: {},
    assemblyTemplateId: `template-${skeletonFamilyId}`,
  })
  const familyIds = options.skeletonFamilyIds ?? ['base', 'legendary']
  const templateIds = options.templateFamilyIds ?? ['base', 'legendary']
  const skeletonFamilies = await Promise.all(familyIds.map((id) => addJson(family(id, id === 'base' ? 'base' : 'legendary'))))
  const assemblyTemplates = await Promise.all(templateIds.map(id => addJson(template(id))))
  const defaultPool = {
    schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'default',
    candidates: [
      { skeletonFamilyId: 'base', skeletonClass: 'base', weight: 8 },
      { skeletonFamilyId: 'legendary', skeletonClass: 'legendary', weight: 1 },
    ],
  }
  const approval = await addJson(options.approvalValue ?? { approvalId: 'approved' })
  const traitApproval = await addJson({ traitApprovalId: 'approved' })
  const oralTrait = options.oralMode === undefined ? undefined : await addJson({
    schemaVersion: 'qmonster-sealed-trait-v1', kind: 'oralDetail', slotId: 'oralDetail', traitId: options.oralMode === 'sentinel' ? 'oral-none' : 'teeth', rarity: 'common', skeletonFamilyId: 'base', assemblyTemplateId: 'template-base',
    assemblyTemplateSha256: assemblyTemplates[0]!.sha256, neutralMasterSha256: pngSha256, authoringInputs: [png], fullContextPreview: png, sealerVersion: '0.9.0',
    runtimeResources: options.oralMode === 'legacy' ? { oralProjection: png } : { oralProjections: options.oralMode === 'empty' ? {} : { narrow: png, wide: oralPng } },
  })
  const manifest = {
    schemaVersion: 'qmonster-release-v1',
    versionTuple: options.versionTuple ?? { schemaVersion: '0.4.0', catalogVersion: '0.9.0', generatorVersion: '0.9.0' },
    speciesRig: await addJson(options.speciesRigValue ?? { speciesRigId: 'feline-sit-v2' }),
    skeletonPool: await addJson(options.pool ?? defaultPool),
    skeletonFamilies,
    assemblyTemplates,
    approvals: [approval], traitApprovals: [traitApproval], traitInventory: await addJson(options.inventoryValue ?? { inventory: [] }), sealedTraits: oralTrait ? [oralTrait] : [],
    compositionGraph: await addJson(compositionGraph),
    rendererBuildSha256: 'a'.repeat(64),
  }
  const manifestSha256 = canonicalJsonSha256(manifest)
  await mkdir(join(root, 'releases', 'by-sha256'), { recursive: true })
  await writeFile(join(root, 'releases', 'by-sha256', `${manifestSha256}.json`), canonicalJsonBytes(manifest))
  await writeFile(join(root, 'releases', 'active-release.json'), JSON.stringify({ schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: manifestSha256 }))
  return { root, resources, manifest, manifestSha256, pngSha256, oralSha256 }
}

async function withRelease(test: (release: Awaited<ReturnType<typeof createRelease>>) => Promise<void>, options?: Parameters<typeof createRelease>[0]) {
  const release = await createRelease(options)
  try {
    await test(release)
  } finally {
    await rm(release.root, { recursive: true, force: true })
  }
}

describe('active v0.9 release loader', () => {
  it('rejects a content-addressed release containing an ordinary oral-none artifact', async () => {
    await withRelease(async ({ root }) => {
      await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'RESOURCE_SCHEMA_INVALID' })
    }, { oralMode: 'sentinel' })
  })
  it('loads every socket-indexed oral ref and rejects tampered nested projection bytes', async () => {
    const release = await createRelease({ oralMode: 'multi' })
    try {
      const loaded = await loadActiveV09Release({ root: release.root }); const trait = loaded.sealedTraits[0]!
      expect(trait.kind).toBe('oralDetail')
      if (trait.kind !== 'oralDetail') throw new Error('Expected oral trait')
      expect(Object.keys(trait.runtimeResources.oralProjections)).toEqual(['narrow', 'wide'])
      await writeFile(join(release.resources, release.oralSha256!), await readFile(join(release.resources, release.pngSha256)))
      await expect(loadActiveV09Release({ root: release.root })).rejects.toMatchObject({ code: 'RESOURCE_HASH_MISMATCH' })
    } finally { await rm(release.root, { recursive: true, force: true }) }
  })
  it.each(['empty', 'legacy'] as const)('rejects %s oral projection shape during loading', async oralMode => {
    const release = await createRelease({ oralMode })
    try { await expect(loadActiveV09Release({ root: release.root })).rejects.toMatchObject({ code: 'RESOURCE_SCHEMA_INVALID' }) }
    finally { await rm(release.root, { recursive: true, force: true }) }
  })
  it.each([
    { omitMaterialRegistry: true }, { materialRegistry: { fur: 7, nose: 7 } },
    { materialRegistry: { fur: 256 } }, { materialRegistry: { fur: 7.5 } },
    { materialRegistry: { ' ': 7 } }, { surfaceOwner: 'undeclared' },
  ])('rejects invalid material registry %#', async options => {
    const release = await createRelease(options)
    try { await expect(loadActiveV09Release({ root: release.root })).rejects.toMatchObject({ code: 'SKELETON_PROJECTION_MISSING' }) }
    finally { await rm(release.root, { recursive: true, force: true }) }
  })
  it('does not expose the stable-read test seam through the public package barrel', () => {
    expect(publicAssetCatalog).not.toHaveProperty('__setV09StableReadHookForTest')
  })

  it('rejects raw traversal, absolute, URL, UNC, and malformed content identities', async () => {
    await withRelease(async ({ root }) => {
      for (const id of ['../outside', '/tmp/outside', 'C:\\outside', 'https://example.test/a', '\\\\server\\share\\file', 'sha256:ABC']) {
        await expect(resolveV09Resource(root, id)).rejects.toMatchObject({ code: 'RESOURCE_OUTSIDE_CATALOG_ROOT' })
      }
    })
  })

  it('rejects a symlink resource escape before returning the target', async ({ skip }) => {
    await withRelease(async ({ root, resources }) => {
      const outside = join(dirname(root), 'qmonster-v09-outside.json')
      const bytes = canonicalJsonBytes({ outside: true })
      const sha256 = canonicalJsonSha256({ outside: true })
      await writeFile(outside, bytes)
      try {
        try {
          await symlink(outside, join(resources, sha256), 'file')
        } catch (error) {
          if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            skip('symlink creation is unavailable on this host')
            return
          }
          throw error
        }
        await expect(resolveV09Resource(root, `sha256:${sha256}`)).rejects.toMatchObject({ code: 'RESOURCE_OUTSIDE_CATALOG_ROOT' })
      } finally {
        await rm(outside, { force: true })
      }
    })
  })

  it('rejects a linked intermediate resource directory without rebinding the catalog root', async ({ skip }) => {
    await withRelease(async ({ root, resources }) => {
      const heldResources = join(root, 'held-resources')
      await rename(resources, heldResources)
      try {
        try {
          await symlink(heldResources, resources, process.platform === 'win32' ? 'junction' : 'dir')
        } catch (error) {
          if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            skip('directory links are unavailable on this host')
            return
          }
          throw error
        }
        await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'RESOURCE_OUTSIDE_CATALOG_ROOT' })
      } finally {
        await rm(resources, { recursive: true, force: true })
        await rename(heldResources, resources)
      }
    })
  })

  it('rejects a release when the root is replaced for the opened handle then restored', async ({ skip }) => {
    await withRelease(async ({ root }) => {
      const original = join(dirname(root), `${basename(root)}-original`)
      const external = join(dirname(root), `${basename(root)}-external`)
      let rootMoved = false
      try {
        await cp(root, external, { recursive: true })
        __setV09StableReadHookForTest(async (stage) => {
          if (stage === 'afterPrecheck') {
            await rename(root, original)
            rootMoved = true
            await symlink(external, root, process.platform === 'win32' ? 'junction' : 'dir')
          }
          if (stage === 'afterOpen' && rootMoved) {
            await rm(root, { recursive: true, force: true })
            await rename(original, root)
            rootMoved = false
          }
        })
        await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'RESOURCE_OUTSIDE_CATALOG_ROOT' })
      } catch (error) {
        if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          skip('directory links are unavailable on this host')
          return
        }
        throw error
      } finally {
        __setV09StableReadHookForTest()
        if (rootMoved) {
          await rm(root, { recursive: true, force: true })
          await rename(original, root)
        }
        await rm(external, { recursive: true, force: true })
      }
    })
  })

  it('retries a legitimately atomically replaced active pointer without accepting the first handle bytes', async () => {
    await withRelease(async ({ root, manifest }) => {
      const nextManifest = { ...manifest, rendererBuildSha256: 'b'.repeat(64) }
      const nextSha256 = canonicalJsonSha256(nextManifest)
      const pointer = join(root, 'releases', 'active-release.json')
      const replacement = join(root, 'releases', 'next-active-release.json')
      let replaced = false
      try {
        await writeFile(join(root, 'releases', 'by-sha256', `${nextSha256}.json`), canonicalJsonBytes(nextManifest))
        __setV09StableReadHookForTest(async (stage) => {
          if (stage === 'afterPrecheck' && !replaced) {
            replaced = true
            await writeFile(replacement, JSON.stringify({ schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: nextSha256 }))
            await rename(replacement, pointer)
          }
        })
        await expect(loadActiveV09Release({ root })).resolves.toMatchObject({ releaseManifestSha256: nextSha256 })
      } finally {
        __setV09StableReadHookForTest()
        await rm(replacement, { force: true })
      }
    })
  })

  it('rejects a malformed active pointer', async () => {
    await withRelease(async ({ root }) => {
      await writeFile(join(root, 'releases', 'active-release.json'), '{"schemaVersion":"wrong"}')
      await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'RELEASE_MANIFEST_SCHEMA_INVALID' })
    })
  })

  it('rejects a manifest whose bytes do not match the active pointer digest', async () => {
    await withRelease(async ({ root, manifestSha256 }) => {
      await writeFile(join(root, 'releases', 'by-sha256', `${manifestSha256}.json`), '{"altered":true}')
      await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'RELEASE_MANIFEST_HASH_MISMATCH' })
    })
  })

  it('rejects a referenced resource whose bytes do not match its declared digest', async () => {
    await withRelease(async ({ root, resources, manifest }) => {
      await writeFile(join(resources, manifest.speciesRig.sha256), canonicalJsonBytes({ altered: true }))
      await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'RESOURCE_HASH_MISMATCH' })
    })
  })

  it('verifies approval resources even though the resolved catalog does not expose them', async () => {
    await withRelease(async ({ root, resources, manifest }) => {
      await writeFile(join(resources, manifest.approvals[0].sha256), canonicalJsonBytes({ alteredApproval: true }))
      await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'RESOURCE_HASH_MISMATCH' })
    })
  })

  it('fails closed when nested species rig, approval, or inventory objects resemble invalid resource refs', async () => {
    const digest = 'b'.repeat(64)
    for (const options of [
      { speciesRigValue: { nested: { resourceId: `sha256:${digest}`, sha256: digest, mediaType: 'application/unknown' } } },
      { approvalValue: { nested: { resourceId: `sha256:${digest}`, sha256: digest, mediaType: 'application/qmonster-manifest-v1+json', unexpected: true } } },
      { inventoryValue: { nested: { resourceId: `sha256:${digest}`, mediaType: 'application/qmonster-manifest-v1+json' } } },
    ]) {
      await withRelease(async ({ root }) => {
        await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'RESOURCE_SCHEMA_INVALID' })
      }, options)
    }
  })

  it('preserves the version-tuple failure code', async () => {
    await withRelease(async ({ root }) => {
      await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'VERSION_TUPLE_MISMATCH' })
    }, { versionTuple: { schemaVersion: '0.4.0', catalogVersion: '0.9.0', generatorVersion: 'wrong' } })
  })

  it('rejects an empty or malformed skeleton pool', async () => {
    for (const pool of [
      { schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'empty', candidates: [] },
      { schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'wrong', candidates: [{ skeletonFamilyId: 'base', skeletonClass: 'base', weight: 9 }] },
    ]) {
      await withRelease(async ({ root }) => {
        await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'SKELETON_POOL_INVALID' })
      }, { pool })
    }
  })

  it('rejects missing pool family, owned template, or required skeleton projection', async () => {
    for (const options of [
      { skeletonFamilyIds: ['base'] },
      { templateFamilyIds: ['base'] },
      { familyProjection: 'missing' as const },
    ]) {
      await withRelease(async ({ root }) => {
        await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'SKELETON_PROJECTION_MISSING' })
      }, options)
    }
  })

  it('rejects an assembly template whose composition graph differs from the declared release graph', async () => {
    await withRelease(async ({ root }) => {
      await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'SKELETON_PROJECTION_MISSING' })
    }, { templateGraph: { ...compositionGraph, orderedNodes: ['skeleton.base'] } })
  })

  it('rejects an attachment template that names no fixed occluder mask on its family', async () => {
    await withRelease(async ({ root }) => {
      await expect(loadActiveV09Release({ root })).rejects.toMatchObject({ code: 'SKELETON_PROJECTION_MISSING' })
    }, { attachmentMaskId: 'missing-mask' })
  })

  it('returns a complete, verified v0.9 catalog only after the entire release is loaded', async () => {
    await withRelease(async ({ root, manifestSha256 }) => {
      await expect(loadActiveV09Release({ root })).resolves.toMatchObject({
        releaseManifestSha256: manifestSha256,
        skeletonPool: { candidates: [{ skeletonClass: 'base', weight: 8 }, { skeletonClass: 'legendary', weight: 1 }] },
        skeletonFamilies: [{ skeletonFamilyId: 'base' }, { skeletonFamilyId: 'legendary' }],
        assemblyTemplates: [{ assemblyTemplateId: 'template-base' }, { assemblyTemplateId: 'template-legendary' }],
        sealedTraits: [],
        compositionGraph,
      })
    })
  })
})
