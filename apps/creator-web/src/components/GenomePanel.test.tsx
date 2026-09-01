import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { GenomePanel } from './GenomePanel.js'

function controlledPanel(tab: HTMLElement): HTMLElement {
  const panelId = tab.getAttribute('aria-controls')
  if (panelId === null) throw new Error('Expected each tab to control a panel.')
  const panel = document.getElementById(panelId)
  if (panel === null) throw new Error(`Expected controlled panel ${panelId} to exist.`)
  return panel
}

describe('GenomePanel', () => {
  it('shows P first and switches to a hidden layer without edit controls', async () => {
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'gene-panel', themeId: 'fungal', mode: 'normal' }, catalog).spec
    render(<GenomePanel genome={spec.genome} />)

    const panel = screen.getByRole('region', { name: '基因记录' })
    const dominantTab = within(panel).getByRole('tab', { name: 'P · 显性' })
    expect(dominantTab.getAttribute('aria-selected')).toBe('true')
    expect(within(controlledPanel(dominantTab)).getAllByTestId('gene-row')).toHaveLength(14)
    expect(within(panel).queryByRole('textbox')).toBeNull()
    expect(within(panel).queryByRole('combobox')).toBeNull()

    await user.click(within(panel).getByRole('tab', { name: 'H2 · 隐藏' }))
    const hiddenTab = within(panel).getByRole('tab', { name: 'H2 · 隐藏' })
    expect(hiddenTab.getAttribute('aria-selected')).toBe('true')
    expect(within(controlledPanel(hiddenTab)).getByText(spec.genome!.genes.eyes.H2)).toBeTruthy()
  })

  it('keeps each layer tab associated to a stable panel and hides inactive layers', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'gene-associations', themeId: 'fungal', mode: 'normal' }, catalog).spec
    render(<GenomePanel genome={spec.genome} />)

    const panel = screen.getByRole('region', { name: '基因记录' })
    const tabs = [
      { name: 'P · 显性', active: true },
      { name: 'H1 · 隐藏', active: false },
      { name: 'H2 · 隐藏', active: false },
      { name: 'H3 · 隐藏', active: false },
    ]

    for (const { name, active } of tabs) {
      const tab = within(panel).getByRole('tab', { name })
      const layerPanel = controlledPanel(tab)
      expect(layerPanel.getAttribute('aria-labelledby')).toBe(tab.id)
      expect(tab.getAttribute('aria-selected')).toBe(String(active))
      expect(layerPanel.hidden).toBe(!active)
    }
  })

  it('uses roving tab focus and keyboard selection in genome layer order', async () => {
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'gene-keyboard', themeId: 'fungal', mode: 'normal' }, catalog).spec
    render(<GenomePanel genome={spec.genome} />)

    const panel = screen.getByRole('region', { name: '基因记录' })
    const dominantTab = within(panel).getByRole('tab', { name: 'P · 显性' })
    const h1Tab = within(panel).getByRole('tab', { name: 'H1 · 隐藏' })
    const h2Tab = within(panel).getByRole('tab', { name: 'H2 · 隐藏' })
    const h3Tab = within(panel).getByRole('tab', { name: 'H3 · 隐藏' })

    expect([dominantTab, h1Tab, h2Tab, h3Tab].map(tab => tab.tabIndex)).toEqual([0, -1, -1, -1])

    dominantTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(h1Tab)
    expect(h1Tab.getAttribute('aria-selected')).toBe('true')
    expect(h1Tab.tabIndex).toBe(0)
    expect(dominantTab.tabIndex).toBe(-1)

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(h3Tab)
    expect(h3Tab.getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(dominantTab)
    expect(dominantTab.getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(dominantTab)

    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(h3Tab)
    expect(h3Tab.getAttribute('aria-selected')).toBe('true')

    expect(h2Tab.getAttribute('aria-selected')).toBe('false')
  })

  it('shows a compact legacy state when no genome exists', () => {
    render(<GenomePanel genome={undefined} />)
    expect(screen.getByRole('region', { name: '基因记录' }).textContent).toContain('旧版形象没有基因记录')
  })
})
