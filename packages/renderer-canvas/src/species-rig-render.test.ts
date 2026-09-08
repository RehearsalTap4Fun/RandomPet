import { describe, expect, it } from 'vitest'
import { generateMonster, VISUAL_SLOT_IDS } from '@qmonster/generator-core'
import { makeV08SpeciesRigCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { renderMonster } from './render.js'
import { resolveSpeciesRigRenderPlan, renderSpeciesRigMonster } from './species-rig-render.js'
import type { ImageResolver, RenderOptions, RenderSurfaceFactory } from './types.js'

interface FakeImage { id: string }

function image(id: string): CanvasImageSource {
  return { id } as unknown as CanvasImageSource
}

function recordingContext(calls: string[], prefix: string): CanvasRenderingContext2D {
  let composite: GlobalCompositeOperation = 'source-over'
  let alpha = 1
  return {
    save: () => calls.push(`${prefix}save`),
    restore: () => calls.push(`${prefix}restore`),
    translate: (x: number, y: number) => calls.push(`${prefix}translate:${x},${y}`),
    rotate: (angle: number) => calls.push(`${prefix}rotate:${angle}`),
    scale: (x: number, y: number) => calls.push(`${prefix}scale:${x},${y}`),
    clearRect: () => calls.push(`${prefix}clear`),
    drawImage: (source: CanvasImageSource) => {
      calls.push(`${prefix}draw:${(source as unknown as FakeImage).id}`)
    },
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      composite = value
      calls.push(`${prefix}composite:${value}`)
    },
    get globalCompositeOperation() { return composite },
    set globalAlpha(value: number) {
      alpha = value
      calls.push(`${prefix}alpha:${value}`)
    },
    get globalAlpha() { return alpha },
  } as unknown as CanvasRenderingContext2D
}

function surfaceFactory(calls: string[]): RenderSurfaceFactory {
  let index = 0
  return (width, height) => {
    const id = `surface-${index += 1}`
    calls.push(`allocate:${id}:${width}x${height}`)
    return { canvas: image(id), context: recordingContext(calls, `${id}:`) }
  }
}

function resolver(missing = new Set<string>()): ImageResolver {
  return {
    async resolve(assetPath) {
      if (missing.has(assetPath)) throw new Error(`missing ${assetPath}`)
      return image(assetPath)
    },
  }
}

const options: RenderOptions = {
  width: 1024,
  height: 1024,
  includeGroundShadow: true,
}

function fixture() {
  const catalog = makeV08SpeciesRigCatalogFixture()
  const generated = generateMonster({
    seed: 'v08-render', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
  }, catalog)
  if (generated.blocked) throw new Error('Expected a generated v0.8 fixture.')
  return { catalog, spec: generated.spec }
}

describe('v0.8 species-rig renderer', () => {
  it('resolves the exact tuple into the rig-owned layer order', () => {
    const { catalog, spec } = fixture()
    const plan = resolveSpeciesRigRenderPlan(spec, catalog)

    expect(plan).not.toBeNull()
    expect(plan?.speciesRig.id).toBe('feline-sit-v1')
    expect(plan?.traits.map(trait => trait.slotId)).toEqual(
      plan?.speciesRig.layerOrder.filter(slotId => VISUAL_SLOT_IDS.includes(slotId)),
    )

    expect(resolveSpeciesRigRenderPlan({ ...spec, speciesRigId: 'other-rig' }, catalog)).toBeNull()
  })

  it('routes the exact v0.8 tuple without structural placement transforms or connectors', async () => {
    const { catalog, spec } = fixture()
    const calls: string[] = []
    const result = await renderMonster(recordingContext(calls, 'main:'), spec, catalog, resolver(), {
      ...options,
      surfaceFactory: surfaceFactory(calls),
    })

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.connectorMetrics).toEqual([])
    expect(calls.some(call => call.includes('translate:') || call.includes('rotate:'))).toBe(false)
    expect(calls.filter(call => call.startsWith('main:draw:'))).toEqual(['main:draw:surface-1'])
  })

  it('clips pattern to bodySurface before drawing it to final output', async () => {
    const { catalog, spec } = fixture()
    const calls: string[] = []
    await renderSpeciesRigMonster(recordingContext(calls, 'main:'), spec, catalog, resolver(), {
      ...options,
      surfaceFactory: surfaceFactory(calls),
    })

    const part = catalog.parts.find(candidate => candidate.id === spec.visualSlots.pattern.partId)!
    const rig = catalog.speciesRigs![0]!
    const sequence = [
      `surface-2:draw:${part.assetPath}`,
      `surface-3:draw:${rig.regions.bodySurface.assetPath}`,
      'surface-2:composite:destination-in',
      'surface-2:draw:surface-3',
      'surface-1:draw:surface-2',
    ]
    let cursor = -1
    for (const expected of sequence) {
      cursor = calls.indexOf(expected, cursor + 1)
      expect(cursor, expected).toBeGreaterThanOrEqual(0)
    }
  })

  it('subtracts faceProtection from protected effects', async () => {
    const { catalog, spec } = fixture()
    const calls: string[] = []
    await renderSpeciesRigMonster(recordingContext(calls, 'main:'), spec, catalog, resolver(), {
      ...options,
      surfaceFactory: surfaceFactory(calls),
    })

    const rig = catalog.speciesRigs![0]!
    const subtract = calls.indexOf('surface-2:composite:destination-out')
    expect(subtract).toBeGreaterThanOrEqual(0)
    expect(calls).toContain(`surface-3:draw:${rig.regions.faceProtection.assetPath}`)
    expect(calls.slice(subtract + 1)).toContain('surface-2:draw:surface-3')
  })

  it('aborts without committing output when any rig resource fails to load', async () => {
    const { catalog, spec } = fixture()
    const missing = catalog.speciesRigs![0]!.regions.eyesRegion.assetPath
    const calls: string[] = []
    const result = await renderSpeciesRigMonster(
      recordingContext(calls, 'main:'), spec, catalog, resolver(new Set([missing])), {
        ...options,
        surfaceFactory: surfaceFactory(calls),
      },
    )

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'V08_ASSET_LOAD_FAILED',
    }))
    expect(result.drawnAssetIds).toEqual([])
    expect(calls.some(call => call.startsWith('main:draw:'))).toBe(false)
  })

  it('does not fall through to an older renderer when the v0.8 rig identity is invalid', async () => {
    const { catalog, spec } = fixture()
    let resolverCalls = 0
    const result = await renderMonster(
      recordingContext([], 'main:'), { ...spec, speciesRigId: 'other-rig' }, catalog, {
        async resolve(path) { resolverCalls += 1; return image(path) },
      }, options,
    )

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'SPEC_SPECIES_RIG_MISMATCH',
    }))
    expect(result.connectorMetrics).toEqual([])
    expect(resolverCalls).toBe(0)
  })
})
