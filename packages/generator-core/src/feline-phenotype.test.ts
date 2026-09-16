import { describe, expect, it } from 'vitest'
import { generateFelineCombination } from './feline-combination.js'
import * as api from './feline-phenotype.js'

describe('trait-only phenotype', () => {
  it('adapts saved selections without rerolling or sharing mutable state', () => {
    const legacy = generateFelineCombination('saved-cat', { coat: 'calico', crown: 'halo' })
    const before = JSON.stringify(legacy)
    const phenotype = api.phenotypeFromLegacy(legacy)
    expect(phenotype).toEqual({ schemaVersion: 'feline-phenotype-v1', body: 'standard', ...legacy.selections })
    phenotype.crown = 'none'
    expect(JSON.stringify(legacy)).toBe(before)
  })
  it('rejects artwork metadata and invalid legacy saves at the semantic boundary', () => {
    const phenotype = api.phenotypeFromLegacy(generateFelineCombination('cat'))
    expect(api.parseFelinePhenotype({ ...phenotype, png: 'cat.png' }).ok).toBe(false)
    expect(api.parseFelinePhenotype({ ...phenotype, body: '../cat' }).ok).toBe(false)
    expect(() => api.phenotypeFromLegacy({})).toThrow()
  })
})
