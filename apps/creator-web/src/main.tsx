import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { loadProductionBootstrap } from './production-bootstrap.js'
import './styles/tokens.css'
import './styles/workbench.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Creator root element is missing.')
const production = await loadProductionBootstrap()

createRoot(root).render(
  <StrictMode>
    {production.kind === 'v09'
      ? <App v09Release={production.release} v09Resolver={production.resolver} />
      : <App catalog={production.catalog} />}
  </StrictMode>,
)
