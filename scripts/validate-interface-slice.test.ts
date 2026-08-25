import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { validateInterfaceProductionReadiness, validateInterfaceSlice } from './validate-interface-slice.js'
import { renderInterfaceGuides } from './render-interface-guides.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function manifestFixture(): Promise<any> {
  return JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8'))
}

describe('validateInterfaceSlice', () => {
  it('validates manifest and deterministic guide inventory without requiring production art', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-slice-'))
    roots.push(root)
    const manifest = await manifestFixture()
    const manifestPath = join(root, 'interface-manifest.json')
    const guideRoot = join(root, 'guides')
    await mkdir(guideRoot, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
    await renderInterfaceGuides({ outputRoot: guideRoot, rigId: 'biped', profiles: manifest.assets.flatMap((asset: any) => asset.connectors.map((connector: any) => ({ ...connector, assetId: asset.id }))) })

    const result = await validateInterfaceSlice({ manifestPath, guideRoot })
    expect(result.ok).toBe(true)
    expect(result.productionAssetsChecked).toBe(0)
  }, 20_000)

  it('rejects stale guide resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-slice-'))
    roots.push(root)
    const manifestPath = join(root, 'interface-manifest.json')
    const guideRoot = join(root, 'guides')
    await mkdir(guideRoot, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(await manifestFixture())}\n`)
    await writeFile(join(guideRoot, 'stale.png'), 'stale')
    const result = await validateInterfaceSlice({ manifestPath, guideRoot })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_GUIDE_STALE' }))
  }, 20_000)

  it('rejects opaque or empty masks, transparent guides, renamed WebP, and deterministic drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-guide-negative-'))
    roots.push(root)
    const manifest = await manifestFixture()
    const manifestPath = join(root, 'interface-manifest.json')
    const guideRoot = join(root, 'guides')
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
    await renderInterfaceGuides({ outputRoot: guideRoot, rigId: 'biped', profiles: manifest.assets.flatMap((asset: any) => asset.connectors.map((connector: any) => ({ ...connector, assetId: asset.id }))) })
    const stems = manifest.assets.flatMap((asset: any) => asset.connectors.map((connector: any) => `${asset.id}-${connector.id}-${connector.role}`))
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toFile(join(guideRoot, `${stems[0]}-mask.png`))
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(join(guideRoot, `${stems[1]}-mask.png`))
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(join(guideRoot, `${stems[2]}-guide.png`))
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).webp().toFile(join(guideRoot, `${stems[3]}-guide.png`))
    const driftPath = join(guideRoot, `${stems[4]}-guide.png`)
    const drift = await readFile(driftPath)
    drift[drift.length - 1] = drift[drift.length - 1]! ^ 1
    await writeFile(driftPath, drift)
    const result = await validateInterfaceSlice({ manifestPath, guideRoot, repositoryRoot: process.cwd() })
    expect(result.diagnostics.filter(item => item.code === 'INTERFACE_GUIDE_INVALID').length).toBeGreaterThanOrEqual(4)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_GUIDE_DRIFT' }))
  }, 20_000)

  it('fails production readiness specifically for missing source art', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-production-'))
    roots.push(root)
    const manifest = await manifestFixture()
    const result = await validateInterfaceProductionReadiness({ repositoryRoot: root, manifest })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PRODUCTION_ASSET_MISSING' }))
    expect(result.diagnostics.filter(item => item.code === 'INTERFACE_PRODUCTION_ASSET_MISSING')).toHaveLength(21)
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'INTERFACE_MANIFEST_MISSING' }))
  })

  it('binds prompt evidence to the actual committed prompt catalog bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-prompts-'))
    roots.push(root)
    const manifest = await manifestFixture()
    manifest.assets[0].promptEvidence.promptSha256 = 'f'.repeat(64)
    manifest.assets[0].promptEvidence.promptId = 'missing-prompt-id'
    const manifestPath = join(root, 'interface-manifest.json')
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
    const result = await validateInterfaceSlice({
      manifestPath,
      guideRoot: join(process.cwd(), 'asset-source', 'v0.3.0', 'guides'),
      repositoryRoot: process.cwd(),
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PROMPT_HASH_MISMATCH' }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PROMPT_ID_MISSING' }))
  })

  it('rejects prompt and readiness symlinks that resolve outside the repository root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-symlink-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-interface-outside-'))
    roots.push(root, outside)
    const manifest = await manifestFixture()
    const outsidePrompt = join(outside, 'structural-prompts.json')
    await writeFile(outsidePrompt, JSON.stringify({ prompts: [] }))
    const promptTarget = join(root, 'asset-source', 'v0.3.0', 'prompts', 'structural-prompts.json')
    await mkdir(join(root, 'asset-source', 'v0.3.0', 'prompts'), { recursive: true })
    try {
      await symlink(outsidePrompt, promptTarget, 'file')
    } catch (caught: any) {
      if (caught?.code === 'EPERM' || caught?.code === 'EACCES') return
      throw caught
    }
    const manifestPath = join(root, 'interface-manifest.json')
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
    const promptResult = await validateInterfaceSlice({ manifestPath, guideRoot: join(process.cwd(), 'asset-source', 'v0.3.0', 'guides'), repositoryRoot: root })
    expect(promptResult.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PROMPT_PATH_INVALID' }))

    const source = manifest.assets[0].sourcePngPath
    const outsideSource = join(outside, 'source.png')
    await writeFile(outsideSource, 'outside')
    const sourceTarget = join(root, source)
    await mkdir(join(sourceTarget, '..'), { recursive: true })
    await symlink(outsideSource, sourceTarget, 'file')
    const otherSource = manifest.assets[1].sourcePngPath
    const otherDirectory = join(root, 'other-repository-subdir')
    await mkdir(otherDirectory)
    const otherFile = join(otherDirectory, 'source.png')
    await writeFile(otherFile, 'inside repository but outside canonical source root')
    const otherTarget = join(root, otherSource)
    await mkdir(join(otherTarget, '..'), { recursive: true })
    await symlink(otherFile, otherTarget, 'file')
    const readiness = await validateInterfaceProductionReadiness({ repositoryRoot: root, manifest })
    expect(readiness.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PRODUCTION_SOURCE_PATH_INVALID', path: ['productionAssets', '0'] }))
    expect(readiness.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PRODUCTION_SOURCE_PATH_INVALID', path: ['productionAssets', '1'] }))
  })
})
