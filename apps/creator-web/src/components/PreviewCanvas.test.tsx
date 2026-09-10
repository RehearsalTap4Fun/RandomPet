import { createRef } from 'react'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  V09_COMPOSITION_NODE_IDS,
  generateMonster,
  generateMonsterV09,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
} from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import type { RenderResult, V09ResourceResolver } from '@qmonster/renderer-canvas'
import { loadCandidateProductionRelease } from '../v09-production-release.test-support.js'
import {
  CatalogImageResolverCache,
  PreviewCanvas,
  catalogAssetKey,
  createProductionV09ResourceResolver,
  previewFrameKey,
  resolveProductionAssetUrl,
  type PreviewRenderer,
  type V09PreviewRenderer,
} from './PreviewCanvas.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, reject, resolve }
}

function installCanvasContexts() {
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
  const createdContexts: CanvasRenderingContext2D[] = []
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let context = contexts.get(this)
    if (context === undefined) {
      context = {
        canvas: this,
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        putImageData: vi.fn(),
      } as unknown as CanvasRenderingContext2D
      contexts.set(this, context)
      createdContexts.push(context)
    }
    return context
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
  return { contexts, createdContexts, spy }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CatalogImageResolverCache', () => {
  it('builds an exact versioned asset key without fallback', async () => {
    expect(catalogAssetKey('0.2.0', 'parts/eyes_glossy_pair.png'))
      .toContain('/assets/v0.2.0/parts/eyes_glossy_pair.png')
    await expect(resolveProductionAssetUrl('0.1.0', 'parts/eyes_glossy_pair.png')).resolves.toMatch(/v0\.1\.0/)
    await expect(resolveProductionAssetUrl('0.2.0', 'parts/eyes_glossy_pair.png')).resolves.toMatch(/v0\.2\.0/)
    await expect(resolveProductionAssetUrl(
      '0.3.0',
      'assets/v0.3.0/structural/biped/nodes/body_biped_tall/body_biped_tall-body.webp',
    )).resolves.toMatch(/v0\.3\.0.*body_biped_tall-body/)
    await expect(resolveProductionAssetUrl('9.9.9', 'parts/eyes_glossy_pair.png')).rejects.toThrow('not bundled')
  })

  it('resolves a tracked production asset through the Vite asset graph', async () => {
    const url = await resolveProductionAssetUrl('0.1.0', 'parts/eyes_asymmetric.webp')
    expect(new URL(url, 'http://localhost').pathname).toMatch(/eyes_asymmetric/)
  })

  it('shares an asset within one catalog version but isolates equal paths across versions', async () => {
    const image = {} as CanvasImageSource
    const load = vi.fn(async () => image)
    const cache = new CatalogImageResolverCache(load)

    const first = cache.forCatalog('0.1.0')
    const next = cache.forCatalog('0.2.0')
    await first.resolve('parts/eyes.webp')
    await first.resolve('parts/eyes.webp')
    await next.resolve('parts/eyes.webp')

    expect(load.mock.calls).toEqual([
      ['0.1.0', 'parts/eyes.webp'],
      ['0.2.0', 'parts/eyes.webp'],
    ])
    expect(cache.size()).toBe(2)
  })
})

