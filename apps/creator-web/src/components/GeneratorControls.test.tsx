import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { createCreatorSession } from '../state/contracts.js'
import { GeneratorControls } from './GeneratorControls.js'

describe('GeneratorControls', () => {
  it('uses labeled native theme, seed and mode controls that dispatch core commands', async () => {
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const session = createCreatorSession(generateMonster({
      seed: 'first-seed',
      themeId: 'fungal',
      mode: 'normal',
    }, catalog))
    const onAction = vi.fn()
    render(<GeneratorControls session={session} catalog={catalog} onAction={onAction} />)

    const theme = screen.getByRole('combobox', { name: '主题' })
    const seed = screen.getByRole('textbox', { name: '种子' })
    const mutation = screen.getByRole('radio', { name: '变异' })
    expect(theme.tagName).toBe('SELECT')
    expect(seed.tagName).toBe('INPUT')
    expect(mutation.tagName).toBe('INPUT')

    await user.selectOptions(theme, 'shadow')
    await user.click(mutation)
    await user.clear(seed)
    await user.type(seed, 'next-seed')
    await user.click(screen.getByRole('button', { name: '孵化整只生物' }))

    expect(onAction).toHaveBeenNthCalledWith(1, { type: 'setTheme', themeId: 'shadow' })
    expect(onAction).toHaveBeenNthCalledWith(2, { type: 'setMode', mode: 'mutation' })
    expect(onAction).toHaveBeenNthCalledWith(3, { type: 'newCreature', seed: 'next-seed' })
  })
})
