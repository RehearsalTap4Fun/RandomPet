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
  makeCompositionCatalogFixture,
  makeValidCompositionSpecFixture,
  makeValidMonsterSpecFixture,
} from '@qmonster/generator-core/test-fixtures'
import { resolvePartPlacement, resolvePlacement } from './layout.js'
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

function sparseAlpha(
  points: readonly (readonly [number, number])[],
  width = 2048,
): Uint8ClampedArray {
  const lastIndex = points.reduce((maximum, [x, y]) => (
    Math.max(maximum, (y * width + x) * 4 + 3)
  ), -1)
  const pixels = new Uint8ClampedArray(lastIndex + 1)
  for (const [x, y] of points) pixels[(y * width + x) * 4 + 3] = 255
  return pixels
}

interface CompositionAlphaFixture {
  body: Uint8ClampedArray
  eyes: Uint8ClampedArray
  mouth: Uint8ClampedArray
  output: Uint8ClampedArray
  occluders: Uint8ClampedArray[]
}

function healthyCompositionAlpha(): CompositionAlphaFixture {
  return {
    body: sparseAlpha([[500, 500]]),
    eyes: sparseAlpha([[25, 25]], 512),
    mouth: sparseAlpha([[25, 25]], 512),
    output: sparseAlpha([[125, 125]], 512),
    occluders: [sparseAlpha([], 512), sparseAlpha([], 512)],
  }
}

function makeCompositionSurfaceFactory(
  calls: string[],
  alpha: CompositionAlphaFixture = healthyCompositionAlpha(),
) {
  const reads = [
    [sparseAlpha([])],
    [alpha.body],
    [alpha.eyes],
    [alpha.mouth],
    [alpha.output],
    [alpha.occluders[0] ?? sparseAlpha([], 512)],
    [alpha.occluders[1] ?? sparseAlpha([], 512)],
  ]
  let nextCanvas = 0
  return (width: number, height: number) => {
    const index = nextCanvas
    const id = `composition-${nextCanvas += 1}`
    calls.push(`composition-surface:${index}:${width}x${height}`)
    const context = makeRecordingContext(calls, `${id}:`)
    let readIndex = 0
    Object.assign(context, {
      getImageData: () => ({
        data: reads[index]?.[Math.min(readIndex++, (reads[index]?.length ?? 1) - 1)]
          ?? sparseAlpha([], index === 0 || index === 1 ? 2048 : 512),
      }),
    })
    return { canvas: image(id), context }
  }
}

const RASTER_WIDTH = 2048

interface SparseRasterSource extends FakeImage {
  alpha: Set<number>
  width: number
  height: number
}

interface SparseRasterState {
  composite: GlobalCompositeOperation
  scaleX: number
  scaleY: number
  x: number
  y: number
}

function rasterPoint(x: number, y: number, width = RASTER_WIDTH): number {
  return y * width + x
}

function sparseRasterImage(
  id: string,
  points: readonly (readonly [number, number])[],
): CanvasImageSource {
  return {
    id,
    width: RASTER_WIDTH,
    height: RASTER_WIDTH,
    alpha: new Set(points.map(([x, y]) => rasterPoint(x, y))),
  } as unknown as CanvasImageSource
}

function compositeSparseAlpha(
  destination: Set<number>,
  source: ReadonlySet<number>,
  operation: GlobalCompositeOperation,
): void {
  if (operation === 'destination-in') {
    for (const pixel of destination) {
      if (!source.has(pixel)) destination.delete(pixel)
    }
    return
  }
  if (operation === 'destination-out') {
    for (const pixel of source) destination.delete(pixel)
    return
  }
  for (const pixel of source) destination.add(pixel)
}

