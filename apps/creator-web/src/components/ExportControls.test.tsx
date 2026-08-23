import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { createCreatorSession } from '../state/contracts.js'
import { ExportControls, type ExportControlsProps } from './ExportControls.js'

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

  it('routes a valid imported spec only after registry-backed validation succeeds', async () => {
    const user = userEvent.setup()
    const props = makeExportControlsProps()
    render(<ExportControls {...props} />)

    await user.upload(
      screen.getByLabelText('选择要导入的 JSON 文件'),
      new File([JSON.stringify(props.session.spec)], 'creature.json', { type: 'application/json' }),
    )

    expect(props.onImportComplete).toHaveBeenCalledTimes(1)
    expect(props.onImportComplete).toHaveBeenCalledWith(props.session.spec)
    expect(props.onOperationDiagnostics).toHaveBeenLastCalledWith([])
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
})
