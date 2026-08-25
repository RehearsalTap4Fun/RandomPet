import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeValidCatalogFixture, makeValidMonsterSpecFixture } from '@qmonster/generator-core/test-fixtures'
import { LegacySpecViewer } from './LegacySpecViewer.js'
import type { PreviewRenderer } from './PreviewCanvas.js'

const { downloadSpec, downloadRenderedImage } = vi.hoisted(() => ({
  downloadSpec: vi.fn(),
  downloadRenderedImage: vi.fn(() => Promise.resolve()),
}))

vi.mock('../io/spec-file.js', async importOriginal => ({
  ...await importOriginal<typeof import('../io/spec-file.js')>(),
  downloadSpec,
}))
vi.mock('../io/image-file.js', () => ({ downloadRenderedImage }))

function installCanvasContexts() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return { canvas: this, clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
}

describe('LegacySpecViewer', () => {
  it('renders an exact legacy specimen as read-only and returns without editor actions', async () => {
    const user = userEvent.setup()
    installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const onReturn = vi.fn()
    const resolver = { resolve: vi.fn() }
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: null,
    }))

    render(<LegacySpecViewer
      spec={spec}
      catalog={catalog}
      exportCapabilities={{ png: true, webp: true }}
      onReturn={onReturn}
      previewRenderer={renderer}
      resolver={resolver}
    />)

    expect(screen.getByText('旧版标本 · 只读查看')).toBeTruthy()
    expect(screen.getByText('目录 v0.1.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出透明 WebP' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '孵化整只生物' })).toBeNull()
    expect(screen.queryByLabelText('主题')).toBeNull()
    expect(screen.queryByRole('button', { name: /重抽/ })).toBeNull()

    await waitFor(() => expect(renderer).toHaveBeenCalledWith(
      expect.anything(), spec, catalog, resolver, expect.anything(),
    ))
    await user.click(screen.getByRole('button', { name: '导出 JSON' }))
    await user.click(screen.getByRole('button', { name: '导出透明 PNG' }))
    await user.click(screen.getByRole('button', { name: '导出透明 WebP' }))
    expect(downloadSpec).toHaveBeenCalledWith(spec)
    await waitFor(() => expect(downloadRenderedImage).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement), spec, 'image/png',
    ))
    expect(downloadRenderedImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), spec, 'image/webp')

    await user.click(screen.getByRole('button', { name: '返回新版生成器' }))
    expect(onReturn).toHaveBeenCalledOnce()
  })
})
