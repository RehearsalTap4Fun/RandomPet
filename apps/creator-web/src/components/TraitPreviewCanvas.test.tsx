import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCatalog } from '@qmonster/generator-core'
import type { PreviewRenderer } from './PreviewCanvas.js'
import catalogDocument from '../../../../packages/asset-catalog/catalog/v0.8.0/catalog.json'
import { TraitPreviewCanvas } from './TraitPreviewCanvas.js'

const parsed = parseCatalog(catalogDocument)
if (!parsed.ok) throw new Error('Expected v0.8 catalog fixture.')

afterEach(() => vi.restoreAllMocks())

describe('TraitPreviewCanvas', () => {
  it('renders a selected trait as a complete specimen through the production render contract', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { canvas: this, clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    } as unknown as typeof HTMLCanvasElement.prototype.getContext)
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: [],
    }))

    render(<TraitPreviewCanvas
      catalog={parsed.value}
      bundleId="feline-sit-canonical-v1"
      partId="eyes_l_nebula-iris"
      renderer={renderer}
      resolver={{ resolve: vi.fn() }}
    />)

    await waitFor(() => expect(renderer).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('img', { name: 'Nebula Iris 完整形象预览' })).toBeTruthy()
  })
})
