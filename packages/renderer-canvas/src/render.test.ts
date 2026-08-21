import { describe, expect, it } from 'vitest'
import {
  VISUAL_SLOT_IDS,
  type Catalog,
  type MonsterSpec,
  type Palette,
  type RenderLayer,
} from '@qmonster/generator-core'
import {
  makeValidCatalogFixture,
  makeValidMonsterSpecFixture,
} from '@qmonster/generator-core/test-fixtures'
import { resolvePlacement } from './layout.js'
import { expandRenderLayers, RENDER_LAYER_ORDER } from './layers.js'
import { renderMonster } from './render.js'
import type { ImageResolver, RenderOptions } from './types.js'

interface FakeImage {
  id: string
}

function image(id: string): CanvasImageSource {
  return { id } as unknown as CanvasImageSource
}

function makeResolver(missingPaths: ReadonlySet<string> = new Set()): ImageResolver {
  return {
    async resolve(assetPath) {
      if (missingPaths.has(assetPath)) throw new Error(`missing ${assetPath}`)
      return image(assetPath)
    },
  }
}

function makeRecordingContext(calls: string[], prefix = ''): CanvasRenderingContext2D {
  let fillStyle = ''
  let composite = 'source-over'
  return {
    save: () => calls.push(`${prefix}save`),
    restore: () => calls.push(`${prefix}restore`),
    translate: (x: number, y: number) => calls.push(`${prefix}translate:${x},${y}`),
    scale: (x: number, y: number) => calls.push(`${prefix}scale:${x},${y}`),
    drawImage: (source: CanvasImageSource) => {
      calls.push(`${prefix}draw:${(source as unknown as FakeImage).id}`)
    },
    fillRect: (x: number, y: number, width: number, height: number) => {
      calls.push(`${prefix}fillRect:${x},${y},${width},${height}:${fillStyle}`)
    },
    clearRect: (x: number, y: number, width: number, height: number) => {
      calls.push(`${prefix}clearRect:${x},${y},${width},${height}`)
    },
    fillText: (text: string, x: number, y: number) => calls.push(`${prefix}text:${text}:${x},${y}`),
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = String(value)
      calls.push(`${prefix}fillStyle:${fillStyle}`)
    },
    get fillStyle() {
      return fillStyle
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      composite = value
      calls.push(`${prefix}composite:${value}`)
    },
    get globalCompositeOperation() {
      return composite as GlobalCompositeOperation
    },
    set font(value: string) {
      calls.push(`${prefix}font:${value}`)
    },
    get font() {
      return '16px sans-serif'
    },
    set textAlign(value: CanvasTextAlign) {
      calls.push(`${prefix}textAlign:${value}`)
    },
    get textAlign() {
      return 'left' as CanvasTextAlign
    },
    set textBaseline(value: CanvasTextBaseline) {
      calls.push(`${prefix}textBaseline:${value}`)
    },
    get textBaseline() {
      return 'alphabetic' as CanvasTextBaseline
    },
  } as unknown as CanvasRenderingContext2D
}

function makeCanvasBackedRecordingContext(calls: string[]): CanvasRenderingContext2D {
  let nextCanvas = 0
  const context = makeRecordingContext(calls, 'main:')
  const ownerDocument = {
    createElement() {
      const id = `buffer-${nextCanvas += 1}`
      const canvas = {
        id,
        width: 0,
        height: 0,
        getContext: () => makeRecordingContext(calls, `${id}:`),
      }
      return canvas
    },
  }
  Object.defineProperty(context, 'canvas', { value: { ownerDocument } })
  return context
}

function makeRecordingSurfaceFactory(calls: string[]) {
  let nextCanvas = 0
  return () => {
    const id = `injected-${nextCanvas += 1}`
    return {
      canvas: image(id),
      context: makeRecordingContext(calls, `${id}:`),
    }
  }
}

const options1024: RenderOptions = {
  width: 1024,
  height: 1024,
  includeGroundShadow: true,
}

function part(catalog: Catalog, id: string) {
  const found = catalog.parts.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`Missing fixture part ${id}`)
  return found
}

