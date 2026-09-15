import { describe, expect, it } from 'vitest'
import { COMBINATION_OPTIONS, generateFelineCombination } from '@qmonster/generator-core'
import {
  auditFelineCombinationCatalog,
  parseFelineCombinationCatalog,
  resolveFelineCombination,
  type FelineCombinationCatalog,
  type FelineCombinationResource,
} from './feline-combination-catalog.js'

function resource(id: string): FelineCombinationResource {
  return {
    id, path: `assets/${id}.png`, sha256: 'a'.repeat(64), width: 1254, height: 1254,
    mediaType: 'image/png', hasAlpha: true, review: 'pending',
    provenance: { reference: 'artifacts/reference.png', prompt: 'artifacts/prompt.md' },
  }
}

function fixture(): FelineCombinationCatalog {
  return {
    schemaVersion: 'feline-combination-catalog-v1', catalogVersion: '0.10.0-candidate.1',
    templateVersion: 'feline-sit-v1', canvas: { width: 1254, height: 1254 },
    resources: Object.fromEntries(['body', 'horns', 'antlers', 'ears', 'mane', 'wings', 'tail'].map(id => [id, resource(id)])),
    bodies: { 'orange-white': { 'parted-mouth': 'body' } },
    mutations: { 'orange-white': { 'dragon-horns': 'horns', antlers: 'antlers', 'fin-ears': 'ears', 'small-lion-mane': 'mane', 'small-wings': 'wings', 'forked-tail-tip': 'tail' } },
  }
}

const selection = { coat: 'orange-white', expression: 'parted-mouth', crown: 'dragon-horns', ears: 'fin-ears', neck: 'small-lion-mane', back: 'small-wings', tailTip: 'forked-tail-tip' } as const

