import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parseCatalog } from '@qmonster/generator-core'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import { createCatalogReportModel } from './catalog-report.js'
import { CatalogReport } from './components/CatalogReport.js'
import './styles/tokens.css'
import './styles/catalog-report.css'

const parsedCatalog = parseCatalog(productionCatalogDocument)
if (!parsedCatalog.ok) {
  throw new Error(`Catalog report cannot read the production catalog: ${parsedCatalog.diagnostics.map(item => item.code).join(', ')}`)
}

const root = document.getElementById('root')
if (root === null) throw new Error('Catalog report root element is missing.')

document.body.classList.add('catalog-report-page')

createRoot(root).render(
  <StrictMode>
    <CatalogReport model={createCatalogReportModel(parsedCatalog.value)} />
  </StrictMode>,
)
