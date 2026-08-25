import { createRef } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMonster, type Diagnostic } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import type { RenderResult } from '@qmonster/renderer-canvas'
import {
  CatalogImageResolverCache,
  PreviewCanvas,
  catalogAssetKey,
  resolveProductionAssetUrl,
  type PreviewRenderer,
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
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let context = contexts.get(this)
    if (context === undefined) {
      context = {
        canvas: this,
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D
      contexts.set(this, context)
    }
    return context
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
  return { contexts, spy }
}

afterEach(() => vi.restoreAllMocks())

describe('CatalogImageResolverCache', () => {
  it('builds an exact versioned asset key without fallback', async () => {
    expect(catalogAssetKey('0.2.0', 'parts/eyes_glossy_pair.png'))
      .toContain('/assets/v0.2.0/parts/eyes_glossy_pair.png')
    await expect(resolveProductionAssetUrl('0.1.0', 'parts/eyes_glossy_pair.png')).resolves.toMatch(/v0\.1\.0/)
    await expect(resolveProductionAssetUrl('0.2.0', 'parts/eyes_glossy_pair.png')).resolves.toMatch(/v0\.2\.0/)
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
  it.each(['CONNECTOR_COMPOSITE_FAILED', 'STRUCTURE_DISCONNECTED'])(
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