function fixtureWithNineGroups(): { catalog: Catalog; spec: MonsterSpec; expected: string[] } {
  const catalog = makeValidCatalogFixture()
  const spec = makeValidMonsterSpecFixture()
  const layers: Partial<Record<string, RenderLayer>> = {
    tail_anchor: 'groundShadow',
    extra_wings: 'rearAppendage',
  }
  for (const candidate of catalog.parts) {
    const layer = layers[candidate.id]
    if (layer !== undefined) candidate.layer = layer
  }
  return {
    catalog,
    spec,
    expected: [
      'tail_anchor',
      'extra_wings',
      'body_blob',
      'surface_gel',
      'pattern_spots', 'color_scheme_ocean',
      'arms_short', 'legs_webbed',
      'head_round',
      'eyes_asymmetric', 'mouth_wide', 'oral_teeth', 'head_antennae',
      'effect_glow',
    ],
  }
}

describe('socket placement', () => {
  it('aligns a part origin to the body socket', () => {
    expect(resolvePlacement(
      { x: 620, y: 360 },
      { x: 40, y: 50 },
      { scale: 1, mirrorX: false },
      [],
    )).toEqual({ ok: true, value: { x: 580, y: 310, scaleX: 1, scaleY: 1 } })
  })

  it('accounts for approved mirror and scale when aligning the origin', () => {
    const transform = { scale: 0.5, mirrorX: true }
    expect(resolvePlacement(
      { x: 620, y: 360 },
      { x: 40, y: 50 },
      transform,
      [transform],
    )).toEqual({ ok: true, value: { x: 640, y: 335, scaleX: -0.5, scaleY: 0.5 } })
  })

  it('rejects transforms absent from the part preset list without clamping', () => {
    expect(resolvePlacement(
      { x: 620, y: 360 },
      { x: 40, y: 50 },
      { scale: 0.75, mirrorX: true },
      [{ scale: 1, mirrorX: false }],
    )).toMatchObject({
      ok: false,
      diagnostic: { severity: 'error', code: 'RENDER_PRESET_INVALID' },
    })
  })
})

describe('render layer expansion', () => {
  it('uses the fixed nine render groups from back to front', async () => {
    const { catalog, spec, expected } = fixtureWithNineGroups()
    const calls: string[] = []

    const result = await renderMonster(
      makeRecordingContext(calls), spec, catalog, makeResolver(), options1024,
    )

    expect(RENDER_LAYER_ORDER).toEqual([
      'groundShadow', 'rearAppendage', 'body', 'surface', 'pattern',
      'frontAppendage', 'head', 'faceAndHeadwear', 'foregroundEffect',
    ])
    expect(result.drawnAssetIds).toEqual(expected)
    expect(calls.filter(call => call.startsWith('draw:'))).toEqual(
      expected.map(id => `draw:parts/${id}.webp`),
    )
  })

  it('omits only the ground shadow group when requested', async () => {
    const { catalog, spec, expected } = fixtureWithNineGroups()
    const result = await renderMonster(
      makeRecordingContext([]),
      spec,
      catalog,
      makeResolver(),
      { ...options1024, includeGroundShadow: false },
    )

    expect(result.drawnAssetIds).toEqual(expected.slice(1))
  })

  it('duplicates the head layer at the catalog-approved alternate socket', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    const result = expandRenderLayers(spec, catalog)
    const heads = result.layers.filter(layer => layer.slotId === 'headShape')

    expect(result.diagnostics).toEqual([])
    expect(heads.map(layer => layer.socketName)).toEqual(['head', 'headAlternate'])
  })

  it('resolves the duplicated head at the alternate socket placement', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }
    const calls: string[] = []

    await renderMonster(makeRecordingContext(calls), spec, catalog, makeResolver(), options1024)

    expect(calls).toContain('translate:296,-264')
  })

  it('moves the eye layer to the alternate socket instead of duplicating it', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'aberration_misplaced_eye')!
    spec.aberrations = [{ id: modifier.id, overrides: structuredClone(modifier.overrides) }]

    const result = expandRenderLayers(spec, catalog)
    const eyes = result.layers.filter(layer => layer.slotId === 'eyes')

    expect(result.diagnostics).toEqual([])
    expect(eyes).toHaveLength(1)
    expect(eyes[0]!.socketName).toBe('headAlternate')
  })

  it('blocks an expansion whose alternate socket is absent', () => {
    const catalog = makeValidCatalogFixture()
    for (const rig of catalog.rigs) delete rig.sockets.headAlternate
    const spec = makeValidMonsterSpecFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    const result = expandRenderLayers(spec, catalog)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'RENDER_SOCKET_MISSING',
    }))
    expect(result.layers.filter(layer => layer.slotId === 'headShape')).toHaveLength(1)
  })

  it('blocks modifier payloads that do not match the catalog definition', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    spec.mutation = {
      id: 'mutation_double_head',
      overrides: { duplicateLayerGroup: 'head', socket: 'head' },
    }

    const result = expandRenderLayers(spec, catalog)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'RENDER_MODIFIER_INVALID',
    }))
    expect(result.layers.filter(layer => layer.slotId === 'headShape')).toHaveLength(1)
  })

  it('blocks a direct double-head definition and application missing their socket', () => {
    const catalog = makeValidCatalogFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'mutation_double_head')!
    delete modifier.overrides.socket
    const spec = makeValidMonsterSpecFixture()
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    const result = expandRenderLayers(spec, catalog)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'RENDER_MODIFIER_INVALID',
    }))
    expect(result.layers.filter(layer => layer.slotId === 'headShape')).toHaveLength(1)
  })

  it('blocks a direct misplaced-eye definition and application missing their socket', () => {
    const catalog = makeValidCatalogFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'aberration_misplaced_eye')!
    delete modifier.overrides.socket
    const spec = makeValidMonsterSpecFixture()
    spec.aberrations = [{ id: modifier.id, overrides: structuredClone(modifier.overrides) }]

    const result = expandRenderLayers(spec, catalog)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'RENDER_MODIFIER_INVALID',
    }))
    expect(result.layers.filter(layer => layer.slotId === 'eyes')).toHaveLength(1)
    expect(result.layers.find(layer => layer.slotId === 'eyes')!.socketName).toBe('head')
  })

  it('does not mutate the MonsterSpec while expanding modifiers', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }
    const snapshot = structuredClone(spec)

    expandRenderLayers(spec, catalog)

    expect(spec).toEqual(snapshot)
  })
})

