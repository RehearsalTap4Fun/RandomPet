import { createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  parseCatalog,
  parseMonsterSpec,
  type Diagnostic,
  type MonsterSpec,
} from '@qmonster/generator-core'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.1.0/catalog.json'
import { PreviewCanvas } from './components/PreviewCanvas.js'

interface AcceptanceRenderResult {
  dataUrl: string
  diagnostics: Diagnostic[]
}

declare global {
  interface Window {
    renderAcceptanceMonster: (spec: unknown) => Promise<AcceptanceRenderResult>
  }
}

const parsedCatalog = parseCatalog(productionCatalogDocument)
if (!parsedCatalog.ok) {
  throw new Error(`Production catalog is invalid: ${parsedCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
const productionCatalog = parsedCatalog.value

const container = document.querySelector<HTMLElement>('#acceptance-root')
if (container === null) throw new Error('Acceptance renderer root is missing.')
const root = createRoot(container)
let renderSequence = 0

function renderSpec(spec: MonsterSpec): Promise<AcceptanceRenderResult> {
  const canvasRef = createRef<HTMLCanvasElement>()
  const sequence = ++renderSequence
  let diagnosticPublication = 0

  return new Promise((resolve, reject) => {
    const onDiagnosticsChange = (diagnostics: Diagnostic[]) => {
      diagnosticPublication += 1
      if (diagnosticPublication === 1) return
      const canvas = canvasRef.current
      if (canvas === null) {
        reject(new Error('Acceptance canvas was not committed.'))
        return
      }
      if (diagnostics.some(item => item.severity === 'error')) {
        reject(new Error(`Acceptance render failed: ${JSON.stringify(diagnostics)}`))
        return
      }
      resolve({ dataUrl: canvas.toDataURL('image/png'), diagnostics })
    }

    root.render(createElement(PreviewCanvas, {
      key: sequence,
      ref: canvasRef,
      spec,
      catalog: productionCatalog,
      onDiagnosticsChange,
    }))
  })
}

window.renderAcceptanceMonster = async (input: unknown) => {
  const parsedSpec = parseMonsterSpec(input)
  if (!parsedSpec.ok) {
    throw new Error(`Acceptance spec is invalid: ${JSON.stringify(parsedSpec.diagnostics)}`)
  }
  document.body.dataset.renderComplete = 'false'
  try {
    const result = await renderSpec(parsedSpec.value)
    document.body.dataset.renderComplete = 'true'
    delete document.body.dataset.renderError
    return result
  } catch (error) {
    document.body.dataset.renderError = error instanceof Error ? error.message : String(error)
    throw error
  }
}

document.body.dataset.rendererReady = 'true'
