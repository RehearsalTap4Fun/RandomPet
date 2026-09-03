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

  it('reports the separate strong non-facial feature budget', () => {
    const catalog = makeCompositionCatalogFixture()
    catalog.version = '0.4.0'
    catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
    const spec = makeValidCompositionSpecFixture(catalog)
    const source = catalog.parts.find(part => (
      part.slotId === 'effect' && !part.composition!.isNone
    ))!
    catalog.parts.push({
      ...structuredClone(source),
      id: `${source.id}_strong_nonfacial`,
      composition: { ...structuredClone(source.composition!), visualIntensity: 'strong' },
    })
    spec.visualSlots.effect = {
      ...spec.visualSlots.effect,
      partId: `${source.id}_strong_nonfacial`,
    }

    render(<CompositionStatus spec={spec} catalog={catalog} diagnostics={[]} />)

    expect(screen.getByRole('list', { name: '组合约束' }).textContent).toContain('强非脸部 1/1')
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

  it.each(['0.3.0', '0.4.0', '0.5.0'] as const)('marks %s interface structure unready when a connector error is present', version => {
    const catalog = makeCompositionCatalogFixture()
    catalog.version = version
    if (version === '0.4.0' || version === '0.5.0') catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
    const spec = makeValidCompositionSpecFixture(makeCompositionCatalogFixture())
    spec.catalogVersion = version
    spec.rendererVersion = version

    render(<CompositionStatus spec={spec} catalog={catalog} diagnostics={[{
      severity: 'error',
      code: 'CONNECTOR_COMPOSITE_FAILED',
      path: ['connectors', 'neck'],
      message: 'neck failed',
    }]} />)

    expect(screen.getByRole('list', { name: '组合约束' }).textContent).toContain('结构需调整')
  })

  it('does not render for legacy catalogs without composition policy', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidCompositionSpecFixture(makeCompositionCatalogFixture())
    spec.catalogVersion = catalog.version

    const { container } = render(<CompositionStatus spec={spec} catalog={catalog} diagnostics={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
