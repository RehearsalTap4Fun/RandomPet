import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  makeCompositionCatalogFixture,
  makeValidCompositionSpecFixture,
  makeValidCatalogFixture,
} from '@qmonster/generator-core/test-fixtures'
import type { Diagnostic } from '@qmonster/generator-core'
import { CompositionStatus } from './CompositionStatus.js'

function renderStatus(strongCount: 0 | 2 | 3, diagnostics: Diagnostic[] = []) {
  const catalog = makeCompositionCatalogFixture()
  const spec = makeValidCompositionSpecFixture(catalog)
  const strongSlots = ['eyes', 'mouthShape', 'headAppendage'] as const
  for (const slotId of strongSlots) {
    const source = catalog.parts.find(part => part.slotId === slotId && !part.composition!.isNone)!
    catalog.parts.push({
      ...structuredClone(source),
      id: `${source.id}_strong`,
      composition: { ...structuredClone(source.composition!), visualIntensity: 'strong' },
    })
  }
  for (const slotId of strongSlots.slice(0, strongCount)) {
    spec.visualSlots[slotId] = {
      ...spec.visualSlots[slotId],
      partId: `${spec.visualSlots[slotId].partId}_strong`,
    }
  }
  return render(<CompositionStatus spec={spec} catalog={catalog} diagnostics={diagnostics} />)
}

describe('CompositionStatus', () => {
  it.each([0, 2, 3] as const)('reports %i strong features', strongCount => {
    renderStatus(strongCount)
    expect(screen.getByRole('list', { name: '组合约束' }).textContent).toContain(`强特征 ${strongCount}/2`)
  })

  it('marks face unready when a render face error is present', () => {
    renderStatus(0, [{
      severity: 'error',
      code: 'COMPOSITION_FACE_OCCLUDED',
      path: ['visualSlots', 'eyes'],
      message: 'eyes are occluded',
    }])

    expect(screen.getByRole('list', { name: '组合约束' }).textContent).toContain('面部需调整')
  })

  it('does not render for legacy catalogs without composition policy', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidCompositionSpecFixture(makeCompositionCatalogFixture())
    spec.catalogVersion = catalog.version

    const { container } = render(<CompositionStatus spec={spec} catalog={catalog} diagnostics={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
