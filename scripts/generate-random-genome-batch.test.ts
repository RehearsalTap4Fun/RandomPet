import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { MonsterSpec } from '@qmonster/generator-core'
import {
  buildRandomGenomeBatchInputs,
  generateRandomGenomeUserReviewBatch,
  mapRandomGenomeBatchInputsOneShot,
  parseRandomGenomeBatchArguments,
  runRandomGenomeBatchCommand,
  verifyRandomGenomeBatchArtifacts,
} from './generate-random-genome-batch.js'

describe('random genome user-review batch', () => {
  it('builds a deterministic 18-entry Latin-square batch with two of every theme and mode pair', () => {
    const entries = buildRandomGenomeBatchInputs('qmonster-v04-user-review', 18)

    expect(entries).toHaveLength(18)
    expect(entries.slice(0, 9).map(({ themeId, mode }) => `${themeId}:${mode}`)).toEqual([
      'deep-sea:normal',
      'fungal:mutation',
      'shadow:aberration',
      'deep-sea:mutation',
      'fungal:aberration',
      'shadow:normal',
      'deep-sea:aberration',
      'fungal:normal',
      'shadow:mutation',
    ])
    const pairs = new Set(entries.map(item => `${item.themeId}:${item.mode}`))
    expect(pairs.size).toBe(9)
    for (const pair of pairs) {
      expect(entries.filter(item => `${item.themeId}:${item.mode}` === pair)).toHaveLength(2)
    }
    expect(entries.map(item => item.seed)).toEqual(Array.from(
      { length: 18 },
      (_, offset) => `qmonster-v04-user-review-${String(offset + 1).padStart(3, '0')}`,
    ))
    expect(buildRandomGenomeBatchInputs('qmonster-v04-user-review', 18)).toEqual(entries)
  })

  it('rejects any batch size other than the single production size of 18', () => {
    expect(() => buildRandomGenomeBatchInputs('qmonster-v04-user-review', 17)).toThrow('exactly 18')
    expect(() => buildRandomGenomeBatchInputs('qmonster-v04-user-review', 19)).toThrow('exactly 18')
  })

  it('maps every input through exactly one generation and one render', async () => {
    const inputs = buildRandomGenomeBatchInputs('qmonster-v04-user-review', 18).slice(0, 2)
    const generate = vi.fn((input: typeof inputs[number]) => ({ generatedSeed: input.seed }))
    const render = vi.fn(async (input: typeof inputs[number], generated: { generatedSeed: string }) => ({
      inputIndex: input.index,
      renderedSeed: generated.generatedSeed,
    }))

    const outputs = await mapRandomGenomeBatchInputsOneShot(inputs, { generate, render })

    expect(outputs.map(item => item.rendered.renderedSeed)).toEqual(inputs.map(item => item.seed))
    expect(generate).toHaveBeenCalledTimes(inputs.length)
    expect(render).toHaveBeenCalledTimes(inputs.length)
    for (const [offset, input] of inputs.entries()) {
      expect(generate).toHaveBeenNthCalledWith(offset + 1, input)
      expect(render).toHaveBeenNthCalledWith(offset + 1, input, { generatedSeed: input.seed })
    }
  })

  it('stops instead of retrying or substituting after a missing render', async () => {
    const [input] = buildRandomGenomeBatchInputs('qmonster-v04-user-review', 18)
    const generate = vi.fn(() => ({ generated: true }))
    const render = vi.fn(async () => undefined)

    await expect(mapRandomGenomeBatchInputsOneShot([input!], { generate, render }))
      .rejects.toThrow('missing render')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('stops on a duplicate render identity without rerendering either input', async () => {
    const inputs = buildRandomGenomeBatchInputs('qmonster-v04-user-review', 18).slice(0, 2)
    const generate = vi.fn((input: typeof inputs[number]) => ({ generatedSeed: input.seed }))
    const render = vi.fn(async (_input: typeof inputs[number], generated: { generatedSeed: string }) => ({
      inputIndex: 1,
      renderedSeed: generated.generatedSeed,
    }))

    await expect(mapRandomGenomeBatchInputsOneShot(inputs, { generate, render }))
      .rejects.toThrow('duplicate render')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('routes verify-only exclusively to the read/hash verifier', async () => {
    const runProductionBatch = vi.fn(async () => ({ mode: 'production' as const }))
    const verifyExistingBatch = vi.fn(async () => ({ mode: 'verify-only' as const }))

    const result = await runRandomGenomeBatchCommand([
      '--verify-only',
      '--output-directory',
      'artifacts/acceptance/random-genome-20260901-v04-user-review',
    ], { runProductionBatch, verifyExistingBatch })

    expect(result).toEqual({ mode: 'verify-only' })
    expect(runProductionBatch).not.toHaveBeenCalled()
    expect(verifyExistingBatch).toHaveBeenCalledTimes(1)
    expect(verifyExistingBatch).toHaveBeenCalledWith(
      'artifacts/acceptance/random-genome-20260901-v04-user-review',
    )
  })

  it('accepts only the exact production catalog, size, and required arguments', () => {
    expect(parseRandomGenomeBatchArguments([
      '--catalog-version', '0.4.0',
      '--seed', 'qmonster-v04-user-review',
      '--count', '18',
      '--output-directory', 'artifacts/acceptance/random-genome-20260901-v04-user-review',
    ])).toEqual({
      catalogVersion: '0.4.0',
      batchSeed: 'qmonster-v04-user-review',
      count: 18,
      outputDirectory: 'artifacts/acceptance/random-genome-20260901-v04-user-review',
    })
    expect(() => parseRandomGenomeBatchArguments([
      '--catalog-version', '0.3.0', '--seed', 'seed', '--count', '18', '--output-directory', 'artifacts/acceptance/x',
    ])).toThrow('0.4.0')
    expect(() => parseRandomGenomeBatchArguments([
      '--catalog-version', '0.4.0', '--seed', 'seed', '--count', '17', '--output-directory', 'artifacts/acceptance/x',
    ])).toThrow('exactly 18')
    expect(() => parseRandomGenomeBatchArguments([
      '--catalog-version', '0.4.0', '--seed', 'seed', '--count', '18', '--output-directory', 'artifacts/acceptance/x', '--retry', '1',
    ])).toThrow('Unknown')
  })

  it('verifies hashes from existing artifacts and rejects changed bytes', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'qmonster-random-batch-'))
    const outputDirectory = join(repositoryRoot, 'artifacts', 'acceptance', 'fixture')
    await mkdir(outputDirectory, { recursive: true })
    const pngBytes = Buffer.from('png fixture')
    const specBytes = Buffer.from(`${JSON.stringify({ genome: { genomeVersion: '0.1.0', genes: {} } }, null, 2)}\n`)
    const contactSheetBytes = Buffer.from('contact sheet fixture')
    await writeFile(join(outputDirectory, '001.png'), pngBytes)
    await writeFile(join(outputDirectory, '001.json'), specBytes)
    await writeFile(join(outputDirectory, 'contact-sheet.png'), contactSheetBytes)
    const { createHash } = await import('node:crypto')
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    const manifest = {
      manifestVersion: 'qmonster-random-genome-batch-v04-user-review-v1',
      batchSeed: 'fixture',
      catalogVersion: '0.4.0',
      schemaVersion: '0.1.0',
      rendererVersion: '0.4.0',
      genomeVersion: '0.1.0',
      count: 1,
      review: {
        decision: 'pending_user_review',
        userApproved: false,
        regeneratedForVisualPreference: false,
      },
      recoveryProvenance: {
        productionCommandAttempts: 3,
        completedBatchRenderPasses: 1,
        priorFailedAttempts: [
          {
            attempt: 1,
            index: 2,
            seed: 'qmonster-v04-user-review-002',
            stage: 'generation',
            code: 'SPEC_SOCKET_MISSING',
          },
          {
            attempt: 2,
            index: 7,
            seed: 'qmonster-v04-user-review-007',
            stage: 'render',
            code: 'COMPOSITION_FACE_OUT_OF_ZONE',
          },
        ],
        visualPreferenceRetries: 0,
        visualPreferenceReplacements: 0,
        visualPreferenceFiltering: 0,
      },
      contactSheet: { filename: 'contact-sheet.png', sha256: hash(contactSheetBytes) },
      entries: [{
        index: 1,
        pngFilename: '001.png',
        specFilename: '001.json',
        pngSha256: hash(pngBytes),
        specSha256: hash(specBytes),
        genomeSha256: hash(Buffer.from(JSON.stringify({ genomeVersion: '0.1.0', genes: {} }))),
        resolvedAssets: [],
      }],
    }
    await writeFile(join(outputDirectory, 'batch-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(verifyRandomGenomeBatchArtifacts('artifacts/acceptance/fixture', {
      repositoryRoot,
      expectedCount: 1,
    })).resolves.toEqual(expect.objectContaining({ entryCount: 1 }))

    manifest.recoveryProvenance.productionCommandAttempts = 2
    await writeFile(join(outputDirectory, 'batch-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await expect(verifyRandomGenomeBatchArtifacts('artifacts/acceptance/fixture', {
      repositoryRoot,
      expectedCount: 1,
    })).rejects.toThrow('Batch manifest contract is invalid')

    manifest.recoveryProvenance.productionCommandAttempts = 3
    await writeFile(join(outputDirectory, 'batch-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(outputDirectory, '001.png'), Buffer.from('changed'))
    await expect(verifyRandomGenomeBatchArtifacts('artifacts/acceptance/fixture', {
      repositoryRoot,
      expectedCount: 1,
    })).rejects.toThrow('PNG hash mismatch')
    expect(await readFile(join(outputDirectory, '001.json'))).toEqual(specBytes)
  })

  it('writes complete pending-review PNG, spec, genome, hash, asset, and contact-sheet evidence', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'qmonster-random-production-'))
    const acceptanceRoot = join(repositoryRoot, 'artifacts', 'acceptance')
    const assetPath = join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.4.0', 'parts', 'fixture.png')
    await mkdir(acceptanceRoot, { recursive: true })
    await mkdir(dirname(assetPath), { recursive: true })
    await writeFile(assetPath, Buffer.from('resolved asset fixture'))
    const pngBytes = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#00000000' },
    }).png().toBuffer()
    const generate = vi.fn((input: ReturnType<typeof buildRandomGenomeBatchInputs>[number]) => ({
      blocked: false,
      diagnostics: [],
      strongFeatureCount: 1,
      strongNonFacialFeatureCount: 1,
      spec: {
        schemaVersion: '0.1.0',
        catalogVersion: '0.4.0',
        rendererVersion: '0.4.0',
        seed: input.seed,
        themeId: input.themeId,
        visualSlots: { bodyFrame: { partId: 'body_fixture', rigId: 'blob' } },
        genome: { genomeVersion: '0.1.0', genes: { fixture: input.seed } },
      } as unknown as MonsterSpec,
    }))
    const render = vi.fn(async (input: ReturnType<typeof buildRandomGenomeBatchInputs>[number]) => ({
      inputIndex: input.index,
      pngBytes,
      diagnostics: [],
      compositionMetrics: null,
      connectorMetrics: null,
      resolvedAssetPaths: ['parts/fixture.png'],
    }))

    const result = await generateRandomGenomeUserReviewBatch({
      repositoryRoot,
      batchSeed: 'qmonster-v04-user-review',
      count: 18,
      outputDirectory: 'artifacts/acceptance/fixture',
      catalogVersion: '0.4.0',
    }, { generate, render })

    expect(generate).toHaveBeenCalledTimes(18)
    expect(render).toHaveBeenCalledTimes(18)
    expect(result).toEqual(expect.objectContaining({ entryCount: 18, pngCount: 18, specCount: 18 }))
    const manifest = JSON.parse(await readFile(
      join(repositoryRoot, 'artifacts', 'acceptance', 'fixture', 'batch-manifest.json'),
      'utf8',
    )) as Record<string, any>
    expect(manifest.review).toEqual({
      decision: 'pending_user_review',
      userApproved: false,
      regeneratedForVisualPreference: false,
    })
    expect(manifest.recoveryProvenance).toEqual({
      productionCommandAttempts: 3,
      completedBatchRenderPasses: 1,
      priorFailedAttempts: [
        {
          attempt: 1,
          index: 2,
          seed: 'qmonster-v04-user-review-002',
          stage: 'generation',
          code: 'SPEC_SOCKET_MISSING',
        },
        {
          attempt: 2,
          index: 7,
          seed: 'qmonster-v04-user-review-007',
          stage: 'render',
          code: 'COMPOSITION_FACE_OUT_OF_ZONE',
        },
      ],
      visualPreferenceRetries: 0,
      visualPreferenceReplacements: 0,
      visualPreferenceFiltering: 0,
    })
    expect(manifest.entries).toHaveLength(18)
    expect(manifest.entries.every((entry: Record<string, unknown>) => (
      entry.catalogVersion === '0.4.0'
      && entry.rendererVersion === '0.4.0'
      && entry.genomeVersion === '0.1.0'
      && entry.rigId === 'blob'
      && entry.strongFeatureCount === 1
      && entry.strongNonFacialFeatureCount === 1
      && /^[a-f0-9]{64}$/u.test(String(entry.pngSha256))
      && /^[a-f0-9]{64}$/u.test(String(entry.specSha256))
      && /^[a-f0-9]{64}$/u.test(String(entry.genomeSha256))
      && Array.isArray(entry.resolvedAssets)
      && entry.resolvedAssets.length === 1
    ))).toBe(true)
    const pairCounts = Object.fromEntries(Object.entries(manifest.themeModeDistribution))
    expect(Object.values(pairCounts)).toEqual(Array(9).fill(2))
    await expect(verifyRandomGenomeBatchArtifacts('artifacts/acceptance/fixture', {
      repositoryRoot,
    })).resolves.toEqual(expect.objectContaining({
      entryCount: 18,
      pngCount: 18,
      specCount: 18,
      resolvedAssetCount: 18,
    }))
  })

  it('stops on objective generation errors without rendering, replacing, or writing a partial batch', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'qmonster-random-error-'))
    await mkdir(join(repositoryRoot, 'artifacts', 'acceptance'), { recursive: true })
    const generate = vi.fn(() => ({
      blocked: true,
      diagnostics: [{ severity: 'error', code: 'FIXTURE_ERROR', path: [], message: 'fixture error' }],
      strongFeatureCount: 0,
      strongNonFacialFeatureCount: 0,
      spec: {} as MonsterSpec,
    }))
    const render = vi.fn()

    await expect(generateRandomGenomeUserReviewBatch({
      repositoryRoot,
      batchSeed: 'qmonster-v04-user-review',
      count: 18,
      outputDirectory: 'artifacts/acceptance/fixture',
      catalogVersion: '0.4.0',
    }, { generate, render })).rejects.toThrow('FIXTURE_ERROR')

    expect(generate).toHaveBeenCalledTimes(1)
    expect(render).not.toHaveBeenCalled()
    await expect(readFile(join(
      repositoryRoot,
      'artifacts',
      'acceptance',
      'fixture',
      'batch-manifest.json',
    ))).rejects.toThrow()
  })

  it('refuses an existing output directory before generation or rendering starts', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'qmonster-random-existing-'))
    await mkdir(join(repositoryRoot, 'artifacts', 'acceptance', 'fixture'), { recursive: true })
    const generate = vi.fn()
    const render = vi.fn()

    await expect(generateRandomGenomeUserReviewBatch({
      repositoryRoot,
      batchSeed: 'qmonster-v04-user-review',
      count: 18,
      outputDirectory: 'artifacts/acceptance/fixture',
      catalogVersion: '0.4.0',
    }, { generate, render })).rejects.toThrow('already exists')

    expect(generate).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })
})
