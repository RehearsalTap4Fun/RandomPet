import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMonster, type Diagnostic } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { createCreatorSession } from './state/contracts.js'
import { CreatorWorkbench } from './App.js'
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

afterEach(() => vi.restoreAllMocks())

describe('CreatorWorkbench', () => {
  it('presents the complete shell, reserved export affordances and live status summary', async () => {
    installCanvasContexts()
    const catalog = makeValidCatalogFixture()
    const generated = generateMonster({ seed: 'workbench', themeId: 'fungal', mode: 'normal' }, catalog)
    const session = createCreatorSession(generated)
    session.locks.eyes = true
    session.locks.tail = true
    session.diagnostics = [{
      severity: 'error',
      code: 'LOCK_INCOMPATIBLE',
      path: ['visualSlots', 'eyes'],
      message: 'Eyes conflict.',
    }]
    session.blocked = true
    const renderWarning: Diagnostic = {
      severity: 'warning', code: 'PREVIEW_NOTE', path: [], message: 'Preview note.',
    }
    const renderer: PreviewRenderer = vi.fn(async () => ({
      drawnAssetIds: [], diagnostics: [renderWarning],
    }))

    render(
      <CreatorWorkbench
        session={session}
        catalog={catalog}
        onAction={() => undefined}
        previewRenderer={renderer}
      />,
    )

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    for (const name of ['导入 JSON', '导出 JSON', '导出透明 PNG', '导出透明 WebP']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getByText('槽位 14/14')).toBeTruthy()
    expect(screen.getByText('锁定 2')).toBeTruthy()
    expect(screen.getByText('错误 1')).toBeTruthy()
    expect(screen.getByText('主题 fungal')).toBeTruthy()
    expect(screen.getByText('目录 v0.1.0')).toBeTruthy()
    const diagnostics = screen.getByRole('region', { name: '诊断信息' })
    await waitFor(() => expect(within(diagnostics).getAllByRole('heading', { level: 3 })
      .map(item => item.textContent)).toEqual(['错误 · 1', '提醒 · 1']))
  })

  it('uses one native radio-group tab stop and arrow keys for the temporary observation background', async () => {
    installCanvasContexts()
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const session = createCreatorSession(generateMonster({
      seed: 'background', themeId: 'fungal', mode: 'normal',
    }, catalog))
    const renderer: PreviewRenderer = vi.fn(async () => ({ drawnAssetIds: [], diagnostics: [] }))
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
    await user.keyboard('{ArrowRight}')
    expect(grid.checked).toBe(true)
    expect(stage.dataset.observationBackground).toBe('grid')
    expect(onAction).not.toHaveBeenCalled()
  })
})
