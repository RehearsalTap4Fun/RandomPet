import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMonster, type Diagnostic } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import {
  CatalogImageResolverCache,
  PreviewCanvas,
  resolveProductionAssetUrl,
  type PreviewRenderer,
} from './PreviewCanvas.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
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
  })
})

describe('PreviewCanvas', () => {
  it('always exposes a 1024 square backing canvas', async () => {
    installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'preview', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const renderer: PreviewRenderer = vi.fn(async () => ({ drawnAssetIds: [], diagnostics: [] }))
    render(<PreviewCanvas spec={spec} catalog={catalog} renderer={renderer} onDiagnosticsChange={() => undefined} />)

    const canvas = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(canvas.width).toBe(1024)
    expect(canvas.height).toBe(1024)
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
  })

  it('commits only the newest async render and never publishes stale diagnostics', async () => {
    const { contexts } = installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const oldSpec = generateMonster({ seed: 'old', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const newSpec = { ...oldSpec, seed: 'new' }
    const oldRender = deferred<{ drawnAssetIds: string[]; diagnostics: Diagnostic[] }>()
    const newRender = deferred<{ drawnAssetIds: string[]; diagnostics: Diagnostic[] }>()
    const renderer: PreviewRenderer = vi.fn((_context, spec) => (
      spec.seed === 'old' ? oldRender.promise : newRender.promise
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
    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(2))

    const newest: Diagnostic = {
      severity: 'warning', code: 'NEW_RENDER', path: [], message: 'new',
    }
    const stale: Diagnostic = {
      severity: 'error', code: 'STALE_RENDER', path: [], message: 'old',
    }
    await act(async () => newRender.resolve({ drawnAssetIds: [], diagnostics: [newest] }))
    await act(async () => oldRender.resolve({ drawnAssetIds: [], diagnostics: [stale] }))

    const published = onDiagnosticsChange.mock.calls.map(([items]) => items as Diagnostic[])
    expect(published.filter(items => items.length > 0)).toEqual([[newest]])
    const display = screen.getByRole('img', { name: '生物预览' }) as HTMLCanvasElement
    expect(contexts.get(display)?.drawImage).toHaveBeenCalledTimes(1)
  })
})
