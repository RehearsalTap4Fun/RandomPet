import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  generateMonster,
  type Catalog,
} from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { createCreatorSession } from '../state/contracts.js'
import { SlotPanel } from './SlotPanel.js'

function fixture(catalog: Catalog = makeValidCatalogFixture()) {
  return createCreatorSession(generateMonster({
    seed: 'slot-panel-seed',
    themeId: 'fungal',
    mode: 'normal',
  }, catalog))
}

describe('SlotPanel', () => {
  it('exposes fourteen visual slot rows in four responsibility groups', () => {
    const catalog = makeValidCatalogFixture()
    render(<SlotPanel session={fixture(catalog)} catalog={catalog} onAction={() => undefined} />)

    expect(screen.getAllByTestId('visual-slot-row')).toHaveLength(14)
    expect(screen.getAllByRole('group').map(group => group.getAttribute('aria-labelledby'))).toEqual([
      'slot-group-shape',
      'slot-group-face',
      'slot-group-appendage',
      'slot-group-surface',
    ])
  })

  it('dispatches one local reroll without changing the lock checkbox', async () => {
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const onAction = vi.fn()
    render(<SlotPanel session={fixture(catalog)} catalog={catalog} onAction={onAction} />)

    const lock = screen.getByRole('checkbox', { name: '锁定 眼睛' }) as HTMLInputElement
    expect(lock.checked).toBe(false)
    await user.click(screen.getByRole('button', { name: '重抽眼睛' }))

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith({ type: 'rerollSlot', slotId: 'eyes' })
    expect(lock.checked).toBe(false)
  })

  it('uses native labeled controls and visibly explains disabled incompatible parts', () => {
    const base = makeValidCatalogFixture()
    const eyes = base.parts.find(part => part.slotId === 'eyes')!
    const catalog: Catalog = {
      ...base,
      parts: [
        ...base.parts,
        {
          ...eyes,
          id: 'eyes_biped_only',
          displayName: '双足专用眼',
          compatibleRigs: ['biped'],
        },
      ],
    }
    render(<SlotPanel session={fixture(catalog)} catalog={catalog} onAction={() => undefined} />)

    const select = screen.getByRole('combobox', { name: '眼睛部件' }) as HTMLSelectElement
    const incompatible = Array.from(select.options).find(option => option.value === 'eyes_biped_only')
    expect(select.tagName).toBe('SELECT')
    expect(incompatible?.disabled).toBe(true)
    expect(screen.getByText(/双足专用眼与当前骨架或部件组合不兼容/)).toBeTruthy()
  })
})