describe('feline candidate catalog', () => {
  it('accepts partial inventory but reports all missing coverage references', () => {
    const partial = fixture()
    expect(parseFelineCombinationCatalog(partial).ok).toBe(true)
    const missing = auditFelineCombinationCatalog(partial)
    expect(missing).toHaveLength(47)
    expect(missing.some(item => item.path.join('.') === 'bodies.orange-white.small-fangs')).toBe(true)
    expect(missing.some(item => item.path.join('.') === 'mutations.tuxedo.fin-ears')).toBe(true)
    partial.bodies = {}
    partial.mutations = {}
    expect(auditFelineCombinationCatalog(partial)).toHaveLength(54)
  })

  it('accepts complete 18 body and 36 mutation references with shared resource IDs', () => {
    const catalog = fixture()
    for (const coat of COMBINATION_OPTIONS.coat) {
      catalog.bodies[coat] = { 'parted-mouth': 'body', 'small-fangs': 'body', 'tongue-tip': 'body' }
      catalog.mutations[coat] = { ...catalog.mutations['orange-white'] }
    }
    expect(auditFelineCombinationCatalog(catalog)).toEqual([])
  })

  it('resolves coexisting mutations in fixed order with only named template clears', () => {
    const spec = generateFelineCombination('catalog', selection)
    const plan = resolveFelineCombination(spec, fixture())
    expect(plan.operations.map(operation => operation.kind === 'draw' ? `${operation.slot}:${operation.resource.id}` : `clear:${operation.region}`))
      .toEqual(['back:wings', 'crown:horns', 'body:body', 'clear:ears', 'ears:ears', 'clear:tailTip', 'tailTip:tail', 'neck:mane'])
    expect(plan.operations.filter(operation => operation.kind === 'clear')).toEqual([{ kind: 'clear', region: 'ears' }, { kind: 'clear', region: 'tailTip' }])
    expect(plan.spec).toEqual(spec)
    expect(plan.canvas).toEqual({ width: 1254, height: 1254 })
  })

  it('resolves a plain body without demanding unselected mutation resources', () => {
    const catalog = fixture()
    catalog.mutations = {}
    const spec = generateFelineCombination('plain', { ...selection, crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none' })
    expect(resolveFelineCombination(spec, catalog).operations).toEqual([{ kind: 'draw', slot: 'body', resource: catalog.resources.body }])
  })

  it('fails selected missing bodies and mutations without using another coat or expression', () => {
    expect(() => resolveFelineCombination(generateFelineCombination('missing', { ...selection, coat: 'tuxedo' }), fixture())).toThrow(/bodies.tuxedo.parted-mouth/)
    expect(() => resolveFelineCombination(generateFelineCombination('missing', { ...selection, expression: 'small-fangs' }), fixture())).toThrow(/bodies.orange-white.small-fangs/)
    const catalog = fixture()
    delete catalog.mutations['orange-white']!['fin-ears']
    expect(() => resolveFelineCombination(generateFelineCombination('missing', selection), catalog)).toThrow(/mutations.orange-white.fin-ears/)
  })

  it('rejects an invalid spec before resolution', () => {
    const spec = generateFelineCombination('bad', selection)
    expect(() => resolveFelineCombination({ ...spec, catalogVersion: '0.9.0' } as never, fixture())).toThrow(/catalogVersion/)
  })

  it('deep freezes a detached plan, including spec and resource provenance', () => {
    const spec = generateFelineCombination('immutable', selection)
    const catalog = fixture()
    const plan = resolveFelineCombination(spec, catalog)
    const drawing = plan.operations.find(operation => operation.kind === 'draw')!
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.operations)).toBe(true)
    expect(Object.isFrozen(plan.spec.selections)).toBe(true)
    expect(Object.isFrozen(plan.spec.rolls)).toBe(true)
    expect(Object.isFrozen(plan.spec.locks)).toBe(true)
    expect(Object.isFrozen(drawing)).toBe(true)
    expect(Object.isFrozen(drawing.resource)).toBe(true)
    expect(Object.isFrozen(drawing.resource.provenance)).toBe(true)
    catalog.resources.wings!.provenance.prompt = 'changed.md'
    spec.selections.coat = 'tuxedo'
    expect(drawing.resource.provenance.prompt).toBe('artifacts/prompt.md')
    expect(plan.spec.selections.coat).toBe('orange-white')
    expect(resolveFelineCombination(generateFelineCombination('immutable', selection), fixture())).toEqual(plan)
  })

  it.each([
    ['schema version', (c: FelineCombinationCatalog) => ({ ...c, schemaVersion: 'wrong' })],
    ['catalog version', (c: FelineCombinationCatalog) => ({ ...c, catalogVersion: '0.9.0' })],
    ['template version', (c: FelineCombinationCatalog) => ({ ...c, templateVersion: 'wrong' })],
    ['canvas dimensions', (c: FelineCombinationCatalog) => ({ ...c, canvas: { width: 2048, height: 2048 } })],
    ['unknown key', (c: FelineCombinationCatalog) => ({ ...c, clears: [{ x: 0 }] })],
    ['unknown coat', (c: FelineCombinationCatalog) => ({ ...c, bodies: { orange: { 'parted-mouth': 'body' } } })],
    ['unknown expression', (c: FelineCombinationCatalog) => ({ ...c, bodies: { 'orange-white': { smile: 'body' } } })],
    ['unknown mutation', (c: FelineCombinationCatalog) => ({ ...c, mutations: { 'orange-white': { 'gill-feathers': 'ears' } } })],
    ['dangling reference', (c: FelineCombinationCatalog) => ({ ...c, bodies: { 'orange-white': { 'parted-mouth': 'absent' } } })],
  ])('rejects %s', (_, corrupt) => {
    const result = parseFelineCombinationCatalog(corrupt(fixture()))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected rejection')
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it.each([
    { id: 'wrong-id' }, { sha256: 'not-sha256' }, { width: 2048 }, { height: 1253 },
    { mediaType: 'image/jpeg' }, { hasAlpha: false }, { review: 'accepted' },
    { path: '../outside.png' }, { path: '/absolute.png' }, { path: 'C:/outside.png' },
    { path: 'https://example.com/a.png' }, { path: 'assets/../outside.png' },
    { path: 'assets\\outside.png' }, { path: 'assets/%2e%2e/outside.png' },
    { provenance: { reference: '../outside.png', prompt: 'prompt.md' } },
    { x: 10 },
  ])('rejects corrupt resource metadata %j', corrupt => {
    const catalog = fixture()
    catalog.resources.body = { ...catalog.resources.body!, ...corrupt } as never
    const result = parseFelineCombinationCatalog(catalog)
    expect(result.ok).toBe(false)
    expect(() => resolveFelineCombination(generateFelineCombination('bad', selection), catalog)).toThrow(/resource|body/i)
  })
})
