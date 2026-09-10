import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCatalog } from '@qmonster/generator-core'
import productionCatalogDocument from '../../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import v08CatalogDocument from '../../../../packages/asset-catalog/catalog/v0.8.0/catalog.json'
import candidatePointer from '../../../../packages/asset-catalog/releases/candidate-v0.9.0.json'
import { createCatalogReportModel } from '../catalog-report.js'
import { loadActiveProductionRelease } from '../v09-production-release.js'
import { CatalogReport } from './CatalogReport.js'
import type { PreviewRenderer } from './PreviewCanvas.js'

const parsedCatalog = parseCatalog(productionCatalogDocument)
if (!parsedCatalog.ok) throw new Error('Expected the v0.6 production catalog to be valid.')
const parsedV08Catalog = parseCatalog(v08CatalogDocument)
if (!parsedV08Catalog.ok) throw new Error('Expected the v0.8 production catalog to be valid.')

afterEach(() => vi.restoreAllMocks())

describe('CatalogReport', () => {
  it('shows the immutable v0.9 skeleton weights and inspectable sealed trait metadata', async () => {
    const user = userEvent.setup()
    const release = await loadActiveProductionRelease({ pointer: candidatePointer })
    const model = createCatalogReportModel(release)

    render(<CatalogReport model={model} resolveV09ResourceUrl={async sha256 => `/resource/${sha256}`} />)

    expect(screen.getByRole('heading', { name: 'v0.9 原子骨架图鉴' })).toBeTruthy()
    expect(screen.getByText('feline-sit-v2-core · 权重 8')).toBeTruthy()
    expect(screen.getByText('feline-sit-v2-legendary-01 · 权重 1')).toBeTruthy()
    expect(screen.getByText(candidatePointer.releaseManifestSha256)).toBeTruthy()
    expect(screen.getByText('bodyColor · 8/4/1')).toBeTruthy()
    const skeletonPool = screen.getByRole('region', { name: '完整骨架池' })
    const skeletonCards = within(skeletonPool).getAllByRole('article', { name: /完整骨架/ })
    expect(skeletonCards).toHaveLength(2)
    for (const skeleton of model.skeletons) {
      const card = within(skeletonPool).getByRole('article', { name: `${skeleton.id} 完整骨架` })
      expect((await within(card).findByRole('img', { name: `${skeleton.id} 中性完整母版` })).getAttribute('src'))
        .toBe(`/resource/${skeleton.neutralMasterSha256}`)
      expect(within(card).getByText(`权重 ${skeleton.weight}`)).toBeTruthy()
      expect(within(card).getByText('已批准')).toBeTruthy()
      expect(within(card).getByText(skeleton.neutralMasterSha256)).toBeTruthy()
    }

    await user.click(screen.getByRole('button', { name: 'headAppendage · 8/4/1' }))
    const firstCard = screen.getAllByRole('article', { name: /headAppendage trait/ })[0]!
    expect(within(firstCard).getByText(/已批准/)).toBeTruthy()
    expect(within(firstCard).getByText(/interface:/)).toBeTruthy()
    expect(within(firstCard).getByText(/shapeClass:/)).toBeTruthy()
    expect(within(firstCard).getByText(/[a-f0-9]{64}/)).toBeTruthy()
    expect(await within(firstCard).findByRole('img', { name: /完整上下文预览/ })).toBeTruthy()
  })

  it('shows one 13-trait complete-specimen page per v0.8 slot', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { canvas: this, clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    } as unknown as typeof HTMLCanvasElement.prototype.getContext)
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null, connectorMetrics: [],
    }))
    const user = userEvent.setup()

    render(<CatalogReport
      model={createCatalogReportModel(parsedV08Catalog.value)}
      traitRenderer={renderer}
      traitResolver={{ resolve: vi.fn() }}
    />)

    expect(screen.getByText('bodyFrame_l_aurora-ruff')).toBeTruthy()
    expect(screen.queryByText('eyes_l_nebula-iris')).toBeNull()
    await user.click(screen.getByRole('button', { name: '眼睛 · 8/4/1' }))
    expect(screen.getByText('eyes_l_nebula-iris')).toBeTruthy()
    expect(screen.getAllByText(/eyes_[nrl]_/)).toHaveLength(13)
  })

  it('shows the current feline rarity split and makes the visual rarity filter inspectable', async () => {
    const user = userEvent.setup()
    const model = createCatalogReportModel(parsedCatalog.value)

    render(
      <CatalogReport
        model={model}
        resolveAssetUrl={async () => { throw new Error('fixture image unavailable') }}
      />,
    )

    expect(screen.getByRole('heading', { name: '坐姿猫稀有度图鉴' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '完整外形' })).toBeTruthy()
    expect(screen.getByText('局部特征当前全部为普通')).toBeTruthy()
    expect(screen.getByText('全局变异')).toBeTruthy()
    expect(screen.getByText('feline-sit-saffron-longtail')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '稀有 R' }))

    expect(screen.getByText('feline-sit-rose-longtail')).toBeTruthy()
    expect(screen.getByText('feline-sit-umber-curl')).toBeTruthy()
    expect(screen.queryByText('feline-sit-saffron-longtail')).toBeNull()
    await waitFor(() => expect(screen.getAllByText('外观图暂不可用')).toHaveLength(2))
  })

  it('keeps image load failures visible after a URL has resolved', async () => {
    const model = createCatalogReportModel(parsedCatalog.value)

    render(<CatalogReport model={model} resolveAssetUrl={async () => '/image-will-fail.png'} />)

    const image = await screen.findByRole('img', { name: 'feline-sit-saffron-longtail 外观预览' })
    fireEvent.error(image)

    expect(screen.getByText('外观图暂不可用')).toBeTruthy()
  })

  it('renders a future archetype as its own selectable report tab', async () => {
    const user = userEvent.setup()
    const catalog = structuredClone(parsedCatalog.value)
    const felineBundle = catalog.anatomyBundles?.[0]
    if (felineBundle === undefined) throw new Error('Expected a feline bundle fixture.')
    catalog.anatomyBundles?.push({ ...felineBundle, id: 'canine-sit-test', archetypeId: 'canine' })

    render(<CatalogReport model={createCatalogReportModel(catalog)} resolveAssetUrl={async () => '/canine.png'} />)
    await user.click(screen.getByRole('button', { name: 'canine' }))

    expect(screen.getByRole('heading', { name: 'canine稀有度图鉴' })).toBeTruthy()
    expect(screen.getByText('canine-sit-test')).toBeTruthy()
    expect(screen.queryByText('feline-sit-saffron-longtail')).toBeNull()
  })
})
