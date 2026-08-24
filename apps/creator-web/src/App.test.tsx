import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMonster, type Catalog, type Diagnostic } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import { createCreatorSession, type CreatorSession } from './state/contracts.js'
import { refreshSessionValidity } from './state/session-diagnostics.js'
import type { SessionStorage } from './state/persistence.js'
import { App, CreatorWorkbench, legacyProductionCatalog, productionCatalog, productionCatalogRegistry } from './App.js'
import type { PreviewRenderer } from './components/PreviewCanvas.js'

function installCanvasContexts() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      canvas: this,
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())

describe('CreatorWorkbench', () => {
  it('starts first-hatch with catalog and renderer 0.2.0', async () => {
    installCanvasContexts()
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
      callback(new Blob([], { type: 'image/webp' }))
    })
    render(<App />)

    expect(await screen.findByText('目录 v0.2.0')).toBeTruthy()
    expect(productionCatalog.version).toBe('0.2.0')
  })

  it('installs both exact catalog versions without fallback', async () => {
    expect((await productionCatalogRegistry.load('0.1.0')).ok).toBe(true)
    expect((await productionCatalogRegistry.load('0.2.0')).ok).toBe(true)
    expect(await productionCatalogRegistry.load('0.1')).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'CATALOG_VERSION_MISSING' })],
    })
    expect(await productionCatalogRegistry.load('0.2.1')).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'CATALOG_VERSION_MISSING' })],
    })
  })

  it('routes completed preview diagnostics into the creator action stream', async () => {
    installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const session = createCreatorSession(generateMonster({
      seed: 'render-diagnostics', themeId: 'fungal', mode: 'normal',
    }, catalog))
    const renderError: Diagnostic = {
      severity: 'error', code: 'ASSET_LOAD_FAILED', path: ['parts', 'eyes'], message: 'missing',
    }
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [renderError], compositionMetrics: null,
    }))
    const onAction = vi.fn()

    render(
      <CreatorWorkbench
        session={session}
        catalog={catalog}
        onAction={onAction}
        previewRenderer={renderer}
      />,
    )

    await waitFor(() => expect(onAction).toHaveBeenLastCalledWith({
      type: 'setRenderDiagnostics',
      diagnostics: [renderError],
    }))
  })

  it('presents the complete shell, guarded export controls and live status summary', async () => {
    installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const generated = generateMonster({ seed: 'workbench', themeId: 'fungal', mode: 'normal' }, catalog)
    let session = createCreatorSession(generated)
    session.locks.eyes = true
    session.locks.tail = true
    const generationError: Diagnostic = {
      severity: 'error',
      code: 'LOCK_INCOMPATIBLE',
      path: ['visualSlots', 'eyes'],
      message: 'Eyes conflict.',
    }
    const renderWarning: Diagnostic = {
      severity: 'warning', code: 'PREVIEW_NOTE', path: [], message: 'Preview note.',
    }
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [renderWarning], compositionMetrics: null,
    }))
    session = refreshSessionValidity({
      ...session,
      generationDiagnostics: [generationError],
      renderDiagnostics: [renderWarning],
    })

    render(
      <CreatorWorkbench
        session={session}
        catalog={catalog}
        catalogRegistry={new CatalogRegistry(new Map([[catalog.version, async () => catalog]]))}
        onAction={() => undefined}
        previewRenderer={renderer}
      />,
    )

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByRole('button', { name: '导入 JSON' })).toBeEnabled()
    for (const name of ['导出 JSON', '导出透明 PNG', '导出透明 WebP']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByText('槽位 14/14')).toBeTruthy()
    expect(screen.getByText('锁定 2')).toBeTruthy()
    expect(screen.getByText('错误 1')).toBeTruthy()
    expect(screen.getByText('主题 fungal')).toBeTruthy()
    expect(screen.getByText(`目录 v${catalog.version}`)).toBeTruthy()
    const diagnostics = screen.getByRole('region', { name: '诊断信息' })
    await waitFor(() => expect(within(diagnostics).getAllByRole('heading', { level: 3 })
      .map(item => item.textContent)).toEqual(['错误 · 1', '提醒 · 1']))
  })

  it('shows an invalid-import error without changing the current seed or export availability', async () => {
    installCanvasContexts()
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const session = createCreatorSession(generateMonster({
      seed: 'keep-current-work', themeId: 'fungal', mode: 'normal',
    }, catalog), { png: true, webp: true })
    const onAction = vi.fn()
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null,
    }))

    render(
      <CreatorWorkbench
        session={session}
        catalog={catalog}
        catalogRegistry={new CatalogRegistry(new Map([[catalog.version, async () => catalog]]))}
        onAction={onAction}
        previewRenderer={renderer}
      />,
    )

    const seedBefore = screen.getByTitle('keep-current-work').textContent
    await user.upload(
      screen.getByLabelText('选择要导入的 JSON 文件'),
      new File(['not-json'], 'broken.json', { type: 'application/json' }),
    )

    expect(await screen.findByText('SPEC_FILE_INVALID_JSON')).toBeTruthy()
    expect(screen.getByTitle('keep-current-work').textContent).toBe(seedBefore)
    expect(onAction).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'importSpec' }))
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出透明 WebP' })).toBeEnabled()
  })

  it('uses one native radio-group tab stop and arrow keys for the temporary observation background', async () => {
    installCanvasContexts()
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const session = createCreatorSession(generateMonster({
      seed: 'background', themeId: 'fungal', mode: 'normal',
    }, catalog))
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null,
    }))
    const onAction = vi.fn()
    const { container } = render(
      <CreatorWorkbench
        session={session}
        catalog={catalog}
        onAction={onAction}
        previewRenderer={renderer}
      />,
    )

    const stage = container.querySelector<HTMLElement>('.preview-stage')!
    expect(screen.getByRole('group', { name: '观察背景' }).tagName).toBe('FIELDSET')
    const studio = screen.getByRole('radio', { name: '棚拍' }) as HTMLInputElement
    const grid = screen.getByRole('radio', { name: '透明格' }) as HTMLInputElement
    expect(studio.tagName).toBe('INPUT')
    expect(studio.type).toBe('radio')
    expect(studio.checked).toBe(true)

    screen.getByRole('button', { name: '孵化整只生物' }).focus()
    await user.tab()
    expect(document.activeElement).toBe(studio)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: '锁定 体型骨架' }))

    studio.focus()
    const actionCountBeforeBackgroundChange = onAction.mock.calls.length
    await user.keyboard('{ArrowRight}')
    expect(grid.checked).toBe(true)
    expect(stage.dataset.observationBackground).toBe('grid')
    expect(onAction).toHaveBeenCalledTimes(actionCountBeforeBackgroundChange)
  })

  it('returns from legacy inspection without allowing an older concurrent import to mutate the v0.2 session', async () => {
    installCanvasContexts()
    const user = userEvent.setup()
    const preparedSession = refreshSessionValidity({
      ...createCreatorSession(generateMonster({
        seed: 'saved-v0.2-session', themeId: 'shadow', mode: 'normal',
      }, productionCatalog), { png: true, webp: true }),
      generationDiagnostics: [{
        severity: 'warning', code: 'PRESEEDED_DIAGNOSTIC', path: ['visualSlots', 'tail'], message: 'keep this diagnostic',
      }],
      renderDiagnostics: [],
    })
    const storage: SessionStorage = {
      getItem: vi.fn(() => JSON.stringify({ schemaVersion: 2, session: preparedSession })),
      setItem: vi.fn(),
    }
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [], compositionMetrics: null,
    }))
    let observedSession: CreatorSession | undefined
    const slowCurrent = deferred<{ ok: true; value: { spec: ReturnType<typeof generateMonster>['spec']; catalog: Catalog }; diagnostics: Diagnostic[] }>()
    const fastLegacy = deferred<{ ok: true; value: { spec: ReturnType<typeof generateMonster>['spec']; catalog: Catalog }; diagnostics: Diagnostic[] }>()
    const parseSpecFile = vi.fn((file: File) => file.name === 'current.json' ? slowCurrent.promise : fastLegacy.promise)
    render(<App
      initialExportCapabilities={{ png: true, webp: true }}
      parseSpecFile={parseSpecFile}
      storage={storage}
      previewRenderer={renderer}
      onSessionChange={session => { observedSession = structuredClone(session) }}
    />)

    const seedBefore = (await screen.findByLabelText('种子') as HTMLInputElement).value
    const themeBefore = (screen.getByLabelText('主题') as HTMLSelectElement).value
    await waitFor(() => expect(observedSession).toBeDefined())
    const sessionBefore = structuredClone(observedSession!)
    const input = screen.getByLabelText('选择要导入的 JSON 文件')
    await user.upload(input, new File(['current'], 'current.json'))
    await user.upload(input, new File(['legacy'], 'legacy.json'))
    fastLegacy.resolve({
      ok: true,
      value: { spec: generateMonster({ seed: 'legacy', themeId: 'fungal', mode: 'normal' }, legacyProductionCatalog).spec, catalog: legacyProductionCatalog },
      diagnostics: [],
    })
    expect(await screen.findByText('旧版标本 · 只读查看')).toBeTruthy()
    slowCurrent.resolve({
      ok: true,
      value: { spec: generateMonster({ seed: 'new-current', themeId: 'shadow', mode: 'normal' }, productionCatalog).spec, catalog: productionCatalog },
      diagnostics: [],
    })
    await Promise.resolve()
    await user.click(screen.getByRole('button', { name: '返回新版生成器' }))

    expect((await screen.findByLabelText('种子') as HTMLInputElement).value).toBe(seedBefore)
    expect((screen.getByLabelText('主题') as HTMLSelectElement).value).toBe(themeBefore)
    await waitFor(() => expect(observedSession?.spec.seed).toBe(sessionBefore.spec.seed))
    expect(observedSession?.spec.themeId).toBe(sessionBefore.spec.themeId)
    expect(observedSession?.spec.visualSlots).toEqual(sessionBefore.spec.visualSlots)
    expect(observedSession?.diagnostics).toEqual(sessionBefore.diagnostics)
    expect(observedSession?.blocked).toBe(sessionBefore.blocked)
  })
})
