import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  composeHeadShellWithLure,
  type AiComponentProvenance,
} from './compose-head-shell-lure.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function provenance(
  directory: string,
  role: AiComponentProvenance['role'],
  processedPath: string,
): Promise<AiComponentProvenance> {
  const sourceSheetPath = join(directory, `${role}-sheet.png`)
  const sourcePath = join(directory, `${role}-source.png`)
  const promptPath = join(directory, `${role}-prompt.txt`)
  const prompt = `${role} exact generation prompt`
  await writeFile(sourceSheetPath, `${role} sheet audit fixture`)
  await writeFile(sourcePath, `${role} source audit fixture`)
  await writeFile(promptPath, prompt)
  return {
    role,
    sourceSheetPath,
    sourceSheetSha256: await sha256(sourceSheetPath),
    sourcePath,
    sourceSha256: await sha256(sourcePath),
    processedPath,
    processedSha256: await sha256(processedPath),
    promptPath,
    prompt,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
  }
}

async function fixture(): Promise<{
  directory: string
  shellPath: string
  lurePath: string
  componentProvenance: { shell: AiComponentProvenance, lure: AiComponentProvenance }
}> {
  const directory = await mkdtemp(join(tmpdir(), 'qmonster-head-lure-'))
  temporaryDirectories.push(directory)
  const shellPath = join(directory, 'shell.png')
  const lurePath = join(directory, 'lure.png')
  await sharp({ create: { width: 128, height: 128, channels: 4, background: '#00000000' } })
    .composite([{ input: Buffer.from('<svg width="84" height="44"><path d="M0 44Q4 0 42 0T84 44Z" fill="#cc3366"/></svg>'), left: 22, top: 70 }])
    .png()
    .toFile(shellPath)
  await sharp({ create: { width: 128, height: 128, channels: 4, background: '#00000000' } })
    .composite([{ input: Buffer.from('<svg width="34" height="58"><path d="M17 56V22Q17 7 28 7" fill="none" stroke="#6633cc" stroke-width="8"/><circle cx="28" cy="9" r="8" fill="#33ccff"/></svg>'), left: 47, top: 32 }])
    .png()
    .toFile(lurePath)
  return {
    directory,
    shellPath,
    lurePath,
    componentProvenance: {
      shell: await provenance(directory, 'head-shell', shellPath),
      lure: await provenance(directory, 'lure', lurePath),
    },
  }
}

describe('deterministic AI head-shell and lure composition', () => {
  it('preserves both complete components, keeps them in bounds, records provenance, and is byte deterministic', async () => {
    const input = await fixture()
    const firstPath = join(input.directory, 'first.png')
    const secondPath = join(input.directory, 'second.png')
    const parameters = {
      shellPath: input.shellPath,
      lurePath: input.lurePath,
      attachment: { x: 64, y: 72 },
      lureScale: 1,
      outputSize: { width: 128, height: 128 },
      componentProvenance: input.componentProvenance,
    } as const

    const first = await composeHeadShellWithLure({ ...parameters, outputPath: firstPath })
    const second = await composeHeadShellWithLure({ ...parameters, outputPath: secondPath })
    const { data } = await sharp(firstPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let shellPixels = 0
    let lurePixels = 0
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset]! > 150 && data[offset + 1]! < 100 && data[offset + 3]! > 0) shellPixels += 1
      if (data[offset + 2]! > 150 && data[offset + 3]! > 0) lurePixels += 1
    }

    expect(shellPixels).toBeGreaterThan(1_000)
    expect(lurePixels).toBeGreaterThan(100)
    expect(first.outputSha256).toBe(second.outputSha256)
    expect(await readFile(firstPath)).toEqual(await readFile(secondPath))
    expect(first).toMatchObject({
      outputSize: { width: 128, height: 128 },
      attachment: { x: 64, y: 72 },
      compositionVersion: 'head-shell-lure-composite-v1',
      componentProvenance: input.componentProvenance,
    })
    expect(first.outputBounds.left).toBeGreaterThanOrEqual(0)
    expect(first.outputBounds.top).toBeGreaterThanOrEqual(0)
    expect(first.outputBounds.left + first.outputBounds.width).toBeLessThanOrEqual(128)
    expect(first.outputBounds.top + first.outputBounds.height).toBeLessThanOrEqual(128)
  })

  it.each([
    ['head-shell', 'shellPath'],
    ['lure', 'lurePath'],
  ] as const)('rejects an omitted %s component', async (role, field) => {
    const input = await fixture()
    const emptyPath = join(input.directory, `${role}-empty.png`)
    await sharp({ create: { width: 128, height: 128, channels: 4, background: '#00000000' } }).png().toFile(emptyPath)
    const componentProvenance = {
      ...input.componentProvenance,
      [role === 'head-shell' ? 'shell' : 'lure']: await provenance(input.directory, role, emptyPath),
    }
    await expect(composeHeadShellWithLure({
      shellPath: input.shellPath,
      lurePath: input.lurePath,
      [field]: emptyPath,
      outputPath: join(input.directory, `${role}-omitted.png`),
      attachment: { x: 64, y: 72 },
      lureScale: 1,
      outputSize: { width: 128, height: 128 },
      componentProvenance,
    })).rejects.toThrow(`${role} component has no visible alpha content`)
  })

  it('rejects placement that would crop the lure', async () => {
    const input = await fixture()
    await expect(composeHeadShellWithLure({
      shellPath: input.shellPath,
      lurePath: input.lurePath,
      outputPath: join(input.directory, 'cropped.png'),
      attachment: { x: 2, y: 2 },
      lureScale: 1,
      outputSize: { width: 128, height: 128 },
      componentProvenance: input.componentProvenance,
    })).rejects.toThrow('Lure placement would crop generated content')
  })

  it('rejects a destructive or enlarging lure scale', async () => {
    const input = await fixture()
    for (const lureScale of [0, -0.5, 1.01]) {
      await expect(composeHeadShellWithLure({
        shellPath: input.shellPath,
        lurePath: input.lurePath,
        outputPath: join(input.directory, `invalid-scale-${lureScale}.png`),
        attachment: { x: 64, y: 72 },
        lureScale,
        outputSize: { width: 128, height: 128 },
        componentProvenance: input.componentProvenance,
      })).rejects.toThrow('lureScale must preserve content with a value in (0, 1]')
    }
  })

  it('rejects incomplete or inaccurate component provenance', async () => {
    const input = await fixture()
    const incomplete = {
      ...input.componentProvenance,
      lure: { ...input.componentProvenance.lure, promptSha256: '' },
    }
    await expect(composeHeadShellWithLure({
      shellPath: input.shellPath,
      lurePath: input.lurePath,
      outputPath: join(input.directory, 'incomplete.png'),
      attachment: { x: 64, y: 72 },
      lureScale: 1,
      outputSize: { width: 128, height: 128 },
      componentProvenance: incomplete as typeof input.componentProvenance,
    })).rejects.toThrow('Incomplete lure provenance: promptSha256')

    const inaccurate = {
      ...input.componentProvenance,
      shell: { ...input.componentProvenance.shell, processedSha256: '0'.repeat(64) },
    }
    await expect(composeHeadShellWithLure({
      shellPath: input.shellPath,
      lurePath: input.lurePath,
      outputPath: join(input.directory, 'inaccurate.png'),
      attachment: { x: 64, y: 72 },
      lureScale: 1,
      outputSize: { width: 128, height: 128 },
      componentProvenance: inaccurate,
    })).rejects.toThrow('head-shell processedSha256 does not match processedPath')
  })
})
