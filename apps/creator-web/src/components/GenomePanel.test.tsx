import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { GenomePanel } from './GenomePanel.js'

describe('GenomePanel', () => {
  it('shows P first and switches to a hidden layer without edit controls', async () => {
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'gene-panel', themeId: 'fungal', mode: 'normal' }, catalog).spec
    render(<GenomePanel genome={spec.genome} />)

    const panel = screen.getByRole('region', { name: '基因记录' })
    expect(within(panel).getByRole('tab', { name: 'P · 显性' }).getAttribute('aria-selected')).toBe('true')
    expect(within(panel).getAllByTestId('gene-row')).toHaveLength(14)
    expect(within(panel).queryByRole('textbox')).toBeNull()
    expect(within(panel).queryByRole('combobox')).toBeNull()

    await user.click(within(panel).getByRole('tab', { name: 'H2 · 隐藏' }))
    expect(within(panel).getByRole('tab', { name: 'H2 · 隐藏' }).getAttribute('aria-selected')).toBe('true')
    expect(within(panel).getByText(spec.genome!.genes.eyes.H2)).toBeTruthy()
  })

  it('shows a compact legacy state when no genome exists', () => {
    render(<GenomePanel genome={undefined} />)
    expect(screen.getByRole('region', { name: '基因记录' }).textContent).toContain('旧版形象没有基因记录')
  })
})
