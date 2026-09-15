import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'esbuild'
import { mutationSelectionsFromList, generateFelineCombination, COMBINATION_OPTIONS } from '@qmonster/generator-core'
import { auditFelineCombinationCatalog, FELINE_MUTATION_IDS } from '@qmonster/asset-catalog'

const additions = [
  ['halo', 'crown', 550, 45], ['dragon-wings', 'back', 60, 180],
  ['feathered-wings', 'back', 170, 300], ['frill-neck', 'neck', 150, 400], ['flame-tail', 'tailTip', 1100, 600],
] as const

describe('mutation tier batch 1', () => {
  it('accepts each new mutation and rejects competing choices in the same position', () => {
    for (const [id, slot] of additions) {
      expect(generateFelineCombination('new-option', mutationSelectionsFromList([id])).selections[slot]).toBe(id)
    }
    expect(() => mutationSelectionsFromList(['small-wings', 'dragon-wings'])).toThrow(/Conflicting/)
    expect(() => mutationSelectionsFromList(['small-lion-mane', 'frill-neck'])).toThrow(/Conflicting/)
    expect(() => mutationSelectionsFromList(['halo', 'antlers'])).toThrow(/Conflicting/)
    expect(() => mutationSelectionsFromList(['flame-tail', 'forked-tail-tip'])).toThrow(/Conflicting/)
  })

  it('requires all five shared projections for every coat', () => {
    const resource = (id: string) => ({ id, path: `assets/${id}.png`, sha256: 'a'.repeat(64), width: 1254, height: 1254,
      mediaType: 'image/png', hasAlpha: true, review: 'pending', provenance: { reference: 'docs/ref.png', prompt: 'docs/prompt.json' } })
    const mutations = [...new Set([...FELINE_MUTATION_IDS, ...additions.map(([id]) => id)])]
    const catalog = { schemaVersion: 'feline-combination-catalog-v1', catalogVersion: '0.10.0-candidate.1', templateVersion: 'feline-sit-v1', canvas: { width: 1254, height: 1254 },
      resources: Object.fromEntries(['body', ...mutations].map(id => [id, resource(id)])),
      bodies: Object.fromEntries(COMBINATION_OPTIONS.coat.map(coat => [coat, Object.fromEntries(COMBINATION_OPTIONS.expression.map(expression => [expression, 'body']))])),
      mutations: Object.fromEntries(COMBINATION_OPTIONS.coat.map(coat => [coat, Object.fromEntries(mutations.map(id => [id, id]))])),
    }
    expect(auditFelineCombinationCatalog(catalog)).toEqual([])
    delete catalog.mutations.tuxedo!.halo
    expect(auditFelineCombinationCatalog(catalog)).toEqual([expect.objectContaining({ path: ['mutations', 'tuxedo', 'halo'] })])
  })

  let browser: Browser
  let bundle: string
  beforeAll(async () => {
    bundle = (await build({ stdin: { contents: `export * as core from './packages/generator-core/src/index.ts'; export * as assets from './packages/asset-catalog/src/index.ts'; export * as renderer from './packages/renderer-canvas/src/index.ts';`, resolveDir: process.cwd() },
      bundle: true, write: false, format: 'iife', globalName: 'BatchApi', platform: 'browser' })).outputFiles[0]!.text
    browser = await chromium.launch({ headless: true })
  })
  afterAll(async () => { await browser?.close() })

  it.each(additions)('%s uses final coordinates, stays behind the body and needs no coat registration', async (id, slot, x, y) => {
    const page = await browser.newPage()
    try {
      await page.addScriptTag({ content: bundle })
      const pixels = await page.evaluate(async ({ id, slot, x, y }) => {
        const { core, assets, renderer } = (globalThis as any).BatchApi
        const resource = (name: string) => ({ id: name, path: `assets/${name}.png`, sha256: 'a'.repeat(64), width: 1254, height: 1254,
          mediaType: 'image/png', hasAlpha: true, review: 'pending', provenance: { reference: 'docs/ref.png', prompt: 'docs/prompt.json' } })
        const catalog = { schemaVersion: 'feline-combination-catalog-v1', catalogVersion: '0.10.0-candidate.1', templateVersion: 'feline-sit-v1', canvas: { width: 1254, height: 1254 },
          resources: { body: resource('body'), [id]: resource(id) }, bodies: { tuxedo: { 'parted-mouth': 'body' } }, mutations: { tuxedo: { [id]: id } } }
        const spec = core.generateFelineCombination('identity', { coat: 'tuxedo', expression: 'parted-mouth', ...core.mutationSelectionsFromList([id]) })
        const output = document.createElement('canvas')
        await renderer.renderFelineCombination(output, assets.resolveFelineCombination(spec, catalog), async (r: { id: string }) => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1254
          const context = canvas.getContext('2d')!
          if (r.id === 'body') { context.fillStyle = '#00ff00'; context.fillRect(400, 500, 450, 600) }
          else { context.fillStyle = '#ff0000'; context.fillRect(x, y, 5, 5); context.fillRect(500, 700, 5, 5) }
          return canvas
        })
        return [Array.from(output.getContext('2d')!.getImageData(x + 2, y + 2, 1, 1).data), Array.from(output.getContext('2d')!.getImageData(502, 702, 1, 1).data)]
      }, { id, slot, x, y })
      expect(pixels).toEqual([[255, 0, 0, 255], [0, 255, 0, 255]])
    } finally { await page.close() }
  })
})
