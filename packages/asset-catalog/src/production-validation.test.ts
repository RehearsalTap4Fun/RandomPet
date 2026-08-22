import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { loadCatalog } from './load-catalog.js'
import {
  validateNoStaleRuntimeAssets,
  validateProductionMetadata,
  validateProductionSourceIndex,
  validateProductionSplitFiles,
} from './production-validation.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('strict production catalog validation', () => {
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
