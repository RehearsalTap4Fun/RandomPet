import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { processRigManifest, processRigSheet } from './process-rig-sheets.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('rig-sheet processing audit', () => {
  it('replays four candidates through chroma gates and records selected master/runtime hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-rig-audit-'))
    temporaryDirectories.push(root)
    const sheetPath = join(root, 'sheet.png')
    const tile = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#00ff00' } })
      .composite([{ input: Buffer.from('<svg width="96" height="96"><circle cx="48" cy="48" r="25" fill="#a276c7"/></svg>') }])
      .png()
      .toBuffer()
    await sharp({ create: { width: 192, height: 192, channels: 3, background: '#00ff00' } })
      .composite([
        { input: tile, left: 0, top: 0 },
        { input: tile, left: 96, top: 0 },
        { input: tile, left: 0, top: 96 },
        { input: tile, left: 96, top: 96 },
      ])
      .png()
      .toFile(sheetPath)

    const audit = await processRigSheet({
      rigId: 'blob',
      sourceId: 'base_blob_v1',
      sheetPath,
      selected: 2,
      sourceRoot: join(root, 'source'),
      runtimeRoot: join(root, 'runtime'),
    })

    expect(audit.candidateEvaluations).toHaveLength(4)
    expect(audit.candidateEvaluations.every(candidate => candidate.machineApproved)).toBe(true)
    expect(audit.candidateEvaluations.map(candidate => candidate.index)).toEqual([1, 2, 3, 4])
    expect(audit.selectedExtraction).toEqual(audit.candidateEvaluations[1]!.extraction)
    expect(audit.master).toMatchObject({ width: 2048, height: 2048, hasAlpha: true, boundaryAlphaPixels: 0 })
    expect(audit.sheetSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(audit.master.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(audit.runtimePngSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(audit.runtimeWebpSha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(sharp(await readFile(audit.runtimePngPath)).metadata()).resolves.toMatchObject({ width: 1024, height: 1024, hasAlpha: true })
    await expect(sharp(await readFile(audit.runtimeWebpPath)).metadata()).resolves.toMatchObject({ width: 1024, height: 1024, hasAlpha: true })
  })

  it('writes a replayable manifest audit record without machine-specific source paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-rig-manifest-'))
    temporaryDirectories.push(root)
    const sourceRoot = join(root, 'source')
    const sheetDirectory = join(sourceRoot, 'generation', 'rig-sheets')
    await mkdir(sheetDirectory, { recursive: true })
    await sharp({ create: { width: 192, height: 192, channels: 3, background: '#00ff00' } })
      .composite([
        { input: Buffer.from('<svg width="38" height="38"><circle cx="19" cy="19" r="17" fill="#a276c7"/></svg>'), left: 29, top: 29 },
        { input: Buffer.from('<svg width="38" height="38"><circle cx="19" cy="19" r="17" fill="#a276c7"/></svg>'), left: 125, top: 29 },
        { input: Buffer.from('<svg width="38" height="38"><circle cx="19" cy="19" r="17" fill="#a276c7"/></svg>'), left: 29, top: 125 },
        { input: Buffer.from('<svg width="38" height="38"><circle cx="19" cy="19" r="17" fill="#a276c7"/></svg>'), left: 125, top: 125 },
      ])
      .png()
      .toFile(join(sheetDirectory, 'base_blob_v1-sheet.png'))
    const auditPath = join(sourceRoot, 'generation', 'rig-audit.json')

    await processRigManifest({
      sourceRoot,
      runtimeRoot: join(root, 'runtime'),
      auditPath,
      rigs: [{ rigId: 'blob', sourceId: 'base_blob_v1', selected: 1 }],
    })

    const written = JSON.parse(await readFile(auditPath, 'utf8')) as Array<Record<string, unknown>>
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      sourceId: 'base_blob_v1',
      sheetPath: 'generation/rig-sheets/base_blob_v1-sheet.png',
    })
    expect(JSON.stringify(written)).not.toContain('AppData')
  })
})
