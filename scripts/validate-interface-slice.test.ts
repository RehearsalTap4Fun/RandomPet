import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { validateInterfaceProductionReadiness, validateInterfaceSlice } from './validate-interface-slice.js'

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
    const guideSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048"><rect x="900" y="900" width="200" height="200" fill="white"/></svg>')
    const maskPixel = Buffer.from([255, 255, 255, 255])
    for (const asset of manifest.assets) {
      for (const connector of asset.connectors) {
        const stem = `${asset.id}-${connector.id}-${connector.role}`
        await sharp(guideSvg).png().toFile(join(guideRoot, `${stem}-guide.png`))
        await sharp(maskPixel, { raw: { width: 1, height: 1, channels: 4 } }).resize(2048, 2048, { kernel: 'nearest' }).png().toFile(join(guideRoot, `${stem}-mask.png`))
      }
    }

    const result = await validateInterfaceSlice({ manifestPath, guideRoot })
    expect(result.ok).toBe(true)
    expect(result.productionAssetsChecked).toBe(0)
  })

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
  })

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
})
