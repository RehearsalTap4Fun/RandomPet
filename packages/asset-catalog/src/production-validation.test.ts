import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { makeCompositionCatalogFixture, makeInterfaceCatalogFixture, makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import type { Catalog } from '@qmonster/generator-core'
import type { InterfaceSourceManifest } from './interface-source-schema.js'
import sharp from 'sharp'
import { buildProductionEvidenceManifest } from './evidence-root.js'
import { loadCatalog } from './load-catalog.js'
import {
  validateNoStaleRuntimeAssets,
  validateBridgeSplitAlpha,
  validateProductionInterfaceResources,
  validateProductionHeadFaceSocketContract,
  validateProductionMetadata,
  validateProductionSourceIndex,
  validateProductionSplitFiles,
} from './production-validation.js'

const temporaryDirectories: string[] = []
const execFile = promisify(execFileCallback)

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function makeProductionCliFixture(): Promise<{
  root: string
  catalogDirectory: string
  sourceIndex: Record<string, any>
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'qmonster-production-cli-')))
  temporaryDirectories.push(root)
  const catalogDirectory = join(root, 'catalog', 'v0.1.0')
  await mkdir(catalogDirectory, { recursive: true })
  const committedDirectory = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0')
  for (const file of ['catalog.json', 'themes.json', 'rigs.json', 'parts.json', 'semantic-traits.json', 'modifiers.json']) {
    await writeFile(join(catalogDirectory, file), await readFile(join(committedDirectory, file)))
  }
  const sourceIndex = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
  await writeFile(join(root, 'source-index.json'), `${JSON.stringify(sourceIndex)}\n`)
  const auditDirectory = join(root, 'audit', 'v0.1.0')
  await mkdir(auditDirectory, { recursive: true })
  await writeFile(
    join(auditDirectory, 'evidence-manifest.json'),
    await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'audit', 'v0.1.0', 'evidence-manifest.json')),
  )
  return { root, catalogDirectory, sourceIndex }
}

async function writeSourceIndexAndAnchor(root: string, sourceIndex: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, 'source-index.json'), `${JSON.stringify(sourceIndex)}\n`)
  await writeFile(
    join(root, 'audit', 'v0.1.0', 'evidence-manifest.json'),
    `${JSON.stringify(buildProductionEvidenceManifest(sourceIndex))}\n`,
  )
}

async function createSyntheticSourceRichRoot(
  sourceIndex: Record<string, unknown>,
  root: string,
): Promise<string> {
  const sourceRoot = join(root, 'source-rich-root')
  const prefix = 'asset-source/v0.1.0/'
  const hashFields: Record<string, string> = {
    promptPath: 'promptSha256',
    sheetPath: 'sheetSha256',
    masterPath: 'masterSha256',
    sourcePath: 'sourceSha256',
    processedPath: 'processedSha256',
    sourceSheetPath: 'sourceSheetSha256',
    outputPath: 'outputSha256',
  }
  const contents = new Map<string, Buffer>()

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value === null || typeof value !== 'object') return
    const owner = value as Record<string, unknown>
    for (const [pathField, hashField] of Object.entries(hashFields)) {
      const portablePath = owner[pathField]
      if (typeof portablePath !== 'string' || !portablePath.startsWith(prefix)) continue
      const bytes = pathField === 'promptPath'
        ? Buffer.from(`${String(owner.prompt)}\n`)
        : Buffer.from(`deterministic source-rich fixture: ${portablePath}`)
      const prior = contents.get(portablePath)
      if (prior !== undefined && !prior.equals(bytes)) throw new Error(`Conflicting synthetic content for ${portablePath}.`)
      contents.set(portablePath, bytes)
      owner[hashField] = createHash('sha256').update(
        pathField === 'promptPath' ? String(owner.prompt) : bytes,
      ).digest('hex')
    }
    Object.values(owner).forEach(visit)
  }
  visit(sourceIndex)

  for (const [portablePath, bytes] of contents) {
    const target = join(sourceRoot, portablePath.slice(prefix.length))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  return sourceRoot
}

