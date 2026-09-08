import { describe, expect, it } from 'vitest'
import * as generatorCore from './index.js'
import {
  makeV08MonsterSpecFixture,
  makeV08SpeciesRigCatalogFixture,
} from './test-fixtures.js'

describe('resolveSpeciesRig', () => {
  it('resolves only an exact spec, bundle, and rig agreement', () => {
    const resolveSpeciesRig = (generatorCore as Record<string, unknown>).resolveSpeciesRig
    expect(resolveSpeciesRig).toBeTypeOf('function')
    if (typeof resolveSpeciesRig !== 'function') return

    const catalog = makeV08SpeciesRigCatalogFixture()
    const spec = makeV08MonsterSpecFixture()
    expect(resolveSpeciesRig(spec, catalog)).toMatchObject({ id: 'feline-sit-v1' })
    expect(resolveSpeciesRig({ ...spec, speciesRigId: 'other-rig' }, catalog)).toBeNull()
    expect(resolveSpeciesRig({ ...spec, anatomyBundleId: 'other-bundle' }, catalog)).toBeNull()
  })
})
