import { useCallback, useEffect, useRef, useState } from 'react'
import { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import { detectExportCapabilities } from '@qmonster/renderer-canvas'
import {
  V09_TRAIT_SLOT_IDS,
  generateMonsterV09,
  parseCatalog,
  rerollV09Skeleton,
  rerollV09Slot,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type V09TraitSlotId,
} from '@qmonster/generator-core'
import type { V09ResourceResolver } from '@qmonster/renderer-canvas'
import legacyProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.1.0/catalog.json'
import v02ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import v03ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.3.0/catalog.json'
import v04ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.4.0/catalog.json'
import v05ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.5.0/catalog.json'
import v06ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.8.0/catalog.json'
import { useCreator } from './hooks/useCreator.js'
import {
  createV09CreatorSession,
  type AnyCreatorSession,
  type CreatorAction,
  type CreatorSession,
  type V09CreatorSession,
} from './state/contracts.js'
import { loadSession, saveSession, type SessionStorage } from './state/persistence.js'
import { refreshSessionValidity } from './state/session-diagnostics.js'
import { DiagnosticsPanel } from './components/DiagnosticsPanel.js'
import { GeneratorControls } from './components/GeneratorControls.js'
import {
  PreviewCanvas,
  previewFrameKey,
  type PreviewRenderer,
  type V09PreviewRenderer,
} from './components/PreviewCanvas.js'
import { SlotPanel } from './components/SlotPanel.js'
import { ExportControls } from './components/ExportControls.js'
import type { ExportControlsProps } from './components/ExportControls.js'
import { CompositionStatus } from './components/CompositionStatus.js'
import { LegacySpecViewer } from './components/LegacySpecViewer.js'
import type { ProductionV09Release } from './v09-production-release.js'

const parsedProductionCatalog = parseCatalog(productionCatalogDocument)
if (!parsedProductionCatalog.ok) {
  throw new Error(`Production catalog is invalid: ${parsedProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const productionCatalog = parsedProductionCatalog.value
const parsedV06ProductionCatalog = parseCatalog(v06ProductionCatalogDocument)
if (!parsedV06ProductionCatalog.ok) {
  throw new Error(`V0.6 production catalog is invalid: ${parsedV06ProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const v06ProductionCatalog = parsedV06ProductionCatalog.value
const parsedV05ProductionCatalog = parseCatalog(v05ProductionCatalogDocument)
if (!parsedV05ProductionCatalog.ok) {
  throw new Error(`V0.5 production catalog is invalid: ${parsedV05ProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const v05ProductionCatalog = parsedV05ProductionCatalog.value
const parsedV03ProductionCatalog = parseCatalog(v03ProductionCatalogDocument)
if (!parsedV03ProductionCatalog.ok) {
  throw new Error(`V0.3 production catalog is invalid: ${parsedV03ProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const v03ProductionCatalog = parsedV03ProductionCatalog.value
const parsedV04ProductionCatalog = parseCatalog(v04ProductionCatalogDocument)
if (!parsedV04ProductionCatalog.ok) {
  throw new Error(`V0.4 production catalog is invalid: ${parsedV04ProductionCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
export const v04ProductionCatalog = parsedV04ProductionCatalog.value
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
  ['0.3.0', async () => v03ProductionCatalog],
  ['0.4.0', async () => v04ProductionCatalog],
  ['0.5.0', async () => v05ProductionCatalog],
  ['0.6.0', async () => v06ProductionCatalog],
  ['0.8.0', async () => productionCatalog],
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
  const bundle = catalog.anatomyBundles?.find(item => item.id === session.spec.anatomyBundleId)

  return (
    <ul className="status-strip" aria-label="作品状态">
      <li><span aria-hidden="true">◫</span> 槽位 {completeSlots}/14</li>
      <li><span aria-hidden="true">◆</span> 锁定 {lockCount}</li>
      <li className={errorCount > 0 ? 'status-strip__error' : ''}>
        <span aria-hidden="true">!</span> 错误 {errorCount}
      </li>
      <li><span aria-hidden="true">●</span> 主题 {theme?.displayName ?? session.spec.themeId}</li>
      {bundle !== undefined && <li><span aria-hidden="true">✦</span> 外形 {bundle.id}</li>}
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
  const [committedPreviewKey, setCommittedPreviewKey] = useState<string | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const requestedPreviewKey = previewFrameKey(session.spec, catalog, previewRenderer)
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
          imageExportReady={committedPreviewKey === requestedPreviewKey}
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
              onRenderCommit={setCommittedPreviewKey}
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
  v09Release?: ProductionV09Release
  v09Resolver?: V09ResourceResolver
  v09PreviewRenderer?: V09PreviewRenderer
  initialExportCapabilities?: CreatorSession['exportCapabilities']
  parseSpecFile?: ExportControlsProps['parseSpecFile']
  storage?: SessionStorage
  previewRenderer?: PreviewRenderer
  onSessionChange?: (session: CreatorSession) => void
  onAnySessionChange?: (session: AnyCreatorSession) => void
}

export function App({
  catalog = productionCatalog,
  v09Release,
  v09Resolver,
  v09PreviewRenderer,
  initialExportCapabilities,
  parseSpecFile,
  storage,
  previewRenderer,
  onSessionChange,
  onAnySessionChange,
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

  if (v09Release !== undefined) {
    return <V09CreatorApp
      release={v09Release}
      exportCapabilities={exportCapabilities}
      {...(storage === undefined ? {} : { storage })}
      {...(v09Resolver === undefined ? {} : { resolver: v09Resolver })}
      {...(v09PreviewRenderer === undefined ? {} : { previewRenderer: v09PreviewRenderer })}
      {...(onAnySessionChange === undefined ? {} : { onSessionChange: onAnySessionChange })}
    />
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

const V09_SLOT_LABEL: Record<V09TraitSlotId, string> = {
  bodyColor: '全身配色', surfacePattern: '全身图案', surfaceTexture: '表面质感',
  forepawDetail: '前爪细节', hindpawDetail: '后爪细节', tailSurface: '尾部表面',
  eyes: '成对眼睛', mouthShape: '嘴型', oralDetail: '口腔细节',
  headAppendage: '头部附属物', extraAppendage: '额外附属物', effect: '特效',
}

function V09CreatorApp({
  release,
  exportCapabilities,
  storage,
  resolver,
  previewRenderer,
  onSessionChange,
}: {
  release: ProductionV09Release
  exportCapabilities: V09CreatorSession['exportCapabilities']
  storage?: SessionStorage
  resolver?: V09ResourceResolver
  previewRenderer?: V09PreviewRenderer
  onSessionChange?: (session: AnyCreatorSession) => void
}) {
  const [seedInput, setSeedInput] = useState('qmonster-v0.9-first-hatch')
  const [loaded] = useState(() => loadSession(
    () => createV09CreatorSession(
      generateMonsterV09({ seed: 'qmonster-v0.9-first-hatch' }, release.catalog),
      exportCapabilities,
      release.manifestHash,
    ),
    storage,
    {
      schemaVersion: '0.4.0', catalogVersion: '0.9.0', rendererVersion: '0.9.0',
      releaseManifestSha256: release.manifestHash,
    },
  ))
  const [session, setSession] = useState(loaded.session)
  const [persistenceDiagnostics, setPersistenceDiagnostics] = useState<Diagnostic[]>(loaded.diagnostics)

  useEffect(() => {
    onSessionChange?.(session)
  }, [onSessionChange, session])

  useEffect(() => {
    let active = true
    void saveSession(session, storage).then(diagnostics => {
      if (active) setPersistenceDiagnostics(diagnostics)
    })
    return () => { active = false }
  }, [session, storage])

  const applyGeneration = useCallback((result: ReturnType<typeof generateMonsterV09>) => {
    setSession(current => refreshSessionValidity({
      ...current,
      spec: result.spec,
      generationDiagnostics: result.diagnostics,
      renderDiagnostics: [],
    }))
  }, [])
  const setRenderDiagnostics = useCallback((diagnostics: Diagnostic[]) => {
    setSession(current => refreshSessionValidity({ ...current, renderDiagnostics: diagnostics }))
  }, [])
  const diagnostics = [...session.diagnostics, ...persistenceDiagnostics]

  return (
    <div className="creator-app">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <div><p className="eyebrow">ATOMIC SKELETON LAB</p><h1>怪奇生物生成器</h1></div>
          <span className="version-pill">v0.9</span>
        </div>
      </header>
      <main className="workbench-grid">
        <section className="generator-controls" aria-label="v0.9 生成控制">
          <label>种子<input value={seedInput} onChange={event => setSeedInput(event.currentTarget.value)} /></label>
          <button type="button" onClick={() => applyGeneration(generateMonsterV09({ seed: seedInput }, release.catalog))}>生成新生物</button>
          <fieldset aria-label="完整骨架">
            <legend>完整骨架</legend>
            <p>{session.spec.skeletonFamilyId} · {session.spec.skeletonSelection.class}</p>
            <label><input
              type="checkbox"
              aria-label="锁定完整骨架"
              checked={session.locks.skeleton}
              onChange={() => setSession(current => ({
                ...current, locks: { ...current.locks, skeleton: !current.locks.skeleton },
              }))}
            />锁定</label>
            <button
              type="button"
              disabled={session.locks.skeleton}
              onClick={() => applyGeneration(rerollV09Skeleton({ spec: session.spec }, release.catalog))}
            >重掷完整骨架</button>
          </fieldset>
        </section>

        <section className="preview-column" aria-label="v0.9 实时预览">
          <h2>实时预览</h2>
          <PreviewCanvas
            spec={session.spec}
            catalog={release.catalog}
            onDiagnosticsChange={setRenderDiagnostics}
            {...(resolver === undefined ? {} : { v09Resolver: resolver })}
            {...(previewRenderer === undefined ? {} : { v09Renderer: previewRenderer })}
          />
          <ul className="status-strip" aria-label="作品状态">
            <li>槽位 12/12</li>
            <li>目录 v0.9.0</li>
            <li>骨架 {session.spec.skeletonSelection.class}</li>
          </ul>
          <DiagnosticsPanel diagnostics={diagnostics} />
        </section>

        <section className="slot-panel" aria-label="v0.9 外观控制">
          {V09_TRAIT_SLOT_IDS.map(slotId => {
            const selection = session.spec.visualSlots[slotId]
            const sentinel = slotId === 'oralDetail' && selection.traitId === 'oral-none'
            return (
              <fieldset key={slotId} aria-label={`${slotId} 外观槽位`}>
                <legend>{V09_SLOT_LABEL[slotId]}</legend>
                <code>{selection.traitId}</code>
                <span>{selection.rarity}</span>
                <label><input
                  type="checkbox"
                  aria-label={`锁定 ${slotId}`}
                  checked={session.locks.visualSlots[slotId]}
                  disabled={sentinel}
                  onChange={() => setSession(current => ({
                    ...current,
                    locks: {
                      ...current.locks,
                      visualSlots: {
                        ...current.locks.visualSlots,
                        [slotId]: !current.locks.visualSlots[slotId],
                      },
                    },
                  }))}
                />锁定</label>
                <button
                  type="button"
                  disabled={session.locks.visualSlots[slotId] || sentinel}
                  onClick={() => applyGeneration(rerollV09Slot({ spec: session.spec, slotId }, release.catalog))}
                >重掷 {slotId}</button>
              </fieldset>
            )
          })}
        </section>
      </main>
    </div>
  )
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
  const initialRequest = editorCatalog.version === '0.6.0' || editorCatalog.version === '0.8.0'
    ? {
        seed: 'qmonster-v0.1-first-hatch',
        themeId: 'fungal' as const,
        mode: 'normal' as const,
        archetypeId: 'feline' as const,
      }
    : {
        seed: 'qmonster-v0.1-first-hatch',
        themeId: 'fungal' as const,
        mode: 'normal' as const,
      }
  const { session, dispatch } = useCreator({
    catalog: editorCatalog,
    initialRequest,
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