describe('strict production catalog validation', () => {
  it('applies retained interface production validation to the derived v0.4 release', async () => {
    const catalog = JSON.parse(await readFile(
      join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.4.0', 'catalog.json'),
      'utf8',
    )) as Catalog
    const sourceIndex = JSON.parse(await readFile(
      join(process.cwd(), 'packages', 'asset-catalog', 'source-index-v0.4.0.json'),
      'utf8',
    ))
    const assetRoot = join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.4.0')
    const manifestPath = join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json')

    const diagnostics = [
      ...validateProductionMetadata(catalog),
      ...await validateProductionSourceIndex(catalog, assetRoot, sourceIndex),
      ...await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex, { manifestPath }),
      ...await validateNoStaleRuntimeAssets(catalog, assetRoot, sourceIndex),
    ]

    expect(diagnostics).toEqual([])
  })

  it('rejects a v0.4 face-zone change without its exact overlay provenance', async () => {
    const catalog = JSON.parse(await readFile(
      join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.4.0', 'catalog.json'),
      'utf8',
    )) as Catalog
    const sourceIndex = JSON.parse(await readFile(
      join(process.cwd(), 'packages', 'asset-catalog', 'source-index-v0.4.0.json'),
      'utf8',
    ))
    const head = catalog.parts.find(part => part.id === 'head_shadow_hood')
    if (head?.composition?.mode !== 'interface') throw new Error('Expected exact v0.4 interface head.')
    head.composition.variantsByRig.floating!.faceSafeZones = [{ x: 800, y: 1050, width: 448, height: 326 }]
    delete sourceIndex.sources.find((source: { sourceId: string }) => (
      source.sourceId === 'head_shadow_hood:floating'
    )).interfaceMetadataOverlay

    const diagnostics = await validateProductionInterfaceResources(
      catalog,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.4.0'),
      sourceIndex,
      { manifestPath: join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json') },
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_V04_INTERFACE_OVERLAY_INVALID',
      path: ['sources', 'head_shadow_hood:floating', 'interfaceMetadataOverlay'],
    }))
  })

  it('rejects a forged v0.4 release review before CLI production acceptance', async () => {
    const catalog = JSON.parse(await readFile(
      join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.4.0', 'catalog.json'),
      'utf8',
    )) as Catalog
    const sourceIndex = JSON.parse(await readFile(
      join(process.cwd(), 'packages', 'asset-catalog', 'source-index-v0.4.0.json'),
      'utf8',
    ))
    const review = JSON.parse(await readFile(
      join(process.cwd(), 'packages', 'asset-catalog', 'review', 'v0.4.0', 'review-record.json'),
      'utf8',
    )) as Record<string, any>
    review.schemaVersion = 'forged-review-schema'
    review.basedOnCatalogVersion = '9.9.9'
    review.replacementPartIds = []
    review.replacementHashes.surface_soft_scales.pngSha256 = '0'.repeat(64)
    review.interfaceFaceZone.faceSafeZones[0].height = 325
    review.interfaceMaskHashes = {
      foregroundMaskSha256: '0'.repeat(64),
      backgroundMaskSha256: '0'.repeat(64),
    }
    review.evidenceManifestPath = 'packages/asset-catalog/audit/v0.4.0/forged.json'
    review.evidenceManifestSha256 = '0'.repeat(64)

    const diagnostics = await validateProductionInterfaceResources(
      catalog,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.4.0'),
      sourceIndex,
      {
        manifestPath: join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json'),
        v04Review: review,
        v04EvidenceManifestSha256: createHash('sha256').update(await readFile(
          join(process.cwd(), 'packages', 'asset-catalog', 'audit', 'v0.4.0', 'evidence-manifest.json'),
        )).digest('hex'),
      },
    )

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PRODUCTION_V04_REVIEW_INVALID', path: ['review', 'schemaVersion'] }),
      expect.objectContaining({ code: 'PRODUCTION_V04_REVIEW_INVALID', path: ['review', 'basedOnCatalogVersion'] }),
      expect.objectContaining({ code: 'PRODUCTION_V04_REVIEW_INVALID', path: ['review', 'replacementPartIds'] }),
      expect.objectContaining({ code: 'PRODUCTION_V04_REVIEW_INVALID', path: ['review', 'replacementHashes', 'surface_soft_scales'] }),
      expect.objectContaining({ code: 'PRODUCTION_V04_REVIEW_INVALID', path: ['review', 'interfaceFaceZone'] }),
      expect.objectContaining({ code: 'PRODUCTION_V04_REVIEW_INVALID', path: ['review', 'interfaceMaskHashes'] }),
      expect.objectContaining({ code: 'PRODUCTION_V04_REVIEW_INVALID', path: ['review', 'evidenceManifestPath'] }),
      expect.objectContaining({ code: 'PRODUCTION_V04_REVIEW_INVALID', path: ['review', 'evidenceManifestSha256'] }),
    ]))
  })

  async function faceSocketContractFixture(): Promise<{
    catalog: Catalog
    manifest: InterfaceSourceManifest
  }> {
    return {
      catalog: JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json'), 'utf8')) as Catalog,
      manifest: JSON.parse(await readFile(join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json'), 'utf8')) as InterfaceSourceManifest,
    }
  }

  it.each(['runtime-only', 'manifest-only', 'both'] as const)(
    'rejects %s corruption of the head face-socket contract',
    async corruption => {
      const { catalog, manifest } = await faceSocketContractFixture()
      const runtimeHead = catalog.parts.find(part => part.slotId === 'headShape')!
      if (runtimeHead.composition?.mode !== 'interface') throw new Error('Expected runtime interface head.')
      const runtimeVariant = Object.values(runtimeHead.composition.variantsByRig)[0]!
      const manifestHead = manifest.assets.find(asset => asset.slotId === 'headShape')!
      const manifestVariant = 'variants' in manifestHead ? manifestHead.variants[0]! : manifestHead
      if (corruption !== 'manifest-only') runtimeVariant.featureSockets!.eyes!.y = 0
      if (corruption !== 'runtime-only') manifestVariant.featureSockets!.eyes!.y = 0

      const diagnostics = validateProductionHeadFaceSocketContract(catalog, manifest)

      if (corruption !== 'manifest-only') {
        expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_FACE_SOCKET_INVALID' }))
      }
      if (corruption !== 'runtime-only') {
        expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_MANIFEST_FACE_SOCKET_INVALID' }))
      }
      expect(diagnostics.some(item => item.severity === 'error')).toBe(true)
    },
  )

  it('rejects production split reads through an escaping parent junction before accepting outside JSON', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-production-read-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-production-read-outside-'))
    temporaryDirectories.push(root, outside)
    const catalog = makeValidCatalogFixture()
    for (const [name, value] of [
      ['themes.json', catalog.themes], ['rigs.json', catalog.rigs], ['parts.json', catalog.parts],
      ['semantic-traits.json', catalog.semanticTraits], ['modifiers.json', catalog.modifiers],
    ] as const) await writeFile(join(outside, name), `${JSON.stringify(value)}\n`)
    try {
      await symlink(outside, join(root, 'catalog'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) skip('directory links unavailable')
      throw error
    }

    const diagnostics = await validateProductionSplitFiles(catalog, join(root, 'catalog'))
    expect(diagnostics.filter(item => item.code === 'PRODUCTION_SPLIT_MISSING')).toHaveLength(5)
  })

  it('rejects production split hardlinks so an external alias cannot change validated bytes', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-production-hardlink-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-production-hardlink-outside-'))
    temporaryDirectories.push(root, outside)
    await mkdir(join(root, 'catalog'))
    const catalog = makeValidCatalogFixture()
    for (const [name, value] of [
      ['themes.json', catalog.themes], ['rigs.json', catalog.rigs], ['parts.json', catalog.parts],
      ['semantic-traits.json', catalog.semanticTraits], ['modifiers.json', catalog.modifiers],
    ] as const) {
      const outsidePath = join(outside, name)
      await writeFile(outsidePath, `${JSON.stringify(value)}\n`)
      try { await link(outsidePath, join(root, 'catalog', name)) } catch (error) {
        if (['EPERM', 'EACCES', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) skip('hardlinks unavailable')
        throw error
      }
    }

    const diagnostics = await validateProductionSplitFiles(catalog, join(root, 'catalog'))
    expect(diagnostics.filter(item => item.code === 'PRODUCTION_SPLIT_MISSING')).toHaveLength(5)
  })

  it('accepts a possibly empty bridge split layer only when the pair exactly partitions neutral alpha', () => {
    const transparent = 0
    const opaque = 255
    expect(validateBridgeSplitAlpha(
      Uint8Array.from([opaque, opaque, transparent]),
      Uint8Array.from([transparent, transparent, transparent]),
      Uint8Array.from([opaque, opaque, transparent]),
    )).toEqual([])
    expect(validateBridgeSplitAlpha(
      Uint8Array.from([opaque, opaque, transparent]),
      Uint8Array.from([opaque, transparent, transparent]),
      Uint8Array.from([opaque, opaque, transparent]),
    )).toContain('overlap')
    expect(validateBridgeSplitAlpha(
      Uint8Array.from([opaque, opaque, transparent]),
      Uint8Array.from([opaque, transparent, transparent]),
      Uint8Array.from([transparent, transparent, transparent]),
    )).toContain('union-mismatch')
  })

  it('validates v0.3 connector and bridge hashes from real committed bytes plus review provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-production-'))
    temporaryDirectories.push(root)
    const assetRoot = join(root, 'assets', 'v0.3.0')
    const catalog = makeInterfaceCatalogFixture()
    const body = catalog.parts.find(part => part.slotId === 'bodyFrame' && !part.composition?.isNone)!
    catalog.parts = [body]
    if (body.composition?.mode !== 'interface') throw new Error('expected interface body')
    const variant = body.composition.variantsByRig.biped!
    variant.connectors = [variant.connectors.find(connector => connector.id === 'neck')!]
    variant.renderNodes = variant.renderNodes.slice(0, 1)
    body.composition.variantsByRig = { biped: variant }
    body.assetSha256 = 'a'.repeat(64)
    body.pngPath = `parts/${body.id}.png`
    body.pngSha256 = 'b'.repeat(64)
    variant.renderNodes[0]!.assetPath = `assets/v0.3.0/nodes/${body.id}_0.webp`
    variant.renderNodes[0]!.pngPath = `assets/v0.3.0/nodes/${body.id}_0.png`
    for (const [path, format] of [[variant.renderNodes[0]!.assetPath, 'webp'], [variant.renderNodes[0]!.pngPath, 'png']] as const) {
      const target = join(assetRoot, path.replace(/^assets\/v0\.3\.0\//u, ''))
      await mkdir(dirname(target), { recursive: true })
      const image = sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="32" height="48" fill="red"/></svg>'))
      if (format === 'webp') await image.webp({ lossless: true }).toFile(target)
      else await image.png().toFile(target)
      if (format === 'webp') variant.renderNodes[0]!.assetSha256 = createHash('sha256').update(await readFile(target)).digest('hex')
      else variant.renderNodes[0]!.pngSha256 = createHash('sha256').update(await readFile(target)).digest('hex')
    }
    const bridge = catalog.transitionBridges!.find(item => item.rigId === 'biped' && item.connectorClass === 'neck')!
    catalog.transitionBridges = [bridge]
    const claims = [
      [variant.connectors[0]!.contourMaskPath, 'contourMaskSha256'],
      [variant.connectors[0]!.foregroundMaskPath, 'foregroundMaskSha256'],
      [variant.connectors[0]!.backgroundMaskPath, 'backgroundMaskSha256'],
      [bridge.neutralPngPath, 'neutralPngSha256'],
      [bridge.neutralAssetPath, 'neutralAssetSha256'],
      [bridge.frontMaskPath, 'frontMaskSha256'],
      [bridge.backMaskPath, 'backMaskSha256'],
    ] as const
    for (const [originalPath, hashField] of claims) {
      const runtimePath = originalPath.replace(/^assets\/v0\.3\.0\//u, '')
      if (hashField.startsWith('neutral') || hashField === 'frontMaskSha256' || hashField === 'backMaskSha256') {
        const pathField = hashField === 'neutralPngSha256' ? 'neutralPngPath'
          : hashField === 'neutralAssetSha256' ? 'neutralAssetPath'
            : hashField === 'frontMaskSha256' ? 'frontMaskPath' : 'backMaskPath'
        ;(bridge as any)[pathField] = originalPath
      } else {
        const pathField = hashField === 'contourMaskSha256' ? 'contourMaskPath'
          : hashField === 'foregroundMaskSha256' ? 'foregroundMaskPath' : 'backgroundMaskPath'
        ;(variant.connectors[0] as any)[pathField] = originalPath
      }
      const target = join(assetRoot, runtimePath)
      await mkdir(dirname(target), { recursive: true })
      const isBridgeResource = hashField.startsWith('neutral') || hashField === 'frontMaskSha256' || hashField === 'backMaskSha256'
      const image = isBridgeResource
        ? sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256"><rect width="256" height="256" fill="white"/></svg>'))
        : sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048"><rect width="1024" height="2048" fill="white"/></svg>'))
      if (runtimePath.endsWith('.webp')) await image.webp({ lossless: true }).toFile(target)
      else await image.png().toFile(target)
      ;((hashField.startsWith('neutral') || hashField === 'frontMaskSha256' || hashField === 'backMaskSha256') ? bridge : variant.connectors[0] as any)[hashField] = createHash('sha256').update(await readFile(target)).digest('hex')
    }
    const reviewBytes = Buffer.from('{"status":"approved"}\n')
    const reviewPath = join(root, 'review', 'v0.3.0', 'review-record.json')
    await mkdir(dirname(reviewPath), { recursive: true })
    await writeFile(reviewPath, reviewBytes)
    const sourceIndex = {
      catalogVersion: '0.3.0',
      sources: [{
        sourceId: `${body.id}:biped`,
        kind: 'interface-structural',
        sourcePngPath: `asset-source/v0.3.0/production/${body.id}.png`,
        sourcePngSha256: '1'.repeat(64),
        sourceResources: [
          { path: `asset-source/v0.3.0/production/${body.id}.png`, sha256: '1'.repeat(64) },
          { path: `asset-source/v0.3.0/production/nodes/${body.id}/body.png`, sha256: '4'.repeat(64) },
        ],
        promptPath: 'asset-source/v0.3.0/prompts/structural-prompts.json',
        promptSha256: '2'.repeat(64),
        promptId: body.id,
        prompt: 'biped structural prompt',
        reviewRecordPath: 'packages/asset-catalog/review/v0.3.0/review-record.json',
        reviewRecordSha256: createHash('sha256').update(reviewBytes).digest('hex'),
        runtimeResources: [
          { path: variant.renderNodes[0]!.assetPath, sha256: variant.renderNodes[0]!.assetSha256 },
          { path: variant.renderNodes[0]!.pngPath, sha256: variant.renderNodes[0]!.pngSha256 },
          { path: variant.connectors[0]!.contourMaskPath, sha256: variant.connectors[0]!.contourMaskSha256 },
          { path: variant.connectors[0]!.foregroundMaskPath, sha256: variant.connectors[0]!.foregroundMaskSha256 },
          { path: variant.connectors[0]!.backgroundMaskPath, sha256: variant.connectors[0]!.backgroundMaskSha256 },
        ].filter((item, index, values) => typeof item.path === 'string' && values.findIndex(candidate => candidate.path === item.path) === index),
      }, {
        sourceId: bridge.id,
        kind: 'interface-bridge',
        sourcePngPath: 'asset-source/v0.3.0/production/bridges/neck.png',
        sourcePngSha256: '3'.repeat(64),
        sourceResources: [{ path: 'asset-source/v0.3.0/production/bridges/neck.png', sha256: '3'.repeat(64) }],
        promptPath: 'asset-source/v0.3.0/prompts/structural-prompts.json',
        promptSha256: '2'.repeat(64),
        promptId: 'bridge-neck',
        prompt: 'biped bridge prompt',
        reviewRecordPath: 'packages/asset-catalog/review/v0.3.0/review-record.json',
        reviewRecordSha256: createHash('sha256').update(reviewBytes).digest('hex'),
        runtimeResources: [
          { path: bridge.neutralAssetPath, sha256: bridge.neutralAssetSha256 },
          { path: bridge.neutralPngPath, sha256: bridge.neutralPngSha256 },
          { path: bridge.frontMaskPath, sha256: bridge.frontMaskSha256 },
          { path: bridge.backMaskPath, sha256: bridge.backMaskSha256 },
        ],
      }],
    }

    const baseline = await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex)
    expect(baseline).toEqual([expect.objectContaining({ code: 'PRODUCTION_INTERFACE_MANIFEST_MISSING' })])
    const nodePng = join(assetRoot, variant.renderNodes[0]!.pngPath!.replace(/^assets\/v0\.3\.0\//u, ''))
    const originalNodePng = await readFile(nodePng)
    await rm(nodePng)
    expect(await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex)).toContainEqual(expect.objectContaining({ code: 'ASSET_FILE_MISSING' }))
    await writeFile(nodePng, Buffer.from('corrupt'))
    expect(await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex)).toContainEqual(expect.objectContaining({ code: 'ASSET_IMAGE_INVALID' }))
    const renamedWebp = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#ff000080' } }).webp({ lossless: true }).toBuffer()
    await writeFile(nodePng, renamedWebp)
    variant.renderNodes[0]!.pngSha256 = createHash('sha256').update(renamedWebp).digest('hex')
    sourceIndex.sources[0].runtimeResources.find(resource => resource.path === variant.renderNodes[0]!.pngPath)!.sha256 = variant.renderNodes[0]!.pngSha256
    expect(await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex)).toContainEqual(expect.objectContaining({ code: 'ASSET_FORMAT_MISMATCH' }))
    await writeFile(nodePng, originalNodePng)
    variant.renderNodes[0]!.pngSha256 = createHash('sha256').update(originalNodePng).digest('hex')
    sourceIndex.sources[0].runtimeResources.find(resource => resource.path === variant.renderNodes[0]!.pngPath)!.sha256 = variant.renderNodes[0]!.pngSha256
    const wrongEncodingCases = [
      { owner: variant.connectors[0] as any, pathField: 'contourMaskPath', hashField: 'contourMaskSha256', source: sourceIndex.sources[0], format: 'webp' },
      { owner: bridge as any, pathField: 'frontMaskPath', hashField: 'frontMaskSha256', source: sourceIndex.sources[1], format: 'webp' },
      { owner: bridge as any, pathField: 'neutralAssetPath', hashField: 'neutralAssetSha256', source: sourceIndex.sources[1], format: 'png' },
    ] as const
    for (const mismatch of wrongEncodingCases) {
      const portablePath = mismatch.owner[mismatch.pathField] as string
      const target = join(assetRoot, portablePath.replace(/^assets\/v0\.3\.0\//u, ''))
      const originalBytes = await readFile(target)
      const wrongBytes = mismatch.format === 'webp'
        ? await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#ffffff80' } }).webp({ lossless: true }).toBuffer()
        : await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#ffffff80' } }).png().toBuffer()
      await writeFile(target, wrongBytes)
      mismatch.owner[mismatch.hashField] = createHash('sha256').update(wrongBytes).digest('hex')
      mismatch.source.runtimeResources.find(resource => resource.path === portablePath)!.sha256 = mismatch.owner[mismatch.hashField]
      expect(await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex)).toContainEqual(expect.objectContaining({ code: 'ASSET_FORMAT_MISMATCH' }))
      await writeFile(target, originalBytes)
      mismatch.owner[mismatch.hashField] = createHash('sha256').update(originalBytes).digest('hex')
      mismatch.source.runtimeResources.find(resource => resource.path === portablePath)!.sha256 = mismatch.owner[mismatch.hashField]
    }
    const antialiasedMask = sharp(Buffer.from([255, 255, 255, 128]), { raw: { width: 1, height: 1, channels: 4 } })
      .resize(2048, 2048, { kernel: 'nearest' })
    const bridgeFrontPath = join(assetRoot, bridge.frontMaskPath.replace(/^assets\/v0\.3\.0\//u, ''))
    await antialiasedMask.png().toFile(bridgeFrontPath)
    bridge.frontMaskSha256 = createHash('sha256').update(await readFile(bridgeFrontPath)).digest('hex')
    const bridgeSource = sourceIndex.sources.find(source => source.sourceId === bridge.id)!
    bridgeSource.runtimeResources.find(resource => resource.path === bridge.frontMaskPath)!.sha256 = bridge.frontMaskSha256
    const nonBinary = await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex)
    expect(nonBinary).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_MASK_PIXELS_INVALID' }))
    variant.connectors[0]!.contourMaskSha256 = 'f'.repeat(64)
    const drift = await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex)
    expect(drift).toContainEqual(expect.objectContaining({ code: 'ASSET_HASH_MISMATCH' }))
    await rm(reviewPath)
    const missingReview = await validateProductionInterfaceResources(catalog, assetRoot, sourceIndex)
    expect(missingReview).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_REVIEW_MISSING' }))
  })

  it('treats unreferenced v0.3 connector and bridge images as stale resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-stale-'))
    temporaryDirectories.push(root)
    const catalog = makeInterfaceCatalogFixture()
    await mkdir(join(root, 'connectors'), { recursive: true })
    await mkdir(join(root, 'bridges'), { recursive: true })
    await mkdir(join(root, 'nodes'), { recursive: true })
    await writeFile(join(root, 'connectors', 'stale.png'), 'stale')
    await writeFile(join(root, 'bridges', 'stale.webp'), 'stale')
    await writeFile(join(root, 'nodes', 'stale.png'), 'stale')
    const diagnostics = await validateNoStaleRuntimeAssets(catalog, root)
    expect(diagnostics.filter(item => item.code === 'PRODUCTION_RUNTIME_STALE').map(item => item.path.join('/'))).toEqual([
      'bridges/stale.webp', 'connectors/stale.png', 'nodes/stale.png',
    ])
  })

  it('keeps exact-rig runtime roots referenced by the canonical v0.3 source index while rejecting unbound files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-source-index-runtime-'))
    temporaryDirectories.push(root)
    const catalog = makeInterfaceCatalogFixture()
    await mkdir(join(root, 'structural', 'blob'), { recursive: true })
    await writeFile(join(root, 'structural', 'blob', 'accepted-root.png'), 'accepted')
    await writeFile(join(root, 'structural', 'blob', 'obsolete-root.png'), 'obsolete')
    const sourceIndex = {
      catalogVersion: '0.3.0',
      sources: [{
        sourceId: 'accepted-root:blob',
        runtimeResources: [{
          path: 'assets/v0.3.0/structural/blob/accepted-root.png',
          sha256: '1'.repeat(64),
        }],
      }],
    }

    const diagnostics = await validateNoStaleRuntimeAssets(catalog, root, sourceIndex)

    expect(diagnostics.filter(item => item.code === 'PRODUCTION_RUNTIME_STALE').map(item => item.path.join('/'))).toEqual([
      'structural/blob/obsolete-root.png',
    ])
  })

  it('keeps a runtime input referenced by the canonical hashed Task 6 integrity review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-reviewed-runtime-'))
    temporaryDirectories.push(root)
    const catalog = makeInterfaceCatalogFixture()
    const bytes = Buffer.from('approved input')
    await writeFile(join(root, 'reviewed.png'), bytes)
    await writeFile(join(root, 'obsolete.png'), 'obsolete')
    const integrity = {
      schemaVersion: 'task6-approved-input-integrity-v1',
      allUnchanged: true,
      files: [{
        path: 'packages/asset-catalog/assets/v0.3.0/reviewed.png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }],
    }

    const diagnostics = await validateNoStaleRuntimeAssets(catalog, root, undefined, integrity)

    expect(diagnostics.filter(item => item.code === 'PRODUCTION_RUNTIME_STALE').map(item => item.path.join('/'))).toEqual([
      'obsolete.png',
    ])
    expect(diagnostics.filter(item => item.code === 'ASSET_HASH_MISMATCH')).toEqual([])
  })

  it('rejects a Task 6 runtime integrity reference whose hash differs from live bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-reviewed-runtime-hash-'))
    temporaryDirectories.push(root)
    const catalog = makeInterfaceCatalogFixture()
    await writeFile(join(root, 'reviewed.png'), 'approved input')
    const integrity = {
      schemaVersion: 'task6-approved-input-integrity-v1',
      allUnchanged: true,
      files: [{
        path: 'packages/asset-catalog/assets/v0.3.0/reviewed.png',
        sha256: 'f'.repeat(64),
      }],
    }

    const diagnostics = await validateNoStaleRuntimeAssets(catalog, root, undefined, integrity)

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'ASSET_HASH_MISMATCH',
      path: ['task6Integrity', 'packages/asset-catalog/assets/v0.3.0/reviewed.png'],
    }))
  })

  it('binds production validation to the canonical manifest, exact source inventory, and one review hash', async () => {
    const catalog = makeInterfaceCatalogFixture()
    const parts = catalog.parts.filter(part => part.composition?.mode === 'interface').slice(0, 2)
    catalog.parts = parts
    catalog.transitionBridges = []
    const sources = parts.flatMap((part, partIndex) => Object.keys(
      part.composition?.mode === 'interface' ? part.composition.variantsByRig : {},
    ).map((rigId, rigIndex) => ({
      sourceId: `${part.id}:${rigId}`,
      kind: 'interface-structural',
      sourceResources: [{ path: `asset-source/v0.3.0/production/${part.id}.png`, sha256: '1'.repeat(64) }],
      promptPath: 'asset-source/v0.3.0/prompts/structural-prompts.json',
      promptSha256: '2'.repeat(64),
      promptId: part.id,
      reviewRecordPath: 'packages/asset-catalog/review/v0.3.0/review-record.json',
      reviewRecordSha256: String(partIndex + rigIndex + 3).repeat(64),
      runtimeResources: [],
    })))
    const diagnostics = await validateProductionInterfaceResources(catalog, 'missing-assets', {
      catalogVersion: '0.3.0',
      sources: [...sources, structuredClone(sources[0]), { ...structuredClone(sources[0]), sourceId: 'extra-interface' }],
    }, { manifestPath: join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json') })
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_SOURCE_INDEX_INVALID' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_MANIFEST_MISMATCH' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_REVIEW_HASH_CONFLICT' }))
  })

  it('rejects duplicate transition bridge IDs before exact-inventory Map construction', async () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.transitionBridges![1]!.id = catalog.transitionBridges![0]!.id
    const diagnostics = await validateProductionInterfaceResources(catalog, 'missing-assets', { catalogVersion: '0.3.0', sources: [] }, {
      manifestPath: join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json'),
    })
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_BRIDGE_ID_DUPLICATE' }))
  })

  it('requires complete v0.3 connector, render-node, and bridge hash metadata', () => {
    const catalog = makeInterfaceCatalogFixture()
    const part = catalog.parts.find(item => item.composition?.mode === 'interface')!
    if (part.composition?.mode !== 'interface') throw new Error('expected interface composition')
    delete (part.composition.variantsByRig.biped!.connectors[0] as any).foregroundMaskSha256
    delete (part.composition.variantsByRig.biped!.renderNodes[0] as any).pngSha256
    delete (catalog.transitionBridges![0] as any).backMaskSha256
    const diagnostics = validateProductionMetadata(catalog)
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_CONNECTOR_METADATA_MISSING' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_NODE_METADATA_MISSING' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_INTERFACE_BRIDGE_METADATA_MISSING' }))
  })

  it('uses interface provenance instead of chroma-candidate audits for v0.3 structural sources', async () => {
    const catalog = makeInterfaceCatalogFixture()
    const part = catalog.parts.find(item => item.composition?.mode === 'interface')!
    catalog.parts = [part]
    catalog.rigs = []
    catalog.transitionBridges = []
    const diagnostics = await validateProductionSourceIndex(catalog, 'missing-assets', {
      catalogVersion: '0.3.0',
      sources: [{
        sourceId: part.id,
        kind: 'interface-structural',
        sourcePngPath: `asset-source/v0.3.0/production/${part.id}.png`,
        sourcePngSha256: '1'.repeat(64),
        sourceResources: [{ path: `asset-source/v0.3.0/production/${part.id}.png`, sha256: '1'.repeat(64) }],
        promptPath: 'asset-source/v0.3.0/prompts/structural-prompts.json',
        promptSha256: '2'.repeat(64),
        promptId: part.id,
        prompt: 'structural prompt',
        reviewRecordPath: 'packages/asset-catalog/review/v0.3.0/review-record.json',
        reviewRecordSha256: '3'.repeat(64),
        runtimePngPath: part.pngPath,
        runtimePngSha256: part.pngSha256,
        runtimeWebpPath: part.assetPath,
        runtimeWebpSha256: part.assetSha256,
      }],
      qualityGateSummary: {},
    })
    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      code: expect.stringMatching(/^PRODUCTION_(SOURCE_AUDIT_INVALID|SELECTION_|CANDIDATE_)/u),
      path: expect.arrayContaining([part.id]),
    }))
  })
  it('rejects production evidence that is not the catalog root canonical source index and manifest', async () => {
    const { root, catalogDirectory } = await makeProductionCliFixture()
    const alternateRoot = join(root, 'alternate')
    const alternateAudit = join(alternateRoot, 'audit', 'v0.1.0')
    await mkdir(alternateAudit, { recursive: true })
    await writeFile(join(alternateRoot, 'source-index.json'), await readFile(join(root, 'source-index.json')))
    await writeFile(join(alternateAudit, 'evidence-manifest.json'), await readFile(join(root, 'audit', 'v0.1.0', 'evidence-manifest.json')))
    await writeFile(join(root, 'audit', 'v0.1.0', 'renamed-manifest.json'), await readFile(join(root, 'audit', 'v0.1.0', 'evidence-manifest.json')))

    const executable = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const cli = join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts')
    const shared = [
      executable, cli, join(catalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'), '--production',
    ]
    for (const [sourceIndexPath, evidenceManifestPath] of [
      [join(alternateRoot, 'source-index.json'), join(root, 'audit', 'v0.1.0', 'evidence-manifest.json')],
      [join(root, 'source-index.json'), join(root, 'audit', 'v0.1.0', 'renamed-manifest.json')],
    ]) {
      await expect(execFile(process.execPath, [
        ...shared,
        '--source-index', sourceIndexPath,
        '--evidence-manifest', evidenceManifestPath,
      ])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('PRODUCTION_EVIDENCE_PATH_INVALID'),
      })
    }
  })

  it('binds evidence to the canonical catalog target instead of a catalog junction parent', async () => {
    const { root, catalogDirectory } = await makeProductionCliFixture()
    const alternateRoot = join(root, 'alternate')
    const alternateCatalogDirectory = join(alternateRoot, 'catalog', 'v0.1.0')
    await mkdir(join(alternateRoot, 'audit', 'v0.1.0'), { recursive: true })
    await writeFile(join(alternateRoot, 'source-index.json'), await readFile(join(root, 'source-index.json')))
    await writeFile(join(alternateRoot, 'audit', 'v0.1.0', 'evidence-manifest.json'), await readFile(join(root, 'audit', 'v0.1.0', 'evidence-manifest.json')))
    await mkdir(join(alternateRoot, 'catalog'), { recursive: true })
    await symlink(catalogDirectory, alternateCatalogDirectory, 'junction')

    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts'),
      join(alternateCatalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'), '--production',
      '--source-index', join(alternateRoot, 'source-index.json'),
      '--evidence-manifest', join(alternateRoot, 'audit', 'v0.1.0', 'evidence-manifest.json'),
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('PRODUCTION_EVIDENCE_PATH_INVALID'),
    })
  })

  it('rejects a canonical evidence path whose parent junction resolves outside the package root before reading it', async ({ skip }) => {
    const { root, catalogDirectory } = await makeProductionCliFixture()
    const canonicalAudit = join(root, 'audit', 'v0.1.0')
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-evidence-outside-'))
    temporaryDirectories.push(outside)
    await writeFile(join(outside, 'evidence-manifest.json'), await readFile(join(canonicalAudit, 'evidence-manifest.json')))
    await rm(canonicalAudit, { recursive: true, force: true })
    try {
      await symlink(outside, canonicalAudit, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) skip('directory links unavailable')
      throw error
    }

    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts'),
      join(catalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'), '--production',
      '--source-index', join(root, 'source-index.json'),
      '--evidence-manifest', join(canonicalAudit, 'evidence-manifest.json'),
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('PRODUCTION_EVIDENCE_PATH_INVALID'),
    })
  })

  it('requires exact PNG and WebP hashes for every 0.2.0 composition render node', () => {
    const catalog = makeCompositionCatalogFixture()
    const node = catalog.parts.find(part => !part.composition!.isNone)!.composition!.renderNodes[0]!
    delete node.assetSha256
    delete node.pngSha256

    const diagnostics = validateProductionMetadata(catalog)

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_COMPOSITION_NODE_METADATA_MISSING',
      path: expect.arrayContaining(['composition', 'renderNodes', '0']),
    }))
  })

  it('requires every 0.2.0 part source to reference an existing rework record with its actual hash', async () => {
    const catalog = makeCompositionCatalogFixture()
    const root = await mkdtemp(join(tmpdir(), 'qmonster-rework-record-'))
    temporaryDirectories.push(root)
    const assetRoot = join(root, 'assets', 'v0.2.0')
    const reworkDirectory = join(root, 'review', 'v0.2.0')
    await mkdir(reworkDirectory, { recursive: true })
    const reworkPath = join(reworkDirectory, 'rework-record.json')
    const record = Buffer.from('{"parts":{}}\n')
    const expectedPath = 'packages/asset-catalog/review/v0.2.0/rework-record.json'
    const sourceIndex = (sha256: string) => ({
      catalogVersion: '0.2.0',
      sources: catalog.parts.map(part => ({
        sourceId: part.id,
        reworkRecordPath: expectedPath,
        reworkRecordSha256: sha256,
      })),
      qualityGateSummary: {},
    })

    const missing = await validateProductionSourceIndex(catalog, assetRoot, sourceIndex(createHash('sha256').update(record).digest('hex')))
    expect(missing).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_REWORK_RECORD_MISSING' }))

    await writeFile(reworkPath, record)
    const mismatched = await validateProductionSourceIndex(catalog, assetRoot, sourceIndex('f'.repeat(64)))
    expect(mismatched).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_REWORK_RECORD_HASH_MISMATCH' }))

    const matching = await validateProductionSourceIndex(catalog, assetRoot, sourceIndex(createHash('sha256').update(record).digest('hex')))
    expect(matching).not.toContainEqual(expect.objectContaining({
      code: expect.stringMatching(/^PRODUCTION_REWORK_RECORD_/u),
    }))
  })

  it('requires rich Task 8 metadata without tightening the general catalog schema', () => {
    const catalog = makeValidCatalogFixture()
    catalog.modifiers.pop()
    const diagnostics = validateProductionMetadata(catalog)
    const codes = diagnostics.map(item => item.code)

    expect(codes).toContain('PRODUCTION_PART_METADATA_MISSING')
    expect(codes).toContain('PRODUCTION_SEMANTIC_METADATA_MISSING')
    expect(codes).toContain('PRODUCTION_SEMANTIC_COUNT_INVALID')
    expect(codes).toContain('PRODUCTION_MODIFIER_COUNT_INVALID')
  })

  it('accepts the committed aggregate and split catalog as exactly equal', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))

    expect(validateProductionMetadata(parsed.value)).toEqual([])
    await expect(validateProductionSplitFiles(parsed.value, join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0'))).resolves.toEqual([])
  })

  it('requires every production color scheme to provide three hashed masks for every compatible rig', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const catalog = structuredClone(parsed.value)
    const hash = 'a'.repeat(64)
    for (const part of catalog.parts.filter(candidate => candidate.slotId === 'colorScheme')) {
      part.rigMaskPaths = Object.fromEntries(part.compatibleRigs.map(rigId => [rigId, {
        primary: `masks/${part.id}-${rigId}-primary.png`,
        secondary: `masks/${part.id}-${rigId}-secondary.png`,
        accent: `masks/${part.id}-${rigId}-accent.png`,
      }]))
      part.rigMaskSha256 = Object.fromEntries(part.compatibleRigs.map(rigId => [rigId, {
        primary: hash,
        secondary: hash,
        accent: hash,
      }]))
    }
    delete catalog.parts.find(candidate => candidate.id === 'color_deep_sea_coral')!
      .rigMaskPaths!.blob!.primary

    const diagnostics = validateProductionMetadata(catalog)

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_COLOR_MASKS_MISSING',
      path: ['parts', expect.any(String), 'rigMaskPaths', 'blob', 'primary'],
    }))
  })

  it('rejects any split file that drifts from the aggregate catalog', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const directory = await mkdtemp(join(tmpdir(), 'qmonster-splits-'))
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const mappings = [
      ['themes.json', parsed.value.themes],
      ['rigs.json', parsed.value.rigs],
      ['parts.json', parsed.value.parts.slice(1)],
      ['semantic-traits.json', parsed.value.semanticTraits],
      ['modifiers.json', parsed.value.modifiers],
    ] as const
    for (const [file, value] of mappings) await writeFile(join(directory, file), `${JSON.stringify(value)}\n`)

    const diagnostics = await validateProductionSplitFiles(parsed.value, directory)

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_SPLIT_MISMATCH', path: ['parts.json'] }))
  })

  it('rejects stale runtime files outside the production catalog and rig set', async () => {
    const catalog = makeValidCatalogFixture()
    const root = await mkdtemp(join(tmpdir(), 'qmonster-stale-assets-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'parts'), { recursive: true })
    await mkdir(join(root, 'rigs'), { recursive: true })
    for (const part of catalog.parts) {
      part.assetPath = `parts/${part.id}.webp`
      part.pngPath = `parts/${part.id}.png`
    }
    for (const rig of catalog.rigs) rig.sourceId = `base_${rig.id}_v1`
    await writeFile(join(root, 'parts', 'stale.png'), 'stale')

    const diagnostics = await validateNoStaleRuntimeAssets(catalog, root)

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_RUNTIME_STALE', path: ['parts', 'stale.png'] }))
  })

  it('requires source-index coverage and a machine-approved selected candidate for every rig and part', async () => {
    const catalog = makeValidCatalogFixture()
    for (const rig of catalog.rigs) rig.sourceId = `base_${rig.id}_v1`
    const selectedPart = catalog.parts[0]!
    const diagnostics = await validateProductionSourceIndex(catalog, 'unused-assets', {
      sources: [{
        sourceId: selectedPart.id,
        kind: 'generated-slot-layer',
        runtimePngPath: selectedPart.pngPath,
        runtimePngSha256: selectedPart.pngSha256,
        runtimeWebpPath: selectedPart.assetPath,
        runtimeWebpSha256: selectedPart.assetSha256,
        candidateEvaluations: [
          { index: 1, selected: true, machineApproved: false },
          { index: 2, selected: false, machineApproved: true },
          { index: 3, selected: false, machineApproved: true },
          { index: 4, selected: false, machineApproved: true },
        ],
        selectedExtraction: { approved: false },
      }],
      qualityGateSummary: {},
    })

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_SELECTION_GATE_FAILED', path: ['sources', selectedPart.id] }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_SOURCE_MISSING' }))
  })

  it('rejects a chroma source whose prompt evidence or prompt hash is missing', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const sourceIndex = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'eyes_glossy_pair')
    delete source.prompt
    delete source.promptSha256

    const diagnostics = await validateProductionSourceIndex(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      sourceIndex,
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_SOURCE_AUDIT_INVALID',
      path: ['sources', 'eyes_glossy_pair', 'prompt'],
    }))
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_SOURCE_AUDIT_INVALID',
      path: ['sources', 'eyes_glossy_pair', 'promptSha256'],
    }))
  })

  it('rejects missing candidate metrics, diagnostics, thresholds, and extraction hashes', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const original = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const mutations: Array<{ field: string; mutate: (candidate: Record<string, unknown>) => void }> = [
      { field: 'metrics', mutate: candidate => { delete candidate.metrics } },
      { field: 'diagnostics', mutate: candidate => { delete candidate.diagnostics } },
      { field: 'sourceSha256', mutate: candidate => { candidate.sourceSha256 = 'bad-hash' } },
      { field: 'processedSha256', mutate: candidate => { delete candidate.processedSha256 } },
      { field: 'thresholds', mutate: candidate => { candidate.thresholds = { safeBorderPixels: 16 } } },
    ]
    for (const mutation of mutations) {
      const sourceIndex = structuredClone(original)
      const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'eyes_glossy_pair')
      mutation.mutate(source.candidateEvaluations[0])

      const diagnostics = await validateProductionSourceIndex(
        parsed.value,
        join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
        sourceIndex,
      )

      expect(diagnostics, mutation.field).toContainEqual(expect.objectContaining({
        code: 'PRODUCTION_CANDIDATE_AUDIT_INVALID',
        path: ['sources', 'eyes_glossy_pair', 'candidateEvaluations', '0', mutation.field],
      }))
    }
  })

  it('rejects selectedExtraction when it differs from the selected candidate evaluation', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const sourceIndex = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'eyes_glossy_pair')
    source.selectedExtraction.processedSha256 = 'f'.repeat(64)

    const diagnostics = await validateProductionSourceIndex(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      sourceIndex,
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_SELECTED_EXTRACTION_MISMATCH',
      path: ['sources', 'eyes_glossy_pair', 'selectedExtraction'],
    }))
  })

  it('recomputes candidate approval, diagnostics, and thresholds with the immutable gate', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const original = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const mutations: Array<{ label: string; mutate: (sourceIndex: Record<string, any>, source: Record<string, any>) => void }> = [
      {
        label: 'unknown gate version',
        mutate: sourceIndex => { sourceIndex.extractionGate.gateVersion = 'forged-gate-v999' },
      },
      {
        label: 'impossible metric with synced fake diagnostic',
        mutate: (_sourceIndex, source) => {
          const candidate = source.candidateEvaluations.find((value: Record<string, unknown>) => value.selected)
          candidate.metrics.safeBorderForegroundPixels = 999_999
          candidate.thresholds.maxSafeBorderForegroundPixels = 999_999
          candidate.diagnostics = [{ severity: 'error', code: 'FORGED_DIAGNOSTIC', message: 'attacker-controlled' }]
          source.selectedExtraction = {
            gateVersion: candidate.gateVersion,
            imageSize: candidate.imageSize,
            sourcePath: candidate.sourcePath,
            processedPath: candidate.processedPath,
            approved: candidate.machineApproved,
            diagnostics: candidate.diagnostics,
            metrics: candidate.metrics,
            thresholds: candidate.thresholds,
            sourceSha256: candidate.sourceSha256,
            processedSha256: candidate.processedSha256,
          }
        },
      },
      {
        label: 'attacker-controlled threshold profile',
        mutate: (_sourceIndex, source) => {
          const candidate = source.candidateEvaluations[1]
          candidate.thresholds.maxEdgeColorDeltaP95 = 999_999
        },
      },
    ]
    for (const mutation of mutations) {
      const sourceIndex = structuredClone(original)
      const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'eyes_glossy_pair')
      mutation.mutate(sourceIndex, source)

      const diagnostics = await validateProductionSourceIndex(
        parsed.value,
        join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
        sourceIndex,
      )

      expect(diagnostics, mutation.label).toContainEqual(expect.objectContaining({
        code: 'PRODUCTION_CANDIDATE_GATE_MISMATCH',
      }))
    }
  })

  it('recomputes angler component extraction evidence with the same immutable gate', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const sourceIndex = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'head_angler_bulb')
    const extraction = source.componentEvaluations.lure[0].extraction
    extraction.metrics.partialAlphaRatio = -1
    extraction.approved = true
    extraction.diagnostics = []

    const diagnostics = await validateProductionSourceIndex(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      sourceIndex,
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_CANDIDATE_GATE_MISMATCH',
      path: ['sources', 'head_angler_bulb', 'componentEvaluations', 'lure', '0', 'extraction'],
    }))
  })

  it('rejects incomplete two-source head-shell/lure composition provenance', async () => {
    const catalog = makeValidCatalogFixture()
    const selectedPart = catalog.parts[0]!
    const component = {
      role: 'head-shell',
      sourceSheetPath: 'asset-source/shell-sheet.png',
      sourceSheetSha256: '1'.repeat(64),
      sourcePath: 'asset-source/shell-source.png',
      sourceSha256: '2'.repeat(64),
      processedPath: 'asset-source/shell-rgba.png',
      processedSha256: '3'.repeat(64),
      promptPath: 'asset-source/shell.txt',
      promptSha256: '4'.repeat(64),
    }
    const diagnostics = await validateProductionSourceIndex(catalog, 'unused-assets', {
      sources: [{
        sourceId: selectedPart.id,
        kind: 'generated-slot-layer',
        postProcess: 'head-shell-lure-composite-v1',
        runtimePngPath: selectedPart.pngPath,
        runtimePngSha256: selectedPart.pngSha256,
        runtimeWebpPath: selectedPart.assetPath,
        runtimeWebpSha256: selectedPart.assetSha256,
        candidateEvaluations: [1, 2, 3, 4].map(index => ({ index, selected: index === 1, machineApproved: true })),
        selectedExtraction: { approved: true },
        composition: {
          attachment: { x: 512, y: 350 },
          compositionVersion: 'head-shell-lure-composite-v1',
          componentProvenance: {
            shell: component,
            lure: { ...component, role: 'lure', promptSha256: '' },
          },
        },
      }],
      qualityGateSummary: {},
    })

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_COMPOSITE_PROVENANCE_INVALID',
      path: ['sources', selectedPart.id, 'composition', 'componentProvenance', 'lure', 'promptSha256'],
    }))
  })

  it('rejects incomplete or inconsistent four-candidate angler composition evidence', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const original = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const mutations: Array<{ field: string; mutate: (source: Record<string, any>) => void }> = [
      { field: 'outputSha256', mutate: source => { delete source.composition.outputSha256 } },
      { field: 'outputBounds', mutate: source => { source.composition.outputBounds.width = 0 } },
      { field: 'candidateEvaluations', mutate: source => { source.candidateEvaluations[2].composition = null } },
      { field: 'selectedComposition', mutate: source => { source.composition.outputSha256 = 'f'.repeat(64) } },
    ]
    for (const mutation of mutations) {
      const sourceIndex = structuredClone(original)
      const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'head_angler_bulb')
      mutation.mutate(source)

      const diagnostics = await validateProductionSourceIndex(
        parsed.value,
        join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
        sourceIndex,
      )

      expect(diagnostics, mutation.field).toContainEqual(expect.objectContaining({
        code: 'PRODUCTION_COMPOSITE_PROVENANCE_INVALID',
      }))
    }
  })

  it('rejects incomplete angler shell and lure component extraction evaluations', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const sourceIndex = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'head_angler_bulb')
    delete source.componentEvaluations.lure[0].extraction.metrics

    const diagnostics = await validateProductionSourceIndex(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      sourceIndex,
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_COMPOSITE_PROVENANCE_INVALID',
      path: ['sources', 'head_angler_bulb', 'componentEvaluations', 'lure', '0', 'extraction', 'metrics'],
    }))
  })

  it('rejects color mask audit drift from catalog, rig, and zero-overflow metrics', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const original = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const mutations: Array<{ label: string; mutate: (source: Record<string, any>) => void }> = [
      { label: 'audit missing', mutate: source => { delete source.paletteMaskAudit } },
      { label: 'mask hash drift', mutate: source => { source.paletteMaskAudit.rigMasks.blob.sha256.primary = 'f'.repeat(64) } },
      { label: 'mask overflow', mutate: source => { source.paletteMaskAudit.rigMasks.blob.metrics.outsideRigCorePixels = 1 } },
      { label: 'layout source hash malformed', mutate: source => { source.paletteMaskAudit.sourceSha256 = 'bad' } },
    ]
    for (const mutation of mutations) {
      const sourceIndex = structuredClone(original)
      const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'color_deep_sea_coral')
      mutation.mutate(source)

      const diagnostics = await validateProductionSourceIndex(
        parsed.value,
        join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
        sourceIndex,
      )

      expect(diagnostics, mutation.label).toContainEqual(expect.objectContaining({
        code: 'PRODUCTION_COLOR_MASK_AUDIT_INVALID',
      }))
    }
  })

  it('decodes committed rig and mask pixels instead of trusting synchronized palette arithmetic', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const sourceIndex = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index.json'), 'utf8'))
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'color_deep_sea_coral')
    const metrics = source.paletteMaskAudit.rigMasks.blob.metrics
    metrics.primaryPixels -= 1
    metrics.secondaryPixels += 1

    const diagnostics = await validateProductionSourceIndex(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      sourceIndex,
    )

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_COLOR_MASK_PIXELS_MISMATCH',
      path: ['sources', 'color_deep_sea_coral', 'paletteMaskAudit', 'rigMasks', 'blob', 'metrics'],
    }))
  })

  it('validates v0.3 palette masks against committed structural-union alpha evidence', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const sourceIndex = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index-v0.3.0.json'), 'utf8'))

    const diagnostics = await validateProductionSourceIndex(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.3.0'),
      sourceIndex,
    )

    expect(diagnostics.filter(diagnostic => diagnostic.code.startsWith('PRODUCTION_COLOR_MASK'))).toEqual([])
  })

  it('resolves v0.3 catalog identities and rig roots from canonical exact-rig sources', async () => {
    const catalogPath = join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json')
    const parsed = await loadCatalog(catalogPath)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const original = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index-v0.3.0.json'), 'utf8'))
    expect(original.sources).toHaveLength(102)

    const baseline = await validateProductionSourceIndex(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.3.0'),
      original,
    )
    expect(baseline.filter(diagnostic => diagnostic.code === 'PRODUCTION_SOURCE_MISSING')).toEqual([])

    const missingExact = structuredClone(original)
    missingExact.sources = missingExact.sources.filter((source: any) => source.sourceId !== 'tail_soft_curl:blob')
    const diagnostics = await validateProductionSourceIndex(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.3.0'),
      missingExact,
    )
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_SOURCE_MISSING',
      path: ['sources', 'tail_soft_curl:blob'],
    }))
  })

  it('resolves v0.3 interface resource closure through every canonical exact-rig source', async () => {
    const parsed = await loadCatalog(join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json'))
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const original = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index-v0.3.0.json'), 'utf8'))
    const assetRoot = join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.3.0')
    const manifestPath = join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json')

    const baseline = await validateProductionInterfaceResources(parsed.value, assetRoot, original, { manifestPath })
    expect(baseline.filter(diagnostic => diagnostic.code === 'PRODUCTION_INTERFACE_SOURCE_MISSING')).toEqual([])
    expect(baseline.filter(diagnostic => diagnostic.code === 'PRODUCTION_INTERFACE_RUNTIME_INDEX_MISMATCH')).toEqual([])

    const missingExact = structuredClone(original)
    missingExact.sources = missingExact.sources.filter((source: any) => source.sourceId !== 'extra_side_fins:floating')
    const diagnostics = await validateProductionInterfaceResources(parsed.value, assetRoot, missingExact, { manifestPath })
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_INTERFACE_SOURCE_MISSING',
      path: ['sources', 'extra_side_fins:floating'],
    }))
  })

  it('validates six Task 9 bridges against exact runtime resources, dimensions, and agent review', async () => {
    const parsed = await loadCatalog(join(process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json'))
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const sourceIndex = JSON.parse(await readFile(join(process.cwd(), 'packages', 'asset-catalog', 'source-index-v0.3.0.json'), 'utf8'))
    const diagnostics = await validateProductionInterfaceResources(
      parsed.value,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.3.0'),
      sourceIndex,
    )
    const task9BridgeDiagnostics = diagnostics.filter(diagnostic => (
      diagnostic.code === 'ASSET_DIMENSION_INVALID'
      || diagnostic.path.some(segment => /-(?:tail|extra)-bridge$/u.test(segment))
    ))
    expect(task9BridgeDiagnostics).toEqual([])
  })

  it('returns a nonzero production CLI status when candidate fallback evidence is deleted', async () => {
    const { root, catalogDirectory, sourceIndex } = await makeProductionCliFixture()
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'eyes_glossy_pair')
    delete source.candidateEvaluations[0].thresholds
    await writeFile(join(root, 'source-index.json'), `${JSON.stringify(sourceIndex)}\n`)

    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts'),
      join(catalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      '--production',
      '--source-index', join(root, 'source-index.json'),
      '--evidence-manifest', join(root, 'audit', 'v0.1.0', 'evidence-manifest.json'),
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('PRODUCTION_CANDIDATE_AUDIT_INVALID'),
    })
  })

  it('returns a nonzero production CLI status when synchronized source-index evidence differs from its independent anchor', async () => {
    const { root, catalogDirectory, sourceIndex } = await makeProductionCliFixture()
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'eyes_glossy_pair')
    source.prompt = `${source.prompt} forged`
    source.promptSha256 = createHash('sha256').update(source.prompt).digest('hex')
    source.masterSha256 = 'e'.repeat(64)
    await writeFile(join(root, 'source-index.json'), `${JSON.stringify(sourceIndex)}\n`)

    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts'),
      join(catalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      '--production',
      '--source-index', join(root, 'source-index.json'),
      '--evidence-manifest', join(root, 'audit', 'v0.1.0', 'evidence-manifest.json'),
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('PRODUCTION_EVIDENCE_ROOT_MISMATCH'),
    })
  })

  it('returns a nonzero source-rich CLI status when a legal ignored-source hash drifts', async () => {
    const { root, catalogDirectory, sourceIndex } = await makeProductionCliFixture()
    const sourceRoot = await createSyntheticSourceRichRoot(sourceIndex, root)
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'eyes_glossy_pair')
    source.candidateEvaluations[0].sourceSha256 = 'f'.repeat(64)
    await writeFile(join(root, 'source-index.json'), `${JSON.stringify(sourceIndex)}\n`)
    await writeFile(
      join(root, 'audit', 'v0.1.0', 'evidence-manifest.json'),
      `${JSON.stringify(buildProductionEvidenceManifest(sourceIndex))}\n`,
    )

    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts'),
      join(catalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      '--production',
      '--source-index', join(root, 'source-index.json'),
      '--evidence-manifest', join(root, 'audit', 'v0.1.0', 'evidence-manifest.json'),
      '--source-root',
      sourceRoot,
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('PRODUCTION_SOURCE_FILE_HASH_MISMATCH'),
    })
  })

  it('returns a nonzero CLI status when --source-root has no value', async () => {
    const { root, catalogDirectory } = await makeProductionCliFixture()
    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts'),
      join(catalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      '--production',
      '--source-index', join(root, 'source-index.json'),
      '--evidence-manifest', join(root, 'audit', 'v0.1.0', 'evidence-manifest.json'),
      '--source-root',
    ])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('CATALOG_CLI_ARGUMENTS_INVALID') })
  })

  it('recomputes a synchronized forged extraction decision in the production CLI process', async () => {
    const { root, catalogDirectory, sourceIndex } = await makeProductionCliFixture()
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'eyes_glossy_pair')
    const selected = source.candidateEvaluations.find((candidate: Record<string, unknown>) => candidate.selected)
    selected.metrics.safeBorderForegroundPixels = 999_999
    selected.thresholds.maxSafeBorderForegroundPixels = 999_999
    selected.diagnostics = [{ severity: 'error', code: 'FORGED_DIAGNOSTIC', message: 'forged' }]
    source.selectedExtraction = {
      ...source.selectedExtraction,
      approved: selected.machineApproved,
      diagnostics: selected.diagnostics,
      metrics: selected.metrics,
      thresholds: selected.thresholds,
    }
    await writeSourceIndexAndAnchor(root, sourceIndex)

    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts'),
      join(catalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      '--production',
      '--source-index', join(root, 'source-index.json'),
      '--evidence-manifest', join(root, 'audit', 'v0.1.0', 'evidence-manifest.json'),
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('PRODUCTION_CANDIDATE_GATE_MISMATCH'),
    })
  })

  it('recomputes synchronized forged palette arithmetic from committed pixels in the production CLI process', async () => {
    const { root, catalogDirectory, sourceIndex } = await makeProductionCliFixture()
    const source = sourceIndex.sources.find((candidate: { sourceId: string }) => candidate.sourceId === 'color_deep_sea_coral')
    source.paletteMaskAudit.rigMasks.blob.metrics.primaryPixels -= 1
    source.paletteMaskAudit.rigMasks.blob.metrics.secondaryPixels += 1
    await writeSourceIndexAndAnchor(root, sourceIndex)

    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'packages', 'asset-catalog', 'src', 'cli.ts'),
      join(catalogDirectory, 'catalog.json'),
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.1.0'),
      '--production',
      '--source-index', join(root, 'source-index.json'),
      '--evidence-manifest', join(root, 'audit', 'v0.1.0', 'evidence-manifest.json'),
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('PRODUCTION_COLOR_MASK_PIXELS_MISMATCH'),
    })
  })

  it('rejects user-machine absolute paths anywhere in committed source-index audit data', async () => {
    const catalog = makeValidCatalogFixture()
    const diagnostics = await validateProductionSourceIndex(catalog, 'unused-assets', {
      sources: [],
      qualityGateSummary: {},
      review: {
        rejectedAttempts: [{ generationPath: 'C:/Users/example/.codex/generated_images/result.png' }],
      },
    })

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_SOURCE_PATH_ABSOLUTE',
      path: ['review', 'rejectedAttempts', '0', 'generationPath'],
    }))
  })

  it('validates canonical v0.3 head splits and rejects a merged foreground/background mutation', async () => {
    const catalog = JSON.parse(await readFile(join(
      process.cwd(), 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json',
    ), 'utf8'))
    const sourceIndex = JSON.parse(await readFile(join(
      process.cwd(), 'packages', 'asset-catalog', 'source-index-v0.3.0.json',
    ), 'utf8'))

    const diagnostics = await validateProductionInterfaceResources(
      catalog,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.3.0'),
      sourceIndex,
      { manifestPath: join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json') },
    )

    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_INTERFACE_HEAD_OCCLUSION_INVALID',
    }))
    const head = catalog.parts.find((part: any) => part.slotId === 'headShape')
    const connector = head.composition.variantsByRig.biped.connectors[0]
    connector.backgroundMaskPath = connector.foregroundMaskPath
    connector.backgroundMaskSha256 = connector.foregroundMaskSha256
    const mutated = await validateProductionInterfaceResources(
      catalog,
      join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.3.0'),
      sourceIndex,
      { manifestPath: join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json') },
    )
    expect(mutated).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_INTERFACE_HEAD_OCCLUSION_INVALID',
    }))
  })
})
