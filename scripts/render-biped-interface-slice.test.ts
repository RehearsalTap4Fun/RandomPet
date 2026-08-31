import { describe, expect, it } from 'vitest'
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { evaluateConnectorPair, type Catalog } from '@qmonster/generator-core'
import {
  buildBipedSliceManifest,
  bipedSliceViteServerOptions,
  browserCatalog,
  makeBipedSliceCatalog,
  withTemporaryBipedSliceInputRoot,
} from './render-biped-interface-slice.js'

describe('biped interface slice manifest', () => {
  it('keeps the approved tall-body and round-head neck geometry inside the formal warp envelope', async () => {
    const catalog = JSON.parse(await readFile(
      'packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8',
    )) as Catalog

    expect(evaluateConnectorPair(
      catalog, 'body_biped_tall', 'head_round_dome', 'biped', 'neck',
    )).toEqual(expect.objectContaining({ ok: true, depthRatio: 180 / 140 }))
  })

  it('maps palette rig masks to browser-loadable workspace URLs', async () => {
    const catalog = JSON.parse(await readFile(
      'packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8',
    )) as Catalog
    const browser = browserCatalog(catalog)
    const masks = browser.parts.find(part => part.id === 'color_deep_sea_coral')?.rigMaskPaths?.biped

    expect(Object.values(masks ?? {}).every(path => path.startsWith('/@fs/'))).toBe(true)
  })

  it('allows the disposable browser input root without exposing it in review delivery', () => {
    const inputRoot = resolve('outside-review-inputs')
    const options = bipedSliceViteServerOptions(inputRoot)

    expect(options.server?.fs?.allow).toContain(inputRoot)
  })

  it('renders every canonical two-by-two-by-two-by-two biped combination exactly once', async () => {
    const catalog = makeBipedSliceCatalog()
    const manifest = await buildBipedSliceManifest(catalog)

    expect(catalog.options.headShape).toEqual(['head_mushroom_cap', 'head_round_dome'])
    expect(manifest.entryCount).toBe(16)
    expect(manifest.entries).toHaveLength(16)
    expect(new Set(manifest.entries.map(item => item.structuralKey)).size).toBe(16)
    expect(new Set(manifest.entries.map(item => item.selections.headShape))).toEqual(
      new Set(['head_mushroom_cap', 'head_round_dome']),
    )
    expect(manifest.entries[0]?.structuralKey).toBe(
      'body_biped_peanut|head_mushroom_cap|arms_short_plush|legs_webbed',
    )
    expect(manifest.entries[15]?.structuralKey).toBe(
      'body_biped_tall|head_round_dome|arms_long_noodle|legs_mushroom',
    )
  })

  it('keeps browser input JSON outside review delivery and cleans it after failures', async () => {
    let temporaryRoot = ''
    await expect(withTemporaryBipedSliceInputRoot(async root => {
      temporaryRoot = root
      expect(resolve(root).startsWith(resolve('.'))).toBe(true)
      expect(resolve(root).startsWith(resolve('packages/asset-catalog/review/v0.3.0'))).toBe(false)
      await writeFile(resolve(root, '00.json'), '{"fixture":true}\n')
      throw new Error('fixture failure')
    })).rejects.toThrow('fixture failure')
    await expect(access(temporaryRoot)).rejects.toThrow()
    expect(await readdir('packages/asset-catalog/review/v0.3.0')).not.toContain('biped-vertical-slice-inputs')
  })
})