function makeSparseRasterContext(canvas: SparseRasterSource): CanvasRenderingContext2D {
  let state: SparseRasterState = {
    composite: 'source-over', scaleX: 1, scaleY: 1, x: 0, y: 0,
  }
  const stack: SparseRasterState[] = []
  return {
    canvas,
    save() {
      stack.push({ ...state })
    },
    restore() {
      state = stack.pop() ?? state
    },
    translate(x: number, y: number) {
      state.x += x * state.scaleX
      state.y += y * state.scaleY
    },
    scale(x: number, y: number) {
      state.scaleX *= x
      state.scaleY *= y
    },
    drawImage(source: CanvasImageSource, ...coordinates: number[]) {
      const sourceAlpha = (source as unknown as SparseRasterSource).alpha
      const sourceWidth = (source as unknown as SparseRasterSource).width
      const sourceHeight = (source as unknown as SparseRasterSource).height
      const destinationX = coordinates[0] ?? 0
      const destinationY = coordinates[1] ?? 0
      const destinationWidth = coordinates[2] ?? sourceWidth
      const destinationHeight = coordinates[3] ?? sourceHeight
      const transformed = new Set<number>()
      for (const pixel of sourceAlpha) {
        const localX = pixel % sourceWidth
        const localY = Math.floor(pixel / sourceWidth)
        const worldX = Math.round(
          state.x + (destinationX + localX * destinationWidth / sourceWidth) * state.scaleX,
        )
        const worldY = Math.round(
          state.y + (destinationY + localY * destinationHeight / sourceHeight) * state.scaleY,
        )
        if (worldX < 0 || worldX >= canvas.width || worldY < 0 || worldY >= canvas.height) continue
        transformed.add(rasterPoint(worldX, worldY, canvas.width))
      }
      compositeSparseAlpha(canvas.alpha, transformed, state.composite)
    },
    clearRect() {
      canvas.alpha.clear()
    },
    fillRect(x: number, y: number, width: number, height: number) {
      if (state.composite !== 'destination-out') return
      for (const pixel of canvas.alpha) {
        const pixelX = pixel % canvas.width
        const pixelY = Math.floor(pixel / canvas.width)
        if (pixelX >= x && pixelX < x + width && pixelY >= y && pixelY < y + height) {
          canvas.alpha.delete(pixel)
        }
      }
    },
    getImageData() {
      const lastPixel = Math.max(-1, ...canvas.alpha)
      const data = new Uint8ClampedArray(lastPixel < 0 ? 0 : lastPixel * 4 + 4)
      for (const pixel of canvas.alpha) data[pixel * 4 + 3] = 255
      return { data } as ImageData
    },
    get globalCompositeOperation() {
      return state.composite
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      state.composite = value
    },
  } as unknown as CanvasRenderingContext2D
}

function makeSparseRasterSurfaceFactory() {
  let nextCanvas = 0
  return (width: number, height: number) => {
    const canvas = {
      id: `raster-${nextCanvas += 1}`,
      width,
      height,
      alpha: new Set<number>(),
    }
    return {
      canvas: canvas as unknown as CanvasImageSource,
      context: makeSparseRasterContext(canvas),
    }
  }
}

