import { useCallback, useEffect, useRef, useState } from 'react'
import { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import { detectExportCapabilities } from '@qmonster/renderer-canvas'
import {
  parseCatalog,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
} from '@qmonster/generator-core'
import legacyProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.1.0/catalog.json'
import v02ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.3.0/catalog.json'
import { useCreator } from './hooks/useCreator.js'
import type { CreatorAction, CreatorSession } from './state/contracts.js'
import type { SessionStorage } from './state/persistence.js'
import { DiagnosticsPanel } from './components/DiagnosticsPanel.js'
import { GeneratorControls } from './components/GeneratorControls.js'
import {
  PreviewCanvas,
  type PreviewRenderer,
} from './components/PreviewCanvas.js'
import { SlotPanel } from './components/SlotPanel.js'
import { ExportControls } from './components/ExportControls.js'
import type { ExportControlsProps } from './components/ExportControls.js'
import { CompositionStatus } from './components/CompositionStatus.js'
import { LegacySpecViewer } from './components/LegacySpecViewer.js'

const parsedProductionCatalog = parseCatalog(productionCatalogDocument)
if (!parsedProductionCatalog.ok) {
  throw new Error(`Production catalog is invalid: ${parsedProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const productionCatalog = parsedProductionCatalog.value
export const v03ProductionCatalog = productionCatalog
const parsedLegacyProductionCatalog = parseCatalog(legacyProductionCatalogDocument)
if (!parsedLegacyProductionCatalog.ok) {
  throw new Error(`Legacy production catalog is invalid: ${parsedLegacyProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const legacyProductionCatalog = parsedLegacyProductionCatalog.value
const parsedV02ProductionCatalog = parseCatalog(v02ProductionCatalogDocument)
if (!parsedV02ProductionCatalog.ok) {
  throw new Error(`Rejected v0.2 production catalog is invalid: ${parsedV02ProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const v02ProductionCatalog = parsedV02ProductionCatalog.value
export const productionCatalogRegistry = new CatalogRegistry(new Map([
  ['0.1.0', async () => legacyProductionCatalog],
  ['0.2.0', async () => v02ProductionCatalog],
  ['0.3.0', async () => productionCatalog],
]))

interface CreatorWorkbenchProps {
  session: CreatorSession
  catalog: Catalog
  catalogRegistry?: CatalogRegistry
  onAction: (action: CreatorAction) => void
  onInspectLegacy?: (payload: { spec: import('@qmonster/generator-core').MonsterSpec; catalog: Catalog }) => void
  parseSpecFile?: ExportControlsProps['parseSpecFile']
  previewRenderer?: PreviewRenderer
  editableCatalogVersion?: string
  onActivateCatalog?: (catalog: Catalog) => void
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
  onInspectLegacy,
  parseSpecFile,
  previewRenderer,
  editableCatalogVersion = catalog.version,
  onActivateCatalog,
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
          onImportComplete={payload => {
            if (payload.catalog.version === editableCatalogVersion) {
              onActivateCatalog?.(payload.catalog)
              onAction({ type: 'importSpec', spec: payload.spec })
              return
            }
            onInspectLegacy?.(payload)
          }}
          onOperationDiagnostics={setOperationDiagnostics}
          {...(parseSpecFile === undefined ? {} : { parseSpecFile })}
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
          <CompositionStatus
            spec={session.spec}
            catalog={catalog}
            diagnostics={session.diagnostics}
          />
          <DiagnosticsPanel diagnostics={[...session.diagnostics, ...operationDiagnostics]} />
        </section>

        <SlotPanel session={session} catalog={catalog} onAction={onAction} />
      </main>
    </div>
  )
}

interface AppProps {
  catalog?: Catalog
  initialExportCapabilities?: CreatorSession['exportCapabilities']
  parseSpecFile?: ExportControlsProps['parseSpecFile']
  storage?: SessionStorage
  previewRenderer?: PreviewRenderer
  onSessionChange?: (session: CreatorSession) => void
}

export function App({
  catalog = productionCatalog,
  initialExportCapabilities,
  parseSpecFile,
  storage,
  previewRenderer,
  onSessionChange,
}: AppProps = {}) {
  const [exportCapabilities, setExportCapabilities] = useState<CreatorSession['exportCapabilities'] | null>(
    initialExportCapabilities ?? null,
  )

  useEffect(() => {
    if (initialExportCapabilities !== undefined) return undefined
    let active = true
    void detectExportCapabilities().then(capabilities => {
      if (active) setExportCapabilities(capabilities)
    }).catch(() => {
      if (active) setExportCapabilities({ png: false, webp: false })
    })
    return () => {
      active = false
    }
  }, [initialExportCapabilities])

  if (exportCapabilities === null) {
    return <p role="status">正在检测导出能力…</p>
  }

  return <InitializedCreatorApp
    initialCatalog={catalog}
    exportCapabilities={exportCapabilities}
    {...(parseSpecFile === undefined ? {} : { parseSpecFile })}
    {...(storage === undefined ? {} : { storage })}
    {...(previewRenderer === undefined ? {} : { previewRenderer })}
    {...(onSessionChange === undefined ? {} : { onSessionChange })}
  />
}

function InitializedCreatorApp({
  initialCatalog,
  exportCapabilities,
  parseSpecFile,
  storage,
  previewRenderer,
  onSessionChange,
}: {
  initialCatalog: Catalog
  exportCapabilities: CreatorSession['exportCapabilities']
  parseSpecFile?: ExportControlsProps['parseSpecFile']
  storage?: SessionStorage
  previewRenderer?: PreviewRenderer
  onSessionChange?: (session: CreatorSession) => void
}) {
  const [editorCatalog, setEditorCatalog] = useState(initialCatalog)
  const { session, dispatch } = useCreator({
    catalog: editorCatalog,
    initialRequest: {
      seed: 'qmonster-v0.1-first-hatch',
      themeId: 'fungal',
      mode: 'normal',
    },
    exportCapabilities,
    ...(storage === undefined ? {} : { storage }),
  })
  const [legacyInspection, setLegacyInspection] = useState<{
    spec: import('@qmonster/generator-core').MonsterSpec
    catalog: Catalog
  } | null>(null)

  useEffect(() => {
    onSessionChange?.(session)
  }, [onSessionChange, session])

  if (legacyInspection !== null) {
    return <LegacySpecViewer
      spec={legacyInspection.spec}
      catalog={legacyInspection.catalog}
      exportCapabilities={exportCapabilities}
      onReturn={() => setLegacyInspection(null)}
      {...(previewRenderer === undefined ? {} : { previewRenderer })}
    />
  }

  return (
    <CreatorWorkbench
      session={session}
      catalog={editorCatalog}
      catalogRegistry={productionCatalogRegistry}
      editableCatalogVersion={productionCatalog.version}
      onActivateCatalog={setEditorCatalog}
      onAction={dispatch}
      onInspectLegacy={setLegacyInspection}
      {...(parseSpecFile === undefined ? {} : { parseSpecFile })}
      {...(previewRenderer === undefined ? {} : { previewRenderer })}
    />
  )
}
