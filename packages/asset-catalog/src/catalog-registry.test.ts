import { describe, expect, it } from 'vitest'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { CatalogRegistry } from './catalog-registry.js'

describe('CatalogRegistry', () => {
  it('loads the exact installed version without substituting a current catalog', async () => {
    const installed = makeValidCatalogFixture()
    installed.version = '0.1.0'
    let fallbackLoads = 0
    const registry = new CatalogRegistry(new Map([
      ['0.1.0', async () => installed],
      ['current', async () => {
        fallbackLoads += 1
        return makeValidCatalogFixture()
      }],
    ]))

    await expect(registry.load('0.1.0')).resolves.toMatchObject({ ok: true, value: { version: '0.1.0' } })
    await expect(registry.load('0.0.9')).resolves.toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'CATALOG_VERSION_MISSING' })],
    })
    expect(fallbackLoads).toBe(0)
    expect(registry.has('0.0.9')).toBe(false)
  })
})
