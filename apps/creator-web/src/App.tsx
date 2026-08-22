import { useCallback, useMemo, useState } from 'react'
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

const parsedProductionCatalog = parseCatalog(productionCatalogDocument)
if (!parsedProductionCatalog.ok) {
  throw new Error(`Production catalog is invalid: ${parsedProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const productionCatalog = parsedProductionCatalog.value

interface CreatorWorkbenchProps {
  session: CreatorSession
  catalog: Catalog
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

function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify([
    diagnostic.severity,
    diagnostic.code,
    diagnostic.path,
    diagnostic.message,
  ])
}

function mergeDiagnostics(...groups: ReadonlyArray<readonly Diagnostic[]>): Diagnostic[] {
  const merged: Diagnostic[] = []
  const seen = new Set<string>()
  for (const diagnostic of groups.flat()) {
    const key = diagnosticKey(diagnostic)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(diagnostic)
  }
  return merged
}

function ReservedActions({ capabilities }: { capabilities: CreatorSession['exportCapabilities'] }) {
  const upcoming = '导入与导出将在下一阶段启用。'
  return (
    <div className="topbar__actions" role="toolbar" aria-label="数据与导出">
      <button type="button" disabled title={upcoming}>导入 JSON</button>
      <button type="button" disabled title={upcoming}>导出 JSON</button>
      <button type="button" disabled title={upcoming}>导出透明 PNG</button>
      <button
        type="button"
        disabled
        title={capabilities.webp ? upcoming : '当前浏览器不支持 WebP 编码。'}
      >
        导出透明 WebP
      </button>
    </div>
  )
}

function StatusStrip({
  session,
  catalog,
  diagnostics,
}: {
  session: CreatorSession
  catalog: Catalog
  diagnostics: readonly Diagnostic[]
}) {
  const completeSlots = VISUAL_SLOT_IDS.filter(slotId => catalog.parts.some(part => (
    part.slotId === slotId && part.id === session.spec.visualSlots[slotId].partId
  ))).length
  const lockCount = VISUAL_SLOT_IDS.filter(slotId => session.locks[slotId]).length
  const errorCount = diagnostics.filter(item => item.severity === 'error').length
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
  onAction,
  previewRenderer,
}: CreatorWorkbenchProps) {
  const [renderDiagnostics, setRenderDiagnostics] = useState<Diagnostic[]>([])
  const [observationBackground, setObservationBackground] = useState<ObservationBackground>('studio')
  const onRenderDiagnostics = useCallback((diagnostics: Diagnostic[]) => {
    setRenderDiagnostics(diagnostics)
  }, [])
  const diagnostics = useMemo(
    () => mergeDiagnostics(session.diagnostics, renderDiagnostics),
    [renderDiagnostics, session.diagnostics],
  )

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
        <ReservedActions capabilities={session.exportCapabilities} />
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
              spec={session.spec}
              catalog={catalog}
              onDiagnosticsChange={onRenderDiagnostics}
              {...(previewRenderer === undefined ? {} : { renderer: previewRenderer })}
            />
            <span className="preview-stage__label">1024 × 1024 · 实时合成</span>
          </div>
          <StatusStrip session={session} catalog={catalog} diagnostics={diagnostics} />
          <DiagnosticsPanel diagnostics={diagnostics} />
        </section>

        <SlotPanel session={session} catalog={catalog} onAction={onAction} />
      </main>
    </div>
  )
}

export function App() {
  const { session, dispatch } = useCreator({
    catalog: productionCatalog,
    initialRequest: {
      seed: 'qmonster-v0.1-first-hatch',
      themeId: 'fungal',
      mode: 'normal',
    },
    exportCapabilities: { png: true, webp: true },
  })

  return <CreatorWorkbench session={session} catalog={productionCatalog} onAction={dispatch} />
}
