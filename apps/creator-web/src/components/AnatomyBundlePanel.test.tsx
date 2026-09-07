import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  generateMonster,
  parseCatalog,
  STRUCTURAL_SLOT_IDS,
} from '@qmonster/generator-core'
import v06CatalogDocument from '../../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import { createCreatorSession } from '../state/contracts.js'
import { AnatomyBundlePanel } from './AnatomyBundlePanel.js'

const parsedCatalog = parseCatalog(v06CatalogDocument)
if (!parsedCatalog.ok) throw new Error('Expected valid v0.6 fixture catalog.')
const catalog = parsedCatalog.value

describe('AnatomyBundlePanel', () => {
  it('shows the selected bundle identity and dispatches a whole-appearance reroll', async () => {
    const user = userEvent.setup()
    const session = createCreatorSession(generateMonster({
      seed: 'bundle-panel', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog))
    const selected = catalog.anatomyBundles!.find(bundle => bundle.id === session.spec.anatomyBundleId)!
    const body = catalog.parts.find(part => part.id === selected.derivedSlots.bodyFrame)!
    const onAction = vi.fn()

    render(<AnatomyBundlePanel session={session} catalog={catalog} onAction={onAction} />)

    expect(screen.getByRole('heading', { name: '外形基因' })).toBeTruthy()
    expect(screen.getByText(body.displayName!)).toBeTruthy()
    expect(screen.getByText(selected.poseId)).toBeTruthy()
    expect(screen.getByText(`普通 · ${body.rarity}`)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '重掷外形' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'rerollAppearance' })
  })

  it('shows the localized collection rarity of a legendary whole appearance', () => {
    const legendary = catalog.anatomyBundles!.find(bundle => bundle.rarity === 'L')!
    const session = createCreatorSession(generateMonster({
      seed: 'bundle-panel-legendary', themeId: 'shadow', mode: 'normal', archetypeId: 'feline',
      lockedSelections: Object.fromEntries(STRUCTURAL_SLOT_IDS.map(slotId => [slotId, legendary.derivedSlots[slotId]])),
    }, catalog))

    render(<AnatomyBundlePanel session={session} catalog={catalog} onAction={vi.fn()} />)

    expect(screen.getByText('传说 · L')).toBeTruthy()
  })
})
