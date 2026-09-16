import { describe, expect, it } from 'vitest'
import { generateFelineCombination } from './feline-combination.js'
import * as api from './feline-phenotype-v2.js'
import * as sdk from '../../incubator-adapter/src/pixel-art-sdk.js'

const v1 = {
  schemaVersion: 'feline-phenotype-v1' as const,
  body: 'standard', coat: 'orange-white', expression: 'small-fangs',
  crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
}
const sleepy = { ...v1, schemaVersion: 'feline-phenotype-v2' as const, eyes: 'sleepy-almond' }

describe('eye-aware phenotype v2', () => {
  it('migrates a validated v1 phenotype with round eyes', () => {
    expect(api.phenotypeV2FromV1(v1)).toEqual({
      schemaVersion: 'feline-phenotype-v2', body: 'standard', coat: 'orange-white', eyes: 'round',
      expression: 'small-fangs', crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
    })
    expect(sdk.phenotypeV2FromV1(v1)).toEqual(api.phenotypeV2FromV1(v1))
    expect(() => api.phenotypeV2FromV1({ ...v1, png: 'cat.png' })).toThrow()
  })

  it('adapts legacy saves deterministically without mutating them', () => {
    const legacy = generateFelineCombination('saved-cat', { coat: 'orange-white', expression: 'small-fangs' })
    const before = JSON.stringify(legacy)
    expect(api.phenotypeV2FromLegacy(legacy)).toEqual({
      schemaVersion: 'feline-phenotype-v2', body: 'standard', ...legacy.selections, eyes: 'round',
    })
    expect(JSON.stringify(legacy)).toBe(before)
  })

  it('uses all nine ordered traits in a strict v2 identity', () => {
    expect(api.phenotypeKeyV2(sleepy)).toBe('["standard","orange-white","sleepy-almond","small-fangs","none","none","none","none","none"]')
    expect(api.parseFelinePhenotypeV2(sleepy)).toEqual({ ok: true, value: sleepy })
    expect(api.parseFelinePhenotypeV2({ ...sleepy, png: 'cat.png' }).ok).toBe(false)
    expect(api.parseFelinePhenotypeV2({ ...sleepy, eyes: '../round' }).ok).toBe(false)
  })
})