describe('canvas rendering', () => {
  it('applies 1024 and 2048 output scaling from normalized master coordinates', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const calls1024: string[] = []
    const calls2048: string[] = []

    await renderMonster(makeRecordingContext(calls1024), spec, catalog, makeResolver(), options1024)
    await renderMonster(makeRecordingContext(calls2048), spec, catalog, makeResolver(), {
      width: 2048, height: 2048, includeGroundShadow: true,
    })

    expect(calls1024.slice(0, 2)).toEqual(['save', 'scale:0.5,0.5'])
    expect(calls2048.slice(0, 2)).toEqual(['save', 'scale:1,1'])
  })

  it('draws primary and secondary masks with deterministic palette composites', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const body = part(catalog, 'body_blob')
    body.maskPaths = { primary: 'masks/body-primary.png', secondary: 'masks/body-secondary.png' }
    const albino: Palette = { primary: '#f4f0e8', secondary: '#ddd4c8', accent: '#d98e9b' }
    spec.mutation = { id: 'mutation_albino', overrides: { palette: albino } }
    const calls: string[] = []

    const result = await renderMonster(
      makeRecordingContext(calls),
      spec,
      catalog,
      makeResolver(),
      { ...options1024, surfaceFactory: makeRecordingSurfaceFactory(calls) },
    )

    expect(result.diagnostics).toEqual([])
    expect(calls).toContain('injected-2:draw:masks/body-primary.png')
    expect(calls).toContain('injected-2:draw:masks/body-secondary.png')
    expect(calls).toContain('injected-2:fillStyle:#f4f0e8')
    expect(calls).toContain('injected-2:fillStyle:#ddd4c8')
    expect(calls.filter(call => call === 'injected-2:composite:source-in')).toHaveLength(2)
  })

  it('isolates mask composites from layers already drawn on the destination canvas', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    part(catalog, 'body_blob').maskPaths = { primary: 'masks/body-primary.png' }
    const calls: string[] = []

    await renderMonster(
      makeCanvasBackedRecordingContext(calls), spec, catalog, makeResolver(), options1024,
    )

    expect(calls).not.toContain('main:composite:source-in')
    expect(calls.some(call => /^buffer-\d+:composite:source-in$/.test(call))).toBe(true)
    expect(calls.some(call => /^main:draw:buffer-\d+$/.test(call))).toBe(true)
  })

  it('reports unavailable mask surfaces without changing destination composite state', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    part(catalog, 'body_blob').maskPaths = { primary: 'masks/body-primary.png' }
    const calls: string[] = []
    const context = makeRecordingContext(calls)

    const result = await renderMonster(context, spec, catalog, makeResolver(), options1024)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'RENDER_SURFACE_UNAVAILABLE',
      path: ['parts', 'body_blob', 'maskPaths'],
    }))
    expect(context.globalCompositeOperation).toBe('source-over')
    expect(calls).not.toContain('composite:source-in')
    expect(result.drawnAssetIds).not.toContain('body_blob')
    expect(result.drawnAssetIds).toContain('effect_glow')
  })

  it('uses an injected surface factory when the destination has no browser canvas', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    part(catalog, 'body_blob').maskPaths = { primary: 'masks/body-primary.png' }
    const calls: string[] = []

    const result = await renderMonster(
      makeRecordingContext(calls),
      spec,
      catalog,
      makeResolver(),
      { ...options1024, surfaceFactory: makeRecordingSurfaceFactory(calls) },
    )

    expect(result.diagnostics).toEqual([])
    expect(calls.some(call => /^injected-\d+:composite:source-in$/.test(call))).toBe(true)
    expect(calls.some(call => /^draw:injected-\d+$/.test(call))).toBe(true)
  })

  it('reports every missing image and draws labeled magenta checker placeholders', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const missing = new Set(['parts/eyes_asymmetric.webp', 'parts/effect_glow.webp'])
    const calls: string[] = []

    const result = await renderMonster(
      makeRecordingContext(calls), spec, catalog, makeResolver(missing), options1024,
    )

    expect(result.diagnostics.filter(item => item.code === 'ASSET_LOAD_FAILED')).toHaveLength(2)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', path: ['parts', 'eyes_asymmetric'] }),
      expect.objectContaining({ severity: 'error', path: ['parts', 'effect_glow'] }),
    ]))
    expect(calls).toContain('fillStyle:#ff00ff')
    expect(calls.some(call => call.startsWith('text:eyes_asymmetric:'))).toBe(true)
    expect(calls.some(call => call.startsWith('text:effect_glow:'))).toBe(true)
    expect(result.drawnAssetIds).not.toContain('eyes_asymmetric')
    expect(result.drawnAssetIds).not.toContain('effect_glow')
  })

  it('labels missing base and mask resources distinctly on the buffered path', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const body = part(catalog, 'body_blob')
    body.maskPaths = {
      primary: 'masks/body-primary.png',
      secondary: 'masks/body-secondary.png',
    }
    const missing = new Set([
      'parts/body_blob.webp',
      'masks/body-primary.png',
      'masks/body-secondary.png',
    ])
    const calls: string[] = []

    const result = await renderMonster(
      makeCanvasBackedRecordingContext(calls), spec, catalog, makeResolver(missing), options1024,
    )

    expect(result.diagnostics.filter(item => item.code === 'ASSET_LOAD_FAILED')).toHaveLength(3)
    expect(calls.some(call => call.startsWith('buffer-1:text:body_blob:'))).toBe(true)
    expect(calls.some(call => call.startsWith('buffer-1:text:masks/body-primary.png:'))).toBe(true)
    expect(calls.some(call => call.startsWith('buffer-1:text:masks/body-secondary.png:'))).toBe(true)
    expect(result.drawnAssetIds).toContain('effect_glow')
  })

  it('reports a missing base socket at the selected part path', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    part(catalog, 'eyes_asymmetric').socket = 'missingSocket'

    const result = await renderMonster(
      makeRecordingContext([]), spec, catalog, makeResolver(), options1024,
    )

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'RENDER_SOCKET_MISSING',
      path: ['parts', 'eyes_asymmetric', 'socket'],
    }))
  })

  it('preserves the MonsterSpec across asynchronous rendering', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'aberration_misplaced_eye')!
    spec.aberrations = [{ id: modifier.id, overrides: structuredClone(modifier.overrides) }]
    const snapshot = structuredClone(spec)

    await renderMonster(makeRecordingContext([]), spec, catalog, makeResolver(), options1024)

    expect(spec).toEqual(snapshot)
  })
})

it('keeps fixture visual slots complete for the renderer test harness', () => {
  expect(VISUAL_SLOT_IDS).toHaveLength(14)
})
