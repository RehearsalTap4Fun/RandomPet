import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { validateAssetFile, validateCatalogFiles } from './file-validation.js'

const temporaryDirectories: string[] = []
const execFile = promisify(execFileCallback)

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('validateCatalogFiles', () => {
  it('accepts compact non-square composition-node assets when explicitly requested', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'qmonster-node-assets-'))
    temporaryDirectories.push(tempRoot)
    const png = await sharp({ create: { width: 137, height: 241, channels: 4, background: '#ffffffff' } }).png().toBuffer()
    await writeFile(join(tempRoot, 'node.png'), png)

    expect(await validateAssetFile(await realpath(tempRoot), 'node.png', createHash('sha256').update(png).digest('hex'), ['node'], { dimensions: 'trimmed-node' })).toEqual([])
  })

  it('validates both WebP and PNG runtime paths and hashes', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'qmonster-assets-'))
    temporaryDirectories.push(tempRoot)
    const png = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } }).png().toBuffer()
    const webp = await sharp(png).webp({ lossless: true }).toBuffer()
    await writeFile(join(tempRoot, 'part.png'), png)
    await writeFile(join(tempRoot, 'part.webp'), webp)
    const catalog = makeValidCatalogFixture()
    for (const part of catalog.parts) {
      part.assetPath = 'part.webp'
      part.assetSha256 = createHash('sha256').update(webp).digest('hex')
      part.pngPath = 'part.png'
      part.pngSha256 = '0'.repeat(64)
    }

    const diagnostics = await validateCatalogFiles(catalog, tempRoot)

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'ASSET_HASH_MISMATCH', path: expect.arrayContaining(['pngPath']) }))
  })

  it('validates every rig-specific primary, secondary, and accent mask hash', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'qmonster-rig-masks-'))
    temporaryDirectories.push(tempRoot)
    const png = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffffffff' } }).png().toBuffer()
    await writeFile(join(tempRoot, 'valid.png'), png)
    const validHash = createHash('sha256').update(png).digest('hex')
    const catalog = makeValidCatalogFixture()
    for (const part of catalog.parts) part.assetPath = 'valid.png'
    const color = catalog.parts.find(part => part.slotId === 'colorScheme')!
    color.rigMaskPaths = {
      blob: { primary: 'valid.png', secondary: 'valid.png', accent: 'valid.png' },
    }
    color.rigMaskSha256 = {
      blob: { primary: '0'.repeat(64), secondary: validHash, accent: validHash },
    }

    const diagnostics = await validateCatalogFiles(catalog, tempRoot)

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'ASSET_HASH_MISMATCH',
      path: expect.arrayContaining(['rigMaskPaths', 'blob', 'primary']),
    }))
  })

  it('reports non-square RGB assets without alpha', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'qmonster-assets-'))
    temporaryDirectories.push(tempRoot)
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toFile(join(tempRoot, 'valid.png'))
    await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 20, g: 30, b: 40 } } })
      .png()
      .toFile(join(tempRoot, 'invalid.png'))
    const catalog = makeValidCatalogFixture()
    for (const part of catalog.parts) part.assetPath = 'valid.png'
    catalog.parts[1]!.assetPath = 'invalid.png'

    expect(await validateCatalogFiles(catalog, tempRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ASSET_DIMENSION_INVALID' }),
        expect.objectContaining({ code: 'ASSET_ALPHA_MISSING' }),
      ]),
    )
  })

  it('rejects paths that escape the asset root', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'qmonster-assets-'))
    temporaryDirectories.push(tempRoot)
    const catalog = makeValidCatalogFixture()
    for (const part of catalog.parts) part.assetPath = '../outside.png'

    expect(await validateCatalogFiles(catalog, tempRoot)).toContainEqual(
      expect.objectContaining({ code: 'ASSET_PATH_OUTSIDE_ROOT' }),
    )
  })

  it('rejects assets that escape the root through a directory link', async () => {
    const tempBase = await mkdtemp(join(tmpdir(), 'qmonster-assets-'))
    temporaryDirectories.push(tempBase)
    const tempRoot = join(tempBase, 'assets')
    const outsideRoot = join(tempBase, 'outside')
    await mkdir(tempRoot)
    await mkdir(outsideRoot)
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toFile(join(outsideRoot, 'escaped.png'))
    await symlink(outsideRoot, join(tempRoot, 'linked-outside'), 'junction')
    const catalog = makeValidCatalogFixture()
    for (const part of catalog.parts) part.assetPath = 'linked-outside/escaped.png'

    expect(await validateCatalogFiles(catalog, tempRoot)).toContainEqual(
      expect.objectContaining({ code: 'ASSET_PATH_OUTSIDE_ROOT' }),
    )
  })

  it('rejects an AVIF payload disguised with a PNG filename', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'qmonster-assets-'))
    temporaryDirectories.push(tempRoot)
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .avif()
      .toFile(join(tempRoot, 'misnamed.png'))
    const catalog = makeValidCatalogFixture()
    for (const part of catalog.parts) part.assetPath = 'misnamed.png'

    expect(await validateCatalogFiles(catalog, tempRoot)).toContainEqual(
      expect.objectContaining({ code: 'ASSET_FORMAT_INVALID' }),
    )
  })

  it('returns a nonzero CLI status when file diagnostics are present', async () => {
    await expect(execFile(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'src/cli.ts', 'catalog/fixtures/minimal-valid.json', 'catalog/fixtures',
    ], { cwd: join(process.cwd(), 'packages', 'asset-catalog') })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('ASSET_FILE_MISSING'),
    })
  })
})
