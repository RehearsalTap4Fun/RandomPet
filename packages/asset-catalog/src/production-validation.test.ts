import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { makeCompositionCatalogFixture, makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { buildProductionEvidenceManifest } from './evidence-root.js'
import { loadCatalog } from './load-catalog.js'
import {
  validateNoStaleRuntimeAssets,
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
  const root = await mkdtemp(join(tmpdir(), 'qmonster-production-cli-'))
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
})
