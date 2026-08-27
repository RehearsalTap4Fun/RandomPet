import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRuntimeAsset, buildVersionedRuntimeAssets, runtimeAssetBuildPaths } from './build-runtime-assets.js'

const temporaryDirectories: string[] = []
const execFile = promisify(execFileCallback)

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('buildRuntimeAsset', () => {
  it('propagates a non-missing runtime source directory read failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-runtime-read-error-'))
    temporaryDirectories.push(root)
    const partDirectory = join(root, 'asset-source', 'v0.2.0', 'parts')
    await mkdir(partDirectory, { recursive: true })
    await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ffffffff' } }).png().toFile(join(partDirectory, 'eyes.png'))
    await writeFile(join(root, 'asset-source', 'v0.2.0', 'rigs'), 'not a directory')

    await expect(buildVersionedRuntimeAssets('0.2.0', { repositoryRoot: root })).rejects.toMatchObject({
      code: expect.stringMatching(/ENOTDIR|EISDIR/u),
    })
  })

  it('does not execute when imported by a same-named entry module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-runtime-import-'))
    temporaryDirectories.push(root)
    const importer = join(root, 'build-runtime-assets.ts')
    const target = pathToFileURL(join(process.cwd(), 'scripts', 'build-runtime-assets.ts')).href
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
    await writeFile(importer, `import ${JSON.stringify(target)}\nconsole.log('imported')\n`)

    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), importer,
    ])).resolves.toMatchObject({ stdout: 'imported\n' })
  }, 30_000)

  it('builds source PNGs into the explicit version production asset root through the CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-runtime-cli-'))
    temporaryDirectories.push(root)
    const sourcePath = join(root, 'asset-source', 'v0.2.0', 'parts', 'eyes_test.png')
    await mkdir(join(root, 'asset-source', 'v0.2.0', 'parts'), { recursive: true })
    await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } },
    }).png().toFile(sourcePath)

    const result = await execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'scripts', 'build-runtime-assets.ts'),
      '--version', '0.2.0',
    ], { cwd: root })
    const outputPath = join(root, 'packages', 'asset-catalog', 'assets', 'v0.2.0', 'parts', 'eyes_test.webp')

    await expect(sharp(await readFile(outputPath)).metadata()).resolves.toMatchObject({ format: 'webp', width: 1024, height: 1024 })
    expect(JSON.parse(result.stdout)).toMatchObject({ built: 1, assetDirectory: 'packages/asset-catalog/assets/v0.2.0' })
  })

  it('rejects a runtime CLI invocation without an explicit version', async () => {
    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(process.cwd(), 'scripts', 'build-runtime-assets.ts'),
    ])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Usage:') })
  })

  it('uses an explicit release version to select production roots', () => {
    expect(runtimeAssetBuildPaths('0.2.0')).toMatchObject({
      sourceRoot: 'asset-source/v0.2.0',
      assetDirectory: 'packages/asset-catalog/assets/v0.2.0',
    })
  })

  it('converts a 2048 RGBA master to 1024 lossless WebP and reports exact hashes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qmonster-runtime-'))
    temporaryDirectories.push(directory)
    const sourcePath = join(directory, 'source.png')
    const runtimePath = join(directory, 'runtime.webp')
    await sharp({
      create: { width: 2048, height: 2048, channels: 4, background: { r: 41, g: 173, b: 202, alpha: 0.37 } },
    }).png().toFile(sourcePath)

    const source = await readFile(sourcePath)
    const result = await buildRuntimeAsset({ sourcePath, runtimePath, sourceId: 'test-part' })
    const runtime = await readFile(runtimePath)
    const metadata = await sharp(runtime).metadata()
    const alpha = await sharp(runtime).ensureAlpha().extractChannel('alpha').raw().toBuffer()

    expect(metadata).toMatchObject({ format: 'webp', width: 1024, height: 1024, hasAlpha: true })
    expect(new Set(alpha)).toEqual(new Set([94]))
    expect(result).toEqual({
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      runtimeSha256: createHash('sha256').update(runtime).digest('hex'),
    })
  })
})
