import { createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  parseCatalog,
  parseMonsterSpec,
  type MonsterSpec,
} from '@qmonster/generator-core'
import type { RenderResult } from '@qmonster/renderer-canvas'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import { PreviewCanvas } from './components/PreviewCanvas.js'

interface AcceptanceRenderResult extends RenderResult {
  dataUrl: string
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

  return new Promise((resolve, reject) => {
    const onRenderComplete = (result: RenderResult) => {
      const canvas = canvasRef.current
      if (canvas === null) {
        reject(new Error('Acceptance canvas was not committed.'))
        return
      }
      resolve({ ...result, dataUrl: canvas.toDataURL('image/png') })
    }

    root.render(createElement(PreviewCanvas, {
      key: sequence,
      ref: canvasRef,
      spec,
      catalog: productionCatalog,
      onDiagnosticsChange: () => undefined,
      onRenderComplete,
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
