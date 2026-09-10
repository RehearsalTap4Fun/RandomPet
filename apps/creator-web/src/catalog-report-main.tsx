import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createCatalogReportModel } from './catalog-report.js'
import { CatalogReport } from './components/CatalogReport.js'
import { loadProductionBootstrap } from './production-bootstrap.js'
import './styles/tokens.css'
import './styles/catalog-report.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Catalog report root element is missing.')

document.body.classList.add('catalog-report-page')
const production = await loadProductionBootstrap()
const reportModel = production.kind === 'v09'
  ? createCatalogReportModel(production.release)
  : createCatalogReportModel(production.catalog)

createRoot(root).render(
  <StrictMode>
    <CatalogReport model={reportModel} />
  </StrictMode>,
)