describe('PreviewCanvas', () => {
  it('routes an exact v0.9 spec through the fixed renderer and production resolver by default', async () => {
    const { createdContexts } = installCanvasContexts()
    const release = await loadCandidateProductionRelease()
    const generated = generateMonsterV09({ seed: 'creator-preview-v09' }, release.catalog)
    expect(generated.blocked).toBe(false)
    const renderer: V09PreviewRenderer = vi.fn(async () => ({ trace: [...V09_COMPOSITION_NODE_IDS] }))
    const onDiagnosticsChange = vi.fn()

    render(<PreviewCanvas
      spec={generated.spec}
      catalog={release.catalog}
      v09Renderer={renderer}
      onDiagnosticsChange={onDiagnosticsChange}
    />)

    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
    const [context, spec, catalog, usedResolver] = vi.mocked(renderer).mock.calls[0]!
    expect(context.canvas).toMatchObject({ width: 2048, height: 2048 })
    expect(spec).toStrictEqual(generated.spec)
    expect(catalog).toBe(release.catalog)
    expect(usedResolver).toHaveProperty('resolvePng', expect.any(Function))
    expect(onDiagnosticsChange).toHaveBeenLastCalledWith([])
    await waitFor(() => expect(createdContexts.flatMap(context => (
      vi.mocked(context.drawImage).mock.calls
    )).map(call => Array.from(call)).filter(call => (
      call.length === 5 && call[3] === 1024 && call[4] === 1024
    ))).toHaveLength(2))
  })

  it('verifies a real content-addressed PNG and rejects a resource digest mismatch', async () => {
    installCanvasContexts()
    vi.stubGlobal('ImageData', class {
      public constructor(
        public readonly data: Uint8ClampedArray,
        public readonly width: number,
        public readonly height: number,
      ) {}
    })
    const release = await loadCandidateProductionRelease()
    const ref = release.catalog.skeletonFamilies[0]!.neutralMaster
    const bytes = new Uint8Array(await readFile(join(
      process.cwd(), 'packages', 'asset-catalog', 'resources', 'by-sha256', ref.sha256,
    )))
    const resolver = createProductionV09ResourceResolver({
      loadResourceBytes: async () => bytes,
    })

    await expect(resolver.resolvePng(ref)).resolves.toMatchObject({
      sha256: ref.sha256,
      width: 2048,
      height: 2048,
      pixels: expect.objectContaining({ byteLength: 2048 * 2048 * 4 }),
    })

    const tampered = bytes.slice()
    tampered[tampered.length - 16] = tampered[tampered.length - 16]! ^ 1
    const tamperedResolver = createProductionV09ResourceResolver({
      loadResourceBytes: async () => tampered,
    })
    await expect(tamperedResolver.resolvePng(ref)).rejects.toMatchObject({ code: 'RESOURCE_HASH_MISMATCH' })
  }, 30_000)

  it('bounds the production PNG cache with LRU eviction and closes evicted ImageBitmaps', async () => {
    installCanvasContexts()
    vi.stubGlobal('ImageData', class {
      public constructor(
        public readonly data: Uint8ClampedArray,
        public readonly width: number,
        public readonly height: number,
      ) {}
    })
    const drawables: Array<{ close: ReturnType<typeof vi.fn> }> = []
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      const drawable = { close: vi.fn() }
      drawables.push(drawable)
      return drawable
    }))
    const release = await loadCandidateProductionRelease()
    const family = release.catalog.skeletonFamilies[0]!
    const refs = [family.neutralMaster, family.materialMap, Object.values(family.fixedOccluderMasks)[0]!] as const
    const resolver = createProductionV09ResourceResolver({
      maxPngEntries: 2,
      loadResourceBytes: async resourceId => new Uint8Array(await readFile(join(
        process.cwd(), 'packages', 'asset-catalog', 'resources', 'by-sha256', resourceId.slice('sha256:'.length),
      ))),
    })

    await resolver.resolvePng(refs[0])
    await resolver.resolvePng(refs[1])
    await resolver.resolvePng(refs[0]) // refresh the first entry
    await resolver.resolvePng(refs[2]) // evicts the second entry
    expect(drawables[0]!.close).not.toHaveBeenCalled()
    expect(drawables[1]!.close).toHaveBeenCalledTimes(1)

    await resolver.resolvePng(refs[1])
    expect(drawables).toHaveLength(4)
  }, 60_000)

  it('rejects a mixed v0.9 tuple before invoking either renderer', async () => {
    installCanvasContexts()
    const release = await loadCandidateProductionRelease()
    const generated = generateMonsterV09({ seed: 'creator-preview-mixed' }, release.catalog)
    const mixed = { ...generated.spec, generatorVersion: '0.8.0' } as unknown as typeof generated.spec
    const legacyRenderer: PreviewRenderer = vi.fn()
    const v09Renderer: V09PreviewRenderer = vi.fn()
    const onDiagnosticsChange = vi.fn()

    render(<PreviewCanvas
      spec={mixed}
      catalog={release.catalog}
      renderer={legacyRenderer}
      v09Renderer={v09Renderer}
      v09Resolver={{} as V09ResourceResolver}
      onDiagnosticsChange={onDiagnosticsChange}
    />)

    await waitFor(() => expect(onDiagnosticsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ code: 'VERSION_TUPLE_MISMATCH' }),
    ]))
    expect(legacyRenderer).not.toHaveBeenCalled()
    expect(v09Renderer).not.toHaveBeenCalled()
  })

  it('rejects a valid v0.9 spec paired with a legacy catalog instead of falling back', async () => {
    installCanvasContexts()
    const release = await loadCandidateProductionRelease()
    const generated = generateMonsterV09({ seed: 'creator-preview-wrong-catalog' }, release.catalog)
    const legacyCatalog = makeValidCatalogFixture()
    const legacyRenderer: PreviewRenderer = vi.fn()
    const v09Renderer: V09PreviewRenderer = vi.fn()
    const onDiagnosticsChange = vi.fn()

    render(<PreviewCanvas
      spec={generated.spec}
      catalog={legacyCatalog}
      renderer={legacyRenderer}
      v09Renderer={v09Renderer}
      onDiagnosticsChange={onDiagnosticsChange}
    />)

    await waitFor(() => expect(onDiagnosticsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ code: 'VERSION_TUPLE_MISMATCH' }),
    ]))
    expect(legacyRenderer).not.toHaveBeenCalled()
    expect(v09Renderer).not.toHaveBeenCalled()
  })

  it('changes the render request key for catalog content and renderer identity', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'identity', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const changedCatalog = structuredClone(catalog)
    changedCatalog.parts[0]!.assetPath = 'parts/changed.webp'
    const firstRenderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null,
    }))
    const secondRenderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null,
    }))
    const firstResolver = { resolve: vi.fn(async () => ({} as CanvasImageSource)) }
    const secondResolver = { resolve: vi.fn(async () => ({} as CanvasImageSource)) }
    const key = previewFrameKey as unknown as (
      spec: MonsterSpec, catalog: Catalog, renderer: PreviewRenderer,
      resolver?: typeof firstResolver,
    ) => string

    expect(key(spec, changedCatalog, firstRenderer)).not.toBe(key(spec, catalog, firstRenderer))
    expect(key(spec, catalog, secondRenderer)).not.toBe(key(spec, catalog, firstRenderer))
    expect(key(spec, catalog, firstRenderer, secondResolver))
      .not.toBe(key(spec, catalog, firstRenderer, firstResolver))
  })

  it.each([
    'CONNECTOR_VARIANT_MISSING',
    'CONNECTOR_PROFILE_INVALID',
    'CONNECTOR_WARP_EXCEEDED',
    'CONNECTOR_BRIDGE_MISSING',
    'CONNECTOR_COMPOSITE_FAILED',
    'STRUCTURE_DISCONNECTED',
  ])(
    'publishes blocking %s diagnostics without committing or completing the preview',
    async code => {
      const { contexts } = installCanvasContexts()
      const catalog = makeValidCatalogFixture()
      const spec = generateMonster({ seed: code, themeId: 'fungal', mode: 'normal' }, catalog).spec
      const blocking: Diagnostic = { severity: 'error', code, path: ['visualSlots', 'arms'], message: code }
      const renderer: PreviewRenderer = vi.fn(async () => ({
        drawnAssetIds: [], diagnostics: [blocking], compositionMetrics: null, connectorMetrics: [],
      }))
      const onDiagnosticsChange = vi.fn()
      const onRenderComplete = vi.fn()

      render(<PreviewCanvas
        spec={spec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={onDiagnosticsChange}
        onRenderComplete={onRenderComplete}
      />)

      await waitFor(() => expect(onDiagnosticsChange).toHaveBeenLastCalledWith([blocking]))
      const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
      expect(contexts.get(display)?.drawImage).not.toHaveBeenCalled()
      expect(onRenderComplete).not.toHaveBeenCalled()
    },
  )

  it('does not prime export for a missing bridge definition', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'missing-definition', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
    const missingBridge: Diagnostic = {
      severity: 'error', code: 'CONNECTOR_BRIDGE_MISSING',
      path: ['visualSlots', 'arms'], message: 'missing',
    }
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [],
      diagnostics: [missingBridge],
      compositionMetrics: null,
      connectorMetrics: [],
    }))
    const onRenderComplete = vi.fn()

    render(<PreviewCanvas
      spec={spec}
      catalog={catalog}
      renderer={renderer}
      onDiagnosticsChange={() => undefined}
      onRenderComplete={onRenderComplete}
    />)

    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(contexts.get(display)?.drawImage).not.toHaveBeenCalled()
    expect(toBlob).not.toHaveBeenCalled()
    expect(onRenderComplete).not.toHaveBeenCalled()
  })

  it('does not cache, commit, export, or complete a preview with a missing palette mask', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'missing-palette-mask', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const rerolledSpec = {
      ...spec,
      slotRolls: { ...spec.slotRolls, tail: spec.slotRolls.tail + 1 },
    }
    const missingPaletteMask: Diagnostic = {
      severity: 'error',
      code: 'INTERFACE_PALETTE_MASK_MISSING',
      path: ['colorSchemeId'],
      message: 'missing palette mask',
    }
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [],
      diagnostics: [missingPaletteMask],
      compositionMetrics: null,
      connectorMetrics: [],
    }))
    const onDiagnosticsChange = vi.fn()
    const onRenderComplete = vi.fn()
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
    const mark = vi.spyOn(performance, 'mark')
    const view = render(<PreviewCanvas
      spec={spec}
      catalog={catalog}
      renderer={renderer}
      onDiagnosticsChange={onDiagnosticsChange}
      onRenderComplete={onRenderComplete}
    />)

    await waitFor(() => expect(onDiagnosticsChange).toHaveBeenLastCalledWith([missingPaletteMask]))
    view.rerender(<PreviewCanvas
      spec={rerolledSpec}
      catalog={catalog}
      renderer={renderer}
      onDiagnosticsChange={onDiagnosticsChange}
      onRenderComplete={onRenderComplete}
    />)
    await waitFor(() => expect(onDiagnosticsChange).toHaveBeenLastCalledWith([missingPaletteMask]))

    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(renderer).toHaveBeenCalledTimes(2)
    expect(contexts.get(display)?.drawImage).not.toHaveBeenCalled()
    expect(toBlob).not.toHaveBeenCalled()
    expect(mark.mock.calls.filter(([name]) => name === 'qmonster-preview-commit')).toHaveLength(0)
    expect(onRenderComplete).not.toHaveBeenCalled()
  })

  it('commits and completes a preview whose diagnostics are warning-only', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'warning-only', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const warning: Diagnostic = {
      severity: 'warning', code: 'FUTURE_RENDER_WARNING', path: ['preview'], message: 'warning only',
    }
    const result: RenderResult = {
      drawnAssetIds: [], diagnostics: [warning], compositionMetrics: null, connectorMetrics: [],
    }
    const renderer: PreviewRenderer = vi.fn(async () => result)
    const onDiagnosticsChange = vi.fn()
    const onRenderComplete = vi.fn()

    render(<PreviewCanvas
      spec={spec}
      catalog={catalog}
      renderer={renderer}
      onDiagnosticsChange={onDiagnosticsChange}
      onRenderComplete={onRenderComplete}
    />)

    await waitFor(() => expect(onRenderComplete).toHaveBeenCalledWith(result))
    expect(onDiagnosticsChange).toHaveBeenLastCalledWith([warning])
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(1)
  })

  it('blocks an arbitrary future diagnostic whose severity is error', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'future-error', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const futureError: Diagnostic = {
      severity: 'error', code: 'FUTURE_UNKNOWN_RENDER_ERROR', path: ['preview'], message: 'future error',
    }
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [futureError], compositionMetrics: null, connectorMetrics: [],
    }))
    const onDiagnosticsChange = vi.fn()
    const onRenderComplete = vi.fn()

    render(<PreviewCanvas
      spec={spec}
      catalog={catalog}
      renderer={renderer}
      onDiagnosticsChange={onDiagnosticsChange}
      onRenderComplete={onRenderComplete}
    />)

    await waitFor(() => expect(onDiagnosticsChange).toHaveBeenLastCalledWith([futureError]))
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(contexts.get(display)?.drawImage).not.toHaveBeenCalled()
    expect(onRenderComplete).not.toHaveBeenCalled()
  })

  it('blocks a suppressed scoped error in the generic live preview', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'suppressed-error', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const suppressedError: Diagnostic = {
      severity: 'error', code: 'CONNECTOR_COMPOSITE_FAILED', path: ['connectors', 'tailRoot'], message: 'suppressed seam',
    }
    const scopedResult: RenderResult = {
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: [],
      diagnosticScope: {
        id: 'historical-slice', activeVisualSlots: ['bodyFrame'], activeConnectorIds: ['neck'],
        suppressedDiagnostics: [suppressedError],
      },
    }
    const renderer: PreviewRenderer = vi.fn(async () => scopedResult)
    const onDiagnosticsChange = vi.fn()
    const onRenderComplete = vi.fn()

    render(<PreviewCanvas
      spec={spec} catalog={catalog} renderer={renderer}
      onDiagnosticsChange={onDiagnosticsChange} onRenderComplete={onRenderComplete}
    />)

    await waitFor(() => expect(onDiagnosticsChange).toHaveBeenLastCalledWith([suppressedError]))
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(contexts.get(display)?.drawImage).not.toHaveBeenCalled()
    expect(onRenderComplete).not.toHaveBeenCalled()
  })

  it('forwards the displayed canvas used for committed renders', async () => {
    installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'forwarded', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null,
    }))
    const canvasRef = createRef<HTMLCanvasElement>()

    render(
      <PreviewCanvas
        ref={canvasRef}
        spec={spec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={() => undefined}
      />,
    )

    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
    expect(canvasRef.current).toBe(screen.getByRole('img', { name: '生物预览' }))
  })

  it('always exposes a 1024 square backing canvas', async () => {
    installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'preview', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null,
    }))
    render(<PreviewCanvas spec={spec} catalog={catalog} renderer={renderer} onDiagnosticsChange={() => undefined} />)

    const canvas = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(canvas.width).toBe(1024)
    expect(canvas.height).toBe(1024)
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
  })

  it('reuses a released staging canvas for the next sequential preview', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const firstSpec = generateMonster({ seed: 'first-buffer', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const nextSpec = { ...firstSpec, seed: 'next-buffer' }
    const stagingContexts: CanvasRenderingContext2D[] = []
    const renderer: PreviewRenderer = vi.fn(async context => {
      stagingContexts.push(context)
      return { drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null }
    })
    const view = render(
      <PreviewCanvas
        spec={firstSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={() => undefined}
      />,
    )
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    await waitFor(() => expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(1))

    view.rerender(
      <PreviewCanvas
        spec={nextSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={() => undefined}
      />,
    )
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(2))

    expect(stagingContexts[1]).toBe(stagingContexts[0])
  })

  it('reuses a bounded cached frame when only non-visual slot rolls change', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'cached-frame', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const rerolledSpec = {
      ...spec,
      slotRolls: { ...spec.slotRolls, tail: spec.slotRolls.tail + 1 },
    }
    const result: RenderResult = {
      drawnAssetIds: ['tail_anchor'], diagnostics: [], compositionMetrics: null, connectorMetrics: null,
    }
    const renderer: PreviewRenderer = vi.fn(async () => result)
    const onRenderComplete = vi.fn()
    const view = render(
      <PreviewCanvas
        spec={spec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={() => undefined}
        onRenderComplete={onRenderComplete}
      />,
    )
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    await waitFor(() => expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(1))

    view.rerender(
      <PreviewCanvas
        spec={rerolledSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={() => undefined}
        onRenderComplete={onRenderComplete}
      />,
    )
    await waitFor(() => expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(2))

    expect(renderer).toHaveBeenCalledTimes(1)
    expect(onRenderComplete).toHaveBeenCalledTimes(2)
    expect(onRenderComplete).toHaveBeenLastCalledWith(result)
  })

  it('commits only the newest async render and never publishes stale diagnostics', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const oldSpec = generateMonster({ seed: 'old', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const newSpec = { ...oldSpec, seed: 'new' }
    const oldRender = deferred<RenderResult>()
    const newRender = deferred<RenderResult>()
    const renderer: PreviewRenderer = vi.fn((_context, spec) => (
      spec.seed === 'old' ? oldRender.promise : newRender.promise
    ))
    const onDiagnosticsChange = vi.fn()
    const onRenderComplete = vi.fn()
    const mark = vi.spyOn(performance, 'mark')
    const view = render(
      <PreviewCanvas
        spec={oldSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={onDiagnosticsChange}
        onRenderComplete={onRenderComplete}
      />,
    )
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
    view.rerender(
      <PreviewCanvas
        spec={newSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={onDiagnosticsChange}
        onRenderComplete={onRenderComplete}
      />,
    )
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(2))

    const assetError: Diagnostic = {
      severity: 'error', code: 'ASSET_LOAD_FAILED',
      path: ['parts', 'eyes'], message: 'stale asset failure',
    }
    await act(async () => newRender.resolve({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null,
    }))
    await act(async () => oldRender.resolve({
      drawnAssetIds: [], diagnostics: [assetError], compositionMetrics: null, connectorMetrics: null,
    }))

    expect(onDiagnosticsChange).toHaveBeenLastCalledWith([])
    expect(onDiagnosticsChange.mock.calls.flatMap(([items]) => items as Diagnostic[])).not.toContainEqual(assetError)
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(1)
    expect(mark.mock.calls.filter(([name]) => name === 'qmonster-preview-commit')).toHaveLength(1)
    expect(onRenderComplete).toHaveBeenCalledTimes(1)
    expect(onRenderComplete).toHaveBeenLastCalledWith(expect.objectContaining({ diagnostics: [] }))
  })

  it('clears an existing preview when the latest render rejects and publishes the failure', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const oldSpec = generateMonster({ seed: 'visible', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const newSpec = { ...oldSpec, seed: 'latest-failure' }
    const renderer: PreviewRenderer = vi.fn(async (_context, spec) => {
      if (spec.seed === 'latest-failure') throw new Error('latest render failed')
      return { drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null }
    })
    const onDiagnosticsChange = vi.fn()
    const view = render(
      <PreviewCanvas
        spec={oldSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={onDiagnosticsChange}
      />,
    )
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    await waitFor(() => expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(1))

    view.rerender(
      <PreviewCanvas
        spec={newSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={onDiagnosticsChange}
      />,
    )

    await waitFor(() => expect(onDiagnosticsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ severity: 'error', code: 'PREVIEW_RENDER_FAILED' }),
    ]))
    expect(contexts.get(display)?.clearRect).toHaveBeenCalledTimes(2)
    expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(1)
  })

  it('ignores an obsolete rejection after the newest preview has committed', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const oldSpec = generateMonster({ seed: 'obsolete-failure', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const newSpec = { ...oldSpec, seed: 'newest-success' }
    const oldRender = deferred<RenderResult>()
    const renderer: PreviewRenderer = vi.fn((_context, spec) => (
      spec.seed === 'obsolete-failure'
        ? oldRender.promise
        : Promise.resolve({ drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null })
    ))
    const onDiagnosticsChange = vi.fn()
    const view = render(
      <PreviewCanvas
        spec={oldSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={onDiagnosticsChange}
      />,
    )
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
    view.rerender(
      <PreviewCanvas
        spec={newSpec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={onDiagnosticsChange}
      />,
    )
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    await waitFor(() => expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(1))
    await act(async () => oldRender.reject(new Error('obsolete render failed')))

    expect(onDiagnosticsChange.mock.calls.flatMap(([items]) => items as Diagnostic[]))
      .not.toContainEqual(expect.objectContaining({ code: 'PREVIEW_RENDER_FAILED' }))
    expect(contexts.get(display)?.clearRect).toHaveBeenCalledTimes(1)
  })

  it('does not commit a pending render after unmount', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'unmounted', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const pending = deferred<RenderResult>()
    const renderer: PreviewRenderer = vi.fn(() => pending.promise)
    const onDiagnosticsChange = vi.fn()
    const onRenderComplete = vi.fn()
    const view = render(
      <PreviewCanvas
        spec={spec}
        catalog={catalog}
        renderer={renderer}
        onDiagnosticsChange={onDiagnosticsChange}
        onRenderComplete={onRenderComplete}
      />,
    )
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
    view.unmount()
    await act(async () => pending.resolve({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null,
    }))

    expect(contexts.get(display)?.drawImage).not.toHaveBeenCalled()
    expect(onDiagnosticsChange.mock.calls.flatMap(([items]) => items as Diagnostic[])).toEqual([])
    expect(onRenderComplete).not.toHaveBeenCalled()
  })
})
