import { useCallback, useEffect, useRef, useState } from 'react'
import { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import { detectExportCapabilities } from '@qmonster/renderer-canvas'
import {
  parseCatalog,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
} from '@qmonster/generator-core'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.1.0/catalog.json'
import { useCreator } from './hooks/useCreator.js'
import type { CreatorAction, CreatorSession } from './state/contracts.js'
import { DiagnosticsPanel } from './components/DiagnosticsPanel.js'
import { GeneratorControls } from './components/GeneratorControls.js'
import {
  PreviewCanvas,
  type PreviewRenderer,
} from './components/PreviewCanvas.js'
import { SlotPanel } from './components/SlotPanel.js'
import { ExportControls } from './components/ExportControls.js'

const parsedProductionCatalog = parseCatalog(productionCatalogDocument)
if (!parsedProductionCatalog.ok) {
  throw new Error(`Production catalog is invalid: ${parsedProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const productionCatalog = parsedProductionCatalog.value
export const productionCatalogRegistry = new CatalogRegistry(new Map([
  ['0.1.0', async () => productionCatalog],
]))

interface CreatorWorkbenchProps {
  session: CreatorSession
  catalog: Catalog
  catalogRegistry?: CatalogRegistry
  onAction: (action: CreatorAction) => void
  previewRenderer?: PreviewRenderer
}

type ObservationBackground = 'studio' | 'grid' | 'dark'

const OBSERVATION_BACKGROUNDS: ReadonlyArray<{
  value: ObservationBackground
  label: string
}> = [
  { value: 'studio', label: '棚拍' },
  { value: 'grid', label: '透明格' },
  { value: 'dark', label: '深色' },
]

function StatusStrip({
  session,
  catalog,
}: {
  session: CreatorSession
  catalog: Catalog
}) {
  const completeSlots = VISUAL_SLOT_IDS.filter(slotId => catalog.parts.some(part => (
    part.slotId === slotId && part.id === session.spec.visualSlots[slotId].partId
  ))).length
  const lockCount = VISUAL_SLOT_IDS.filter(slotId => session.locks[slotId]).length
  const errorCount = session.diagnostics.filter(item => item.severity === 'error').length
  const theme = catalog.themes.find(item => item.id === session.spec.themeId)

  return (
    <ul className="status-strip" aria-label="作品状态">
      <li><span aria-hidden="true">◫</span> 槽位 {completeSlots}/14</li>
      <li><span aria-hidden="true">◆</span> 锁定 {lockCount}</li>
      <li className={errorCount > 0 ? 'status-strip__error' : ''}>
        <span aria-hidden="true">!</span> 错误 {errorCount}
      </li>
      <li><span aria-hidden="true">●</span> 主题 {theme?.displayName ?? session.spec.themeId}</li>
      <li><span aria-hidden="true">#</span> 目录 v{catalog.version}</li>
    </ul>
  )
}

export function CreatorWorkbench({
  session,
  catalog,
  catalogRegistry = productionCatalogRegistry,
  onAction,
  previewRenderer,
}: CreatorWorkbenchProps) {
  const [observationBackground, setObservationBackground] = useState<ObservationBackground>('studio')
  const [operationDiagnostics, setOperationDiagnostics] = useState<Diagnostic[]>([])
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const onRenderDiagnostics = useCallback((diagnostics: CreatorSession['renderDiagnostics']) => {
    onAction({ type: 'setRenderDiagnostics', diagnostics })
  }, [onAction])

  return (
    <div className="creator-app">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <div>
            <p className="eyebrow">TACTILE SPECIMEN LAB</p>
            <h1>怪奇生物生成器</h1>
          </div>
          <span className="version-pill">v0.1</span>
        </div>
        <ExportControls
          session={session}
          registry={catalogRegistry}
          canvasRef={previewCanvasRef}
          onImportComplete={spec => onAction({ type: 'importSpec', spec })}
          onOperationDiagnostics={setOperationDiagnostics}
        />
      </header>

      <main className="workbench-grid">
        <GeneratorControls session={session} catalog={catalog} onAction={onAction} />

        <section className="preview-column" aria-labelledby="preview-title">
          <div className="preview-heading">
            <div>
              <p className="eyebrow">LIVE COMPOSITE</p>
              <h2 id="preview-title">实时预览</h2>
            </div>
            <code title={session.spec.seed}>seed · {session.spec.seed}</code>
          </div>
          <fieldset className="background-switcher">
            <legend className="sr-only">观察背景</legend>
            {OBSERVATION_BACKGROUNDS.map(background => (
              <label className="background-option" key={background.value}>
                <input
                  className="background-input"
                  type="radio"
                  name="observation-background"
                  value={background.value}
                  checked={observationBackground === background.value}
                  onChange={() => setObservationBackground(background.value)}
                />
                <span className={`background-swatch background-swatch--${background.value}`} aria-hidden="true" />
                <span>{background.label}</span>
              </label>
            ))}
          </fieldset>
          <div className="preview-stage" data-observation-background={observationBackground}>
            <PreviewCanvas
              ref={previewCanvasRef}
              spec={session.spec}
              catalog={catalog}
              onDiagnosticsChange={onRenderDiagnostics}
              {...(previewRenderer === undefined ? {} : { renderer: previewRenderer })}
            />
            <span className="preview-stage__label">1024 × 1024 · 实时合成</span>
          </div>
          <StatusStrip session={session} catalog={catalog} />
          <DiagnosticsPanel diagnostics={[...session.diagnostics, ...operationDiagnostics]} />
        </section>

        <SlotPanel session={session} catalog={catalog} onAction={onAction} />
      </main>
    </div>
  )
}

export function App() {
  const [exportCapabilities, setExportCapabilities] = useState<CreatorSession['exportCapabilities'] | null>(null)

  useEffect(() => {
    let active = true
    void detectExportCapabilities().then(capabilities => {
      if (active) setExportCapabilities(capabilities)
    }).catch(() => {
      if (active) setExportCapabilities({ png: false, webp: false })
    })
    return () => {
      active = false
    }
  }, [])

  if (exportCapabilities === null) {
    return <p role="status">正在检测导出能力…</p>
  }

  return <InitializedCreatorApp exportCapabilities={exportCapabilities} />
}

function InitializedCreatorApp({
  exportCapabilities,
}: {
  exportCapabilities: CreatorSession['exportCapabilities']
}) {
  const { session, dispatch } = useCreator({
    catalog: productionCatalog,
    initialRequest: {
      seed: 'qmonster-v0.1-first-hatch',
      themeId: 'fungal',
      mode: 'normal',
    },
    exportCapabilities,
  })

  return (
    <CreatorWorkbench
      session={session}
      catalog={productionCatalog}
      catalogRegistry={productionCatalogRegistry}
      onAction={dispatch}
    />
  )
}
