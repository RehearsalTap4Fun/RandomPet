import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'esbuild'

describe('body art study isolation', () => {
  let browser: Browser
  let bundle: string
  beforeAll(async () => {
    bundle = (await build({ entryPoints: ['packages/renderer-canvas/src/index.ts'], bundle: true, write: false,
      format: 'iife', globalName: 'Study', platform: 'browser' })).outputFiles[0]!.text
    browser = await chromium.launch({ headless: true })
  })
  afterAll(async () => { await browser?.close() })

  async function run(mode: string) {
    const page = await browser.newPage()
    try {
      await page.addScriptTag({ content: bundle })
      return await page.evaluate(async mode => {
        const api = (globalThis as any).Study
        if (typeof api.renderFelineBodyStudy !== 'function') return { failure: 'body study unavailable', pixels: [], replay: false }
        const resource = (id: string) => ({ id, path: `assets/${id}.png`, sha256: 'a'.repeat(64), width: 1254, height: 1254,
          mediaType: 'image/png', hasAlpha: true, review: 'pending', provenance: { reference: 'docs/reference.png', prompt: 'docs/prompt.json' } })
        const identity = { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 }
        const phenotype = { body: 'shortleg-round', coat: 'orange-white', expression: 'small-fangs' }
        const spec: any = { schemaVersion: 'feline-body-study-v1', profileId: 'shortleg-round-v1', phenotype,
          mutations: ['small-wings', 'fin-ears', 'flame-tail'] }
        const profile: any = { schemaVersion: 'feline-body-art-profile-v1', id: 'shortleg-round-v1', phenotype,
          canvas: { width: 1254, height: 1254 }, body: resource('body'),
          mutations: {
            'small-wings': { resource: resource('wings'), transform: identity },
            'fin-ears': { resource: resource('ears'), transform: identity },
            'flame-tail': { resource: resource('tail'), transform: identity },
          },
          removal: { ears: [[[100, 100], [200, 100], [200, 200], [100, 200]]],
            tailTip: [[[900, 400], [1200, 400], [1200, 1100], [900, 1100]]] } }
        if (mode === 'coat') spec.phenotype = { ...phenotype, coat: 'tuxedo' }
        if (mode === 'profile') spec.profileId = 'unknown'
        if (mode === 'conflict') spec.mutations.push('dragon-wings')
        if (mode === 'missing-mapping') delete profile.mutations['flame-tail']
        if (mode === 'bad-geometry') profile.removal.ears[0][0][0] = NaN
        if (mode.startsWith('mane')) {
          spec.mutations = ['small-wings', 'small-lion-mane']
          profile.mutations['small-lion-mane'] = { resource: resource('mane'), transform: identity,
            occlusion: { polygons: [[[400, 400], [600, 400], [600, 600], [400, 600]]], feather: 8 } }
          if (mode === 'mane-missing-mask') delete profile.mutations['small-lion-mane'].occlusion
        }
        const make = () => Object.assign(document.createElement('canvas'), { width: 1254, height: 1254 })
        const canvas = make(); canvas.getContext('2d')!.fillRect(0, 0, 1254, 1254)
        let touched = false
        const resolve = async (r: { id: string }) => {
          if (mode === 'loading-failure' && r.id === 'tail') throw new Error('missing tail PNG')
          if (mode === 'mutation-during-load' && !touched) { touched = true; profile.removal.ears = []; profile.mutations = {}; spec.mutations = [] }
          const c = make(), ctx = c.getContext('2d')!
          if (r.id === 'body') { ctx.fillStyle = '#00ff00'; ctx.fillRect(100, 100, 100, 100); ctx.fillRect(1000, 500, 100, 100); ctx.fillRect(400, 400, 200, 500) }
          if (r.id === 'wings') { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 1254, 1254) }
          if (r.id === 'ears') { ctx.fillStyle = '#0000ff'; ctx.fillRect(100, 50, 100, 40) }
          if (r.id === 'tail') { ctx.fillStyle = '#ffff00'; ctx.fillRect(1000, 700, 100, 100) }
          if (r.id === 'mane') { ctx.fillStyle = '#0000ff'; ctx.fillRect(300, 400, 400, 500) }
          return c
        }
        let failure = null
        try { await api.renderFelineBodyStudy(canvas, spec, profile, resolve) }
        catch (error) { failure = String(error) }
        const first = canvas.toDataURL()
        if (!failure && (mode === 'normal' || mode === 'mane')) await api.renderFelineBodyStudy(canvas, JSON.parse(JSON.stringify(spec)), JSON.parse(JSON.stringify(profile)), resolve)
        const ctx = canvas.getContext('2d')!
        return { failure, pixels: [[150, 150], [1050, 550], [150, 70], [1050, 750], [500, 500]].map(([x, y]) => Array.from(ctx.getImageData(x!, y!, 1, 1).data)),
          manePixels: [[500, 750], [350, 750], [100, 300]].map(([x, y]) => Array.from(ctx.getImageData(x!, y!, 1, 1).data)), replay: first === canvas.toDataURL() }
      }, mode)
    } finally { await page.close() }
  }

  it('uses body-specific removal regions while retaining wings behind the removed ears and tail', async () => {
    const result = await run('normal')
    expect(result.failure).toBeNull()
    expect(result.pixels).toEqual([[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255], [0, 255, 0, 255]])
    expect(result.replay).toBe(true)
  })
  it('captures phenotype and art profile before asynchronous resource loading', async () => {
    const result = await run('mutation-during-load')
    expect(result.failure).toBeNull()
    expect(result.pixels[0]).toEqual([255, 0, 0, 255])
    expect(result.pixels[3]).toEqual([255, 255, 0, 255])
  })
  it('places mane over the chest and wings while the protected face remains above the mane', async () => {
    const result = await run('mane')
    expect(result.failure).toBeNull()
    expect(result.pixels[4]).toEqual([0, 255, 0, 255])
    expect(result.manePixels).toEqual([[0, 0, 255, 255], [0, 0, 255, 255], [255, 0, 0, 255]])
    expect(result.replay).toBe(true)
  })
  it.each(['coat', 'profile', 'conflict', 'missing-mapping', 'bad-geometry', 'loading-failure', 'mane-missing-mask'])('rejects %s and clears any previous or partial output', async mode => {
    const result = await run(mode)
    expect(result.failure).not.toBeNull()
    expect(result.pixels).toEqual(Array.from({ length: 5 }, () => [0, 0, 0, 0]))
  })
})
