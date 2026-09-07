import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { parseCatalog } from '@qmonster/generator-core'
import productionCatalogDocument from '../../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import { createCatalogReportModel } from '../catalog-report.js'
import { CatalogReport } from './CatalogReport.js'

const parsedCatalog = parseCatalog(productionCatalogDocument)
if (!parsedCatalog.ok) throw new Error('Expected the v0.6 production catalog to be valid.')

describe('CatalogReport', () => {
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
})
