import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import * as renderer from './index.js'

describe('feline combination rendering', () => {
  let browser: Browser
  let bundle: string
  beforeAll(async () => {
    const result = await build({ entryPoints: ['packages/renderer-canvas/src/feline-combination-render.ts'], bundle: true, write: false, format: 'iife', globalName: 'FelineRenderer', platform: 'browser' })
    bundle = result.outputFiles[0]!.text
    browser = await chromium.launch({ headless: true })
  })
  afterAll(async () => { await browser?.close() })

  async function exercise(mode = 'normal') {
    const page = await browser.newPage()
    try {
      await page.addScriptTag({ content: bundle })
      return await page.evaluate(async mode => {
        const api = (globalThis as any).FelineRenderer
        const make = (width = 1254, height = 1254) => Object.assign(document.createElement('canvas'), { width, height })
        const images: Record<string, HTMLCanvasElement> = {}
        const image = (id: string, color: string, rects: number[][]) => {
          const canvas = make(); const context = canvas.getContext('2d')!
          context.fillStyle = color
          for (const rect of rects) context.fillRect(...rect as [number, number, number, number])
          images[id] = canvas
        }
        // Deliberately simple source silhouettes: colored interiors let us test
        // compositing independently of texture quality or anti-aliased edges.
        // These anchors exercise the pending pilot registration, not art approval.
        image('back', '#ff0000', [[0, 0, 1254, 1254]])
        image('crown', '#0000ff', mode === 'dragon'
          ? [[300, 100, 40, 40], [540, 500, 80, 80]]
          : [[100, 500, 100, 100], [500, 1000, 100, 100]])
        image('body', '#00ff00', [[280, 60, 110, 180], [730, 60, 80, 240], [950, 450, 200, 200], [1050, 700, 100, 250], [920, 1000, 30, 50], [480, 300, 180, 330]])
        image('ears', '#ffff00', [[330, 95, 30, 30]])
        image('tailTip', '#ffff00', [[900, 450, 100, 100], [800, 650, 150, 450]])
        image('neck', '#ff00ff', [[400, 200, 500, 500]])
        const resource = (id: string) => ({ id, path: `synthetic/${id}.png`, sha256: 'a'.repeat(64), width: 1254, height: 1254, mediaType: 'image/png', hasAlpha: true, review: 'pending', provenance: { reference: 'synthetic/reference', prompt: 'synthetic/prompt' } })
        const draw = (slot: string) => ({ kind: 'draw', slot, resource: resource(slot) })
        const plan: any = {
          schemaVersion: 'feline-combination-render-plan-v1', catalogVersion: '0.10.0-candidate.1', templateVersion: 'feline-sit-v1', canvas: { width: 1254, height: 1254 },
          spec: { schemaVersion: 'feline-combination-v1', catalogVersion: '0.10.0-candidate.1', seed: 'synthetic',
            selections: { coat: 'orange-white', expression: 'parted-mouth', crown: 'antlers', ears: 'fin-ears', neck: 'small-lion-mane', back: 'small-wings', tailTip: 'forked-tail-tip' },
            rolls: { coat: 0, expression: 0, crown: 0, ears: 0, neck: 0, back: 0, tailTip: 0 }, locks: [] },
          operations: [draw('back'), draw('crown'), draw('body'), { kind: 'clear', region: 'ears' }, draw('ears'), { kind: 'clear', region: 'tailTip' }, draw('tailTip'), draw('neck')],
        }
        if (mode === 'version') plan.templateVersion = 'unowned-template'
        if (mode === 'coordinates') plan.operations[3].rect = [0, 0, 1254, 1254]
        if (mode === 'order') plan.operations.reverse()
        if (mode === 'missing-body') plan.operations = plan.operations.filter((op: any) => op.slot !== 'body')
        if (mode === 'spec-mismatch') plan.spec.selections.ears = 'none'
        if (mode === 'dragon') plan.spec.selections.crown = 'dragon-horns'
        const canvas = make(16, 16)
        const initialContext = canvas.getContext('2d')!
        initialContext.fillStyle = 'black'; initialContext.fillRect(0, 0, 16, 16)
        initialContext.translate(5, 5); initialContext.globalAlpha = 0.1
        const loaded: string[] = []
        const bitmaps: ImageBitmap[] = []
        const resolver = async (ref: any) => {
          loaded.push(ref.id)
          if (mode === 'mutating' && ref.id === 'back') { plan.operations.length = 0; plan.spec.selections.ears = 'none' }
          if (['missing', 'bitmap-failure'].includes(mode) && ref.id === 'neck') throw new Error('missing synthetic resource')
          if (mode === 'decode' && ref.id === 'body') return null
          if (mode === 'draw-invalid' && ref.id === 'body') return { width: 1254, height: 1254 }
          if (mode === 'dimension' && ref.id === 'body') return make(12, 12)
          if (mode === 'natural-dimension' && ref.id === 'body') {
            const image = new Image(1254, 1254); image.src = make(12, 12).toDataURL(); await image.decode(); return image
          }
          if (['bitmaps', 'bitmap-failure'].includes(mode)) { const bitmap = await createImageBitmap(images[ref.id]!); bitmaps.push(bitmap); return bitmap }
          return images[ref.id]
        }
        const factorySizes: number[][] = []
        let failure: string | null = null
        try {
          await api.renderFelineCombination(canvas, plan, resolver, { createCanvas(width: number, height: number) { factorySizes.push([width, height]); return mode === 'canvas-factory' ? canvas : make(width, height) } })
        } catch (error) { failure = String(error) }
        const context = canvas.getContext('2d')!
        const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data)
        const first = canvas.toDataURL()
        if (mode === 'normal') await api.renderFelineCombination(canvas, JSON.parse(JSON.stringify(plan)), resolver)
        return { failure, dimensions: [canvas.width, canvas.height], loaded: loaded.slice(0, 6), factorySizes, bitmapWidthsAfterRender: bitmaps.map(image => image.width),
          pixels: { clearedLeftEar: pixel(300, 100), crownBehindClearedEar: pixel(360, 120), clearedRightEar: pixel(760, 240), replacementEar: pixel(367, 80), clearedTail: pixel(1060, 600), replacementTail: pixel(1020, 540), bodyOverCrown: pixel(520, 320), bodyOverNeck: pixel(540, 600), visibleMane: pixel(420, 650), tailRootAboveFade: pixel(980, 700), tailRootWithinFade: pixel(980, 730), tailRootBelowFade: pixel(980, 770), removedOldStem: pixel(1130, 850), bodyOverTail: pixel(940, 1020), origin: pixel(0, 0), dragonTip: pixel(350, 55) },
          replayEqual: first === canvas.toDataURL() }
      }, mode)
    } finally { await page.close() }
  }

  it('exports the candidate render entry point', () => {
    expect(typeof (renderer as Record<string, unknown>).renderFelineCombination).toBe('function')
  })

  it('removes original ears and tail on the subject surface while retaining wings and crown behind', async () => {
    const result = await exercise()
    expect(result.failure).toBeNull()
    expect(result.dimensions).toEqual([1254, 1254])
    expect(result.pixels).toMatchObject({ clearedLeftEar: [0, 0, 0, 0], crownBehindClearedEar: [0, 0, 255, 255], clearedRightEar: [255, 0, 0, 255], replacementEar: [255, 255, 0, 255], clearedTail: [255, 0, 0, 255], replacementTail: [255, 255, 0, 255], bodyOverCrown: [0, 255, 0, 255], bodyOverNeck: [0, 255, 0, 255], visibleMane: [255, 0, 255, 255] })
    expect(result.loaded).toEqual(['back', 'crown', 'body', 'ears', 'tailTip', 'neck'])
    expect(result.factorySizes.length).toBeGreaterThan(0)
    expect(result.factorySizes.every(size => size[0] === 1254 && size[1] === 1254)).toBe(true)
    expect(result.replayEqual).toBe(true)
  })

  it('applies the owned dragon-horn registration before body occlusion', async () => {
    const result = await exercise('dragon')
    expect(result.failure).toBeNull()
    expect(result.pixels.dragonTip).toEqual([0, 0, 255, 255])
    expect(result.pixels.bodyOverCrown).toEqual([0, 255, 0, 255])
  })

  it('replaces the whole exposed tail without a mid-shaft fade and keeps the root behind the body', async () => {
    const result = await exercise()
    expect(result.failure).toBeNull()
    expect(result.pixels.tailRootAboveFade).toEqual([255, 255, 0, 255])
    expect(result.pixels.tailRootWithinFade).toEqual([255, 255, 0, 255])
    expect(result.pixels.tailRootBelowFade).toEqual([255, 255, 0, 255])
    expect(result.pixels.removedOldStem).toEqual([0, 0, 0, 0])
    expect(result.pixels.bodyOverTail).toEqual([0, 255, 0, 255])
    expect(result.pixels.replacementTail).toEqual([255, 255, 0, 255])
  })

  it('releases decoded bitmap ownership after the final draw', async () => {
    const result = await exercise('bitmaps')
    expect(result.failure).toBeNull()
    expect(result.pixels.visibleMane).toEqual([255, 0, 255, 255])
    expect(result.bitmapWidthsAfterRender).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('releases already decoded bitmaps when a later resource fails', async () => {
    const result = await exercise('bitmap-failure')
    expect(result.failure).toContain('missing synthetic resource')
    expect(result.pixels.visibleMane).toEqual([0, 0, 0, 0])
    expect(result.bitmapWidthsAfterRender).toEqual([0, 0, 0, 0, 0])
  })

  it('renders the captured plan even if its caller changes selections while resources load', async () => {
    const result = await exercise('mutating')
    expect(result.failure).toBeNull()
    expect(result.pixels.clearedRightEar).toEqual([255, 0, 0, 255])
    expect(result.pixels.bodyOverNeck).toEqual([0, 255, 0, 255])
    expect(result.pixels.visibleMane).toEqual([255, 0, 255, 255])
  })

  it.each(['missing', 'decode', 'dimension', 'natural-dimension', 'version', 'coordinates', 'order', 'missing-body', 'spec-mismatch', 'draw-invalid', 'canvas-factory'])('fails closed for %s without retaining a successful or partial image', async mode => {
    const result = await exercise(mode)
    expect(result.failure).not.toBeNull()
    expect(result.pixels.origin).toEqual([0, 0, 0, 0])
    expect(result.pixels.bodyOverCrown).toEqual([0, 0, 0, 0])
  })

  it.each([
    ['normal', null], ['missing', /HTTP 404/], ['hash', /SHA-256/], ['signature', /PNG/], ['decode', /decode/i], ['dimensions', /dimensions/i], ['rgb-no-alpha', /alpha channel missing/i],
  ] as const)('browser resource resolver verifies bytes and decoded PNG for %s', async (mode, failurePattern) => {
    const width = mode === 'dimensions' ? 12 : 1254
    const validPng = await sharp({ create: { width, height: width, channels: mode === 'rgb-no-alpha' ? 3 : 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png().toBuffer()
    // Keep a valid RGBA IHDR but omit image data so this exercises decode failure,
    // independently of the earlier PNG signature and alpha-header checks.
    const bytes = mode === 'signature' ? Buffer.from('not a PNG') : mode === 'decode' ? validPng.subarray(0, 33) : validPng
    if (mode === 'rgb-no-alpha') expect((await sharp(bytes).metadata()).hasAlpha).toBe(false)
    const digest = mode === 'hash' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex')
    const page = await browser.newPage()
    try {
      await page.route('http://localhost/**', route => route.request().url().endsWith('/test.png')
        ? route.fulfill({ status: mode === 'missing' ? 404 : 200, contentType: 'image/png', body: bytes })
        : route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><title>synthetic canvas test</title>' }))
      await page.goto('http://localhost/')
      await page.addScriptTag({ content: bundle })
      const result = await page.evaluate(async digest => {
        const resource = { id: 'test', path: 'asset/path.png', sha256: digest, width: 1254, height: 1254, mediaType: 'image/png', hasAlpha: true, review: 'pending', provenance: { reference: 'test/reference', prompt: 'test/prompt' } }
        try {
          const resolver = (globalThis as any).FelineRenderer.createFelineCombinationResourceResolver((ref: any) => {
            if (ref.path !== 'asset/path.png') throw new Error('Incorrect resource URL lookup')
            return 'http://localhost/test.png'
          })
          const bitmap = await resolver(resource)
          const dimensions = [bitmap.width, bitmap.height]
          bitmap.close()
          return { failure: null, dimensions }
        } catch (error) { return { failure: String(error), dimensions: [] } }
      }, digest)
      if (failurePattern) expect(result.failure).toMatch(failurePattern)
      else { expect(result.failure).toBeNull(); expect(result.dimensions).toEqual([1254, 1254]) }
    } finally { await page.close() }
  })
})
