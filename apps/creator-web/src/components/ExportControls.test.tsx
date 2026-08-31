import { createRef, StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { createCreatorSession } from '../state/contracts.js'
import { ExportControls, type ExportControlsProps } from './ExportControls.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function makeExportControlsProps(): ExportControlsProps {
  const catalog = makeValidCatalogFixture()
  const session = createCreatorSession(
    generateMonster({ seed: 'export-controls', themeId: 'fungal', mode: 'normal' }, catalog),
    { png: true, webp: true },
  )

  return {
    session,
    registry: new CatalogRegistry(new Map([
      [catalog.version, async () => catalog],
    ])),
    canvasRef: createRef<HTMLCanvasElement>(),
    imageExportReady: true,
    onImportComplete: vi.fn(),
    onOperationDiagnostics: vi.fn(),
  }
}

describe('ExportControls', () => {
  it('disables every formal export for current-work errors', () => {
    const props = makeExportControlsProps()
    const { session } = props
    render(<ExportControls {...props} session={{ ...session, blocked: true }} />)
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导出透明 WebP' })).toBeDisabled()
  })

  it('keeps JSON and PNG enabled when only WebP is unsupported', () => {
    const props = makeExportControlsProps()
    const { session } = props
    render(<ExportControls {...props} session={{
      ...session, blocked: false, exportCapabilities: { png: true, webp: false },
    }} />)
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeEnabled()
    const webpButton = screen.getByRole('button', { name: '导出透明 WebP' })
    expect(webpButton).toBeDisabled()
    const warning = screen.getByRole('status')
    expect(warning.textContent).toBe('当前浏览器不支持 WebP 编码，请改用 PNG。')
    expect(webpButton.getAttribute('aria-describedby')).toBe(warning.id)
  })

  it('rechecks preview readiness inside the image export handler', () => {
    const props = makeExportControlsProps()
    render(<ExportControls {...props} imageExportReady={false} />)
    const png = screen.getByRole('button', { name: '导出透明 PNG' })
    expect(png).toBeDisabled()

    // Invoke the currently bound React handler directly to bypass the native
    // disabled control. The handler itself must still reject the export.
    const reactPropsKey = Object.keys(png).find(key => key.startsWith('__reactProps$'))
    expect(reactPropsKey).toBeDefined()
    const onClick = (png as HTMLButtonElement & Record<string, { onClick?: () => void }>)[reactPropsKey!]?.onClick
    expect(onClick).toBeTypeOf('function')
    onClick?.()

    expect(props.onOperationDiagnostics).toHaveBeenLastCalledWith([
      expect.objectContaining({ severity: 'error', code: 'PREVIEW_EXPORT_NOT_READY' }),
    ])
  })

  it('routes a valid imported spec only after registry-backed validation succeeds', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    render(<StrictMode><ExportControls {...props} /></StrictMode>)

    await user.upload(
      screen.getByLabelText('选择要导入的 JSON 文件'),
      new File([JSON.stringify(props.session.spec)], 'creature.json', { type: 'application/json' }),
    )

    expect(props.onImportComplete).toHaveBeenCalledTimes(1)
    expect(props.onImportComplete).toHaveBeenCalledWith({
      spec: props.session.spec,
      catalog: expect.objectContaining({ version: props.session.spec.catalogVersion }),
    })
    expect(props.onOperationDiagnostics).toHaveBeenLastCalledWith([
      expect.objectContaining({ code: 'CATALOG_VERSION_OLD' }),
    ])
  })

  it('reports unsupported WebP as a warning without disabling other exports', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    props.canvasRef.current = document.createElement('canvas')
    vi.spyOn(props.canvasRef.current, 'toBlob').mockImplementation(callback => callback(null))
    render(<ExportControls {...props} />)

    await user.click(screen.getByRole('button', { name: '导出透明 WebP' }))

    expect(props.onOperationDiagnostics).toHaveBeenLastCalledWith([
      expect.objectContaining({ severity: 'warning', code: 'WEBP_EXPORT_UNSUPPORTED' }),
    ])
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeEnabled()
  })

  it('only completes the latest concurrent import request', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    const slow = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    const fast = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    props.parseSpecFile = vi.fn((file: File) => file.name === 'slow.json' ? slow.promise : fast.promise)
    render(<ExportControls {...props} />)

    const input = screen.getByLabelText('选择要导入的 JSON 文件')
    await user.upload(input, new File(['slow'], 'slow.json'))
    await user.upload(input, new File(['fast'], 'fast.json'))
    fast.resolve({ ok: false, diagnostics: [{ severity: 'error', code: 'FAST_FAILURE', path: [], message: 'fast' }] })
    await vi.waitFor(() => expect(props.onOperationDiagnostics).toHaveBeenLastCalledWith([
      expect.objectContaining({ code: 'FAST_FAILURE' }),
    ]))

    const callCountAfterLatest = vi.mocked(props.onOperationDiagnostics).mock.calls.length
    slow.resolve({ ok: true, value: { spec: props.session.spec, catalog: makeValidCatalogFixture() }, diagnostics: [] })
    await Promise.resolve()

    expect(props.onImportComplete).not.toHaveBeenCalled()
    expect(props.onOperationDiagnostics).toHaveBeenCalledTimes(callCountAfterLatest)
  })

  it('does not complete an import after unmount', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    const pending = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    props.parseSpecFile = vi.fn(() => pending.promise)
    const { unmount } = render(<ExportControls {...props} />)

    await user.upload(screen.getByLabelText('选择要导入的 JSON 文件'), new File(['pending'], 'pending.json'))
    vi.mocked(props.onOperationDiagnostics).mockClear()
    unmount()
    pending.resolve({ ok: true, value: { spec: props.session.spec, catalog: makeValidCatalogFixture() }, diagnostics: [] })
    await Promise.resolve()

    expect(props.onImportComplete).not.toHaveBeenCalled()
    expect(props.onOperationDiagnostics).not.toHaveBeenCalled()
  })

  it('does not let an older failed import replace the latest successful import', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    const slow = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    const fast = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    const importedCatalog = makeValidCatalogFixture()
    props.parseSpecFile = vi.fn((file: File) => file.name === 'slow.json' ? slow.promise : fast.promise)
    render(<ExportControls {...props} />)

    const input = screen.getByLabelText('选择要导入的 JSON 文件')
    await user.upload(input, new File(['slow'], 'slow.json'))
    await user.upload(input, new File(['fast'], 'fast.json'))
    fast.resolve({ ok: true, value: { spec: props.session.spec, catalog: importedCatalog }, diagnostics: [] })
    await vi.waitFor(() => expect(props.onImportComplete).toHaveBeenCalledWith({
      spec: props.session.spec,
      catalog: importedCatalog,
    }))
    const diagnosticsAfterLatest = vi.mocked(props.onOperationDiagnostics).mock.calls.length

    slow.resolve({ ok: false, diagnostics: [{ severity: 'error', code: 'SLOW_FAILURE', path: [], message: 'slow' }] })
    await Promise.resolve()

    expect(props.onImportComplete).toHaveBeenCalledTimes(1)
    expect(props.onOperationDiagnostics).toHaveBeenCalledTimes(diagnosticsAfterLatest)
  })

  it('reports a stable diagnostic for the current rejected import and clears the input for reselecting the same file', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    const first = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    const second = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    props.parseSpecFile = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    render(<ExportControls {...props} />)

    const input = screen.getByLabelText('选择要导入的 JSON 文件') as HTMLInputElement
    const sameFile = new File(['broken'], 'same-file.json')
    await user.upload(input, sameFile)
    first.reject(new Error('parser unavailable'))

    await vi.waitFor(() => expect(props.onOperationDiagnostics).toHaveBeenLastCalledWith([
      expect.objectContaining({
        severity: 'error',
        code: 'SPEC_FILE_IMPORT_FAILED',
        message: '导入文件失败，请重试。',
      }),
    ]))
    expect(input.value).toBe('')
    expect(props.onImportComplete).not.toHaveBeenCalled()

    await user.upload(input, sameFile)
    expect(props.parseSpecFile).toHaveBeenCalledTimes(2)
  })

  it('silently ignores a stale rejected import after a newer request completes', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    const slow = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    const fast = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    const importedCatalog = makeValidCatalogFixture()
    props.parseSpecFile = vi.fn((file: File) => file.name === 'slow.json' ? slow.promise : fast.promise)
    render(<ExportControls {...props} />)

    const input = screen.getByLabelText('选择要导入的 JSON 文件')
    await user.upload(input, new File(['slow'], 'slow.json'))
    await user.upload(input, new File(['fast'], 'fast.json'))
    slow.reject(new Error('stale parser failure'))
    await Promise.resolve()

    expect((input as HTMLInputElement).value).not.toBe('')
    expect(props.onImportComplete).not.toHaveBeenCalled()
    expect(props.onOperationDiagnostics).toHaveBeenLastCalledWith([])

    fast.resolve({ ok: true, value: { spec: props.session.spec, catalog: importedCatalog }, diagnostics: [] })
    await vi.waitFor(() => expect(props.onImportComplete).toHaveBeenCalledWith({
      spec: props.session.spec,
      catalog: importedCatalog,
    }))
  })

  it('silently ignores a rejected import after unmount', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    const pending = deferred<Awaited<ReturnType<NonNullable<ExportControlsProps['parseSpecFile']>>>>()
    props.parseSpecFile = vi.fn(() => pending.promise)
    const { unmount } = render(<ExportControls {...props} />)

    await user.upload(screen.getByLabelText('选择要导入的 JSON 文件'), new File(['pending'], 'pending.json'))
    vi.mocked(props.onOperationDiagnostics).mockClear()
    unmount()
    pending.reject(new Error('unmounted parser failure'))
    await Promise.resolve()

    expect(props.onImportComplete).not.toHaveBeenCalled()
    expect(props.onOperationDiagnostics).not.toHaveBeenCalled()
  })
})