function makeDoubleHeadRasterResolver(occludeOriginalEyes: boolean): ImageResolver {
  return {
    async resolve(assetPath) {
      if (assetPath === 'nodes/eyes_asymmetric_0.webp') {
        return sparseRasterImage(assetPath, [[1200, 1200]])
      }
      if (assetPath === 'nodes/mouth_wide_0.webp') {
        return sparseRasterImage(assetPath, [[1400, 1400]])
      }
      if (assetPath === 'nodes/effect_glow_0.webp' && occludeOriginalEyes) {
        return sparseRasterImage(assetPath, [[0, 0]])
      }
      return sparseRasterImage(assetPath, [])
    },
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
  it('resolves a catalog part through renderer null-socket and named-socket semantics', () => {
    const catalog = makeValidCatalogFixture()
    const rig = catalog.rigs[0]!
    expect(resolvePartPlacement(part(catalog, 'body_blob'), rig)).toEqual({
      ok: true,
      value: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    })
    expect(resolvePartPlacement(part(catalog, 'head_round'), rig)).toEqual({
      ok: true,
      value: { x: 0, y: -304, scaleX: 1, scaleY: 1 },
    })
  })

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
  it('applies a selected catalog-approved mirror through the canvas transform', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const transform = { scale: 1, mirrorX: true }
    part(catalog, 'extra_wings').approvedTransforms = [transform]
    spec.visualSlots.extraAppendage.transform = transform
    const calls: string[] = []

    const result = await renderMonster(
      makeRecordingContext(calls), spec, catalog, makeResolver(), options1024,
    )

    expect(result.diagnostics).toEqual([])
    expect(calls).toContain('scale:-1,1')
  })

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
    expect(result.compositionMetrics).toBeNull()
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

describe('composition canvas rendering', () => {
  it('draws multi-node parts in layer order and applies body and face clipping', async () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    catalog.parts.find(part => part.slotId === 'arms')!
      .composition!.renderNodes[0]!.clipPolicy = 'body'
    catalog.parts.find(part => part.slotId === 'effect')!
      .composition!.renderNodes[0]!.clipPolicy = 'protect-face'
    const calls: string[] = []

    const result = await renderMonster(
      makeRecordingContext(calls), spec, catalog, makeResolver(), {
        ...options1024, surfaceFactory: makeCompositionSurfaceFactory(calls),
      },
    )

    expect(result.diagnostics).toEqual([])
    expect(calls.filter(call => call.startsWith('composition-surface:'))).toEqual([
      'composition-surface:0:2048x2048',
      'composition-surface:1:2048x2048',
      'composition-surface:2:512x512',
      'composition-surface:3:512x512',
      'composition-surface:4:512x512',
      'composition-surface:5:512x512',
      'composition-surface:6:512x512',
    ])
    expect(calls.filter(call => call.startsWith('composition-1:draw:nodes/'))).toEqual([
      'composition-1:draw:nodes/tail_anchor_0.webp',
      'composition-1:draw:nodes/extra_wings_0.webp',
      'composition-1:draw:nodes/extra_wings_1.webp',
      'composition-1:draw:nodes/body_blob_0.webp',
      'composition-1:draw:nodes/surface_gel_0.webp',
      'composition-1:draw:nodes/pattern_spots_0.webp',
      'composition-1:draw:nodes/color_scheme_ocean_0.webp',
      'composition-1:draw:nodes/arms_short_0.webp',
      'composition-1:draw:nodes/arms_short_1.webp',
      'composition-1:draw:nodes/legs_webbed_0.webp',
      'composition-1:draw:nodes/legs_webbed_1.webp',
      'composition-1:draw:nodes/head_round_0.webp',
      'composition-1:draw:nodes/eyes_asymmetric_0.webp',
      'composition-1:draw:nodes/mouth_wide_0.webp',
      'composition-1:draw:nodes/oral_teeth_0.webp',
      'composition-1:draw:nodes/head_antennae_0.webp',
      'composition-1:draw:nodes/effect_glow_0.webp',
    ])
    expect(calls).toContain('composition-1:composite:destination-in')
    expect(calls).toContain('composition-1:draw:composition-2')
    expect(calls).toContain('composition-1:composite:destination-out')
    expect(calls).toContain('composition-1:fillRect:-24,76,1048,900:')
  })

  it('does not count separated double-head eyes and mouths as occluders of their own slot', async () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    const result = await renderMonster(
      makeRecordingContext([]), spec, catalog, makeDoubleHeadRasterResolver(false), {
        ...options1024, surfaceFactory: makeSparseRasterSurfaceFactory(),
      },
    )

    expect(result.compositionMetrics).toMatchObject({
      eyesInsideRatio: 1,
      eyesVisibleRatio: 1,
      mouthInsideRatio: 1,
      mouthVisibleRatio: 1,
    })
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_FACE_OCCLUDED',
    }))
  })

  it('still counts a later non-face effect as a real double-head eye occluder', async () => {
    const catalog = makeCompositionCatalogFixture()
    const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    body.composition!.geometryByRig.blob!.sockets.effect = { x: 152, y: 552 }
    const effect = catalog.parts.find(part => part.slotId === 'effect' && !part.composition!.isNone)!
    effect.composition!.renderNodes[0]!.origin = { x: 0, y: 0 }
    const spec = makeValidCompositionSpecFixture(catalog)
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    const result = await renderMonster(
      makeRecordingContext([]), spec, catalog, makeDoubleHeadRasterResolver(true), {
        ...options1024, surfaceFactory: makeSparseRasterSurfaceFactory(),
      },
    )

    expect(result.compositionMetrics).toMatchObject({
      eyesVisibleRatio: 0.5,
      mouthVisibleRatio: 1,
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'COMPOSITION_FACE_OCCLUDED',
      path: ['visualSlots', 'eyes'],
    }))
  })

  it('blocks face alpha below the 80% inside and 85% visible thresholds', async () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    const inside = Array.from({ length: 79 }, (_, x) => [x, 100] as const)
    const outside = Array.from({ length: 21 }, (_, x) => [x, 0] as const)
    const occluded = Array.from({ length: 16 }, (_, x) => [x, 100] as const)
    const alpha = healthyCompositionAlpha()
    alpha.eyes = sparseAlpha([...inside, ...outside], 512)
    alpha.occluders = [sparseAlpha(occluded, 512), sparseAlpha([], 512)]

    const result = await renderMonster(
      makeRecordingContext([]), spec, catalog, makeResolver(), {
        ...options1024, surfaceFactory: makeCompositionSurfaceFactory([], alpha),
      },
    )

    expect(result.compositionMetrics).toMatchObject({
      eyesInsideRatio: 0.79,
      eyesVisibleRatio: 0.84,
      mouthInsideRatio: 1,
      mouthVisibleRatio: 1,
    })
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error', code: 'COMPOSITION_FACE_OUT_OF_ZONE',
        path: ['visualSlots', 'eyes'],
      }),
      expect.objectContaining({
        severity: 'error', code: 'COMPOSITION_FACE_OCCLUDED',
        path: ['visualSlots', 'eyes'],
      }),
    ]))
  })

  it('blocks visible pixels outside the catalog frame bounds', async () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    const alpha = healthyCompositionAlpha()
    alpha.output = sparseAlpha([[31, 32]], 512)

    const result = await renderMonster(
      makeRecordingContext([]), spec, catalog, makeResolver(), {
        ...options1024, surfaceFactory: makeCompositionSurfaceFactory([], alpha),
      },
    )

    expect(result.compositionMetrics?.visibleBounds).toEqual({
      x: 124, y: 128, width: 4, height: 4,
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'COMPOSITION_BOUNDS_EXCEEDED',
      path: ['visualSlots', 'bodyFrame'],
    }))
  })

  it('preserves the source MonsterSpec across a composition render', async () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }
    const snapshot = structuredClone(spec)

    await renderMonster(makeRecordingContext([]), spec, catalog, makeResolver(), {
      ...options1024, surfaceFactory: makeCompositionSurfaceFactory([]),
    })

    expect(spec).toEqual(snapshot)
  })

  it('does not resolve assets after attachment structure validation fails', async () => {
    const catalog = makeCompositionCatalogFixture()
    delete catalog.parts.find(part => part.slotId === 'headShape')!
      .composition!.geometryByRig.blob!.sockets.eyes
    const spec = makeValidCompositionSpecFixture(catalog)
    let resolverCalls = 0
    const resolver: ImageResolver = {
      async resolve(assetPath) {
        resolverCalls += 1
        return image(assetPath)
      },
    }

    const result = await renderMonster(
      makeRecordingContext([]), spec, catalog, resolver, options1024,
    )

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'COMPOSITION_SOCKET_MISSING',
    }))
    expect(result.drawnAssetIds).toEqual([])
    expect(result.compositionMetrics).toBeNull()
    expect(resolverCalls).toBe(0)
  })
})

