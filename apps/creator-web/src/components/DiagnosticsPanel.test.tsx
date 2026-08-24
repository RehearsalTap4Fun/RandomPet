import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@qmonster/generator-core'
import { DiagnosticsPanel } from './DiagnosticsPanel.js'

describe('DiagnosticsPanel', () => {
  it('orders errors before warnings and focuses a linked slot control', async () => {
    const user = userEvent.setup()
    const diagnostics: Diagnostic[] = [
      {
        severity: 'warning',
        code: 'SESSION_SAVE_FAILED',
        path: [],
        message: 'Autosave is unavailable.',
      },
      {
        severity: 'error',
        code: 'LOCK_INCOMPATIBLE',
        path: ['visualSlots', 'eyes'],
        message: 'The locked eyes are incompatible.',
      },
    ]

    render(
      <>
        <label htmlFor="slot-control-eyes">眼睛部件</label>
        <select id="slot-control-eyes"><option>eyes</option></select>
        <DiagnosticsPanel diagnostics={diagnostics} />
      </>,
    )

    expect(screen.getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual([
      '错误 · 1',
      '提醒 · 1',
    ])
    const link = screen.getByRole('link', { name: '定位到眼睛' })
    expect(link.getAttribute('href')).toBe('#slot-control-eyes')
    await user.click(link)
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: '眼睛部件' }))
  })

  it('announces that the current combination has no diagnostics', () => {
    render(<DiagnosticsPanel diagnostics={[]} />)
    expect(screen.getByRole('status').textContent).toMatch(/组合状态良好/)
  })

  it('links composition face and bounds diagnostics to their responsible controls with Chinese guidance', () => {
    const diagnostics: Diagnostic[] = [
      {
        severity: 'error',
        code: 'COMPOSITION_FACE_OCCLUDED',
        path: ['renderNodes', 'effect_glow_0'],
        message: 'obsolete renderer message',
      },
      {
        severity: 'error',
        code: 'COMPOSITION_BOUNDS_EXCEEDED',
        path: ['visibleBounds'],
        message: 'obsolete renderer message',
      },
    ]

    render(<DiagnosticsPanel diagnostics={diagnostics} />)

    expect(screen.getByText('COMPOSITION_FACE_OCCLUDED')).toBeTruthy()
    expect(screen.getByRole('link', { name: '定位到氛围效果' }).getAttribute('href')).toBe('#slot-control-effect')
    expect(screen.getByRole('link', { name: '定位到体型骨架' }).getAttribute('href')).toBe('#slot-control-bodyFrame')
    expect(screen.getAllByText(/面部/).length).toBeGreaterThan(0)
    expect(screen.getByText(/画面边界/)).toBeTruthy()
  })
})