describe('canvas rendering', () => {
  it('reuses the two browser composite surfaces for sequential renders to one staging canvas', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    part(catalog, 'body_blob').maskPaths = { primary: 'masks/body-primary.png' }
    const calls: string[] = []
    const context = makeCanvasBackedRecordingContext(calls)

    await renderMonster(context, spec, catalog, makeResolver(), options1024)
    await renderMonster(context, spec, catalog, makeResolver(), options1024)

    expect(calls.some(call => call.startsWith('buffer-3:'))).toBe(false)
  })

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

  it('selects three authored rig masks and uses color blending to preserve body luminance', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const color = part(catalog, 'color_scheme_ocean')
    Object.assign(color, {
      rigMaskPaths: {
        blob: {
          primary: 'masks/ocean-blob-primary.png',
          secondary: 'masks/ocean-blob-secondary.png',
          accent: 'masks/ocean-blob-accent.png',
        },
        biped: {
          primary: 'masks/ocean-biped-primary.png',
          secondary: 'masks/ocean-biped-secondary.png',
          accent: 'masks/ocean-biped-accent.png',
        },
      },
    })
    const calls: string[] = []

    const result = await renderMonster(
      makeRecordingContext(calls),
      spec,
      catalog,
      makeResolver(),
      { ...options1024, surfaceFactory: makeRecordingSurfaceFactory(calls) },
    )

    expect(result.diagnostics).toEqual([])
    expect(calls).toContain('injected-2:draw:masks/ocean-blob-primary.png')
    expect(calls).toContain('injected-2:draw:masks/ocean-blob-secondary.png')
    expect(calls).toContain('injected-2:draw:masks/ocean-blob-accent.png')
    expect(calls).not.toContain('injected-2:draw:masks/ocean-biped-primary.png')
    expect(calls).toContain('composite:color')
    expect(calls).toContain('injected-2:fillStyle:#f6d365')
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

  it('rejects a missing base socket before rendering', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    part(catalog, 'eyes_asymmetric').socket = 'missingSocket'

    const result = await renderMonster(
      makeRecordingContext([]), spec, catalog, makeResolver(), options1024,
    )

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SPEC_SOCKET_MISSING',
      path: ['visualSlots', 'eyes', 'rigId'],
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

  it('draws nothing when catalog validation rejects an incompatible rig', async () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    part(catalog, 'legs_webbed').compatibleRigs = ['biped']
    const calls: string[] = []

    const result = await renderMonster(
      makeRecordingContext(calls), spec, catalog, makeResolver(), options1024,
    )

    expect(result.drawnAssetIds).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'SPEC_RIG_INCOMPATIBLE',
    }))
    expect(calls).toEqual([])
  })

  it('does not allocate or render for a modifier socket absent from its selected rig', async () => {
    const catalog = makeValidCatalogFixture()
    delete catalog.rigs.find(rig => rig.id === 'blob')!.sockets.headAlternate
    const spec = makeValidMonsterSpecFixture()
    const modifier = catalog.modifiers.find(candidate => candidate.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }
    const calls: string[] = []
    let surfaceAllocations = 0
    let resolverCalls = 0
    const resolver: ImageResolver = {
      async resolve(assetPath) {
        resolverCalls += 1
        return image(assetPath)
      },
    }

    const result = await renderMonster(
      makeRecordingContext(calls),
      spec,
      catalog,
      resolver,
      {
        ...options1024,
        surfaceFactory: () => {
          surfaceAllocations += 1
          return { canvas: image('surface'), context: makeRecordingContext(calls) }
        },
      },
    )

    expect(result.drawnAssetIds).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'SPEC_SOCKET_MISSING',
      path: ['mutation', 'overrides', 'socket'],
    }))
    expect(surfaceAllocations).toBe(0)
    expect(resolverCalls).toBe(0)
    expect(calls).toEqual([])
  })
})

it('keeps fixture visual slots complete for the renderer test harness', () => {
  expect(VISUAL_SLOT_IDS).toHaveLength(14)
})
