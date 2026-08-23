import { describe, expect, it } from 'vitest'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { CatalogRegistry } from './catalog-registry.js'

describe('CatalogRegistry', () => {
  it('loads the exact installed version without substituting a current catalog', async () => {
    const current = makeValidCatalogFixture()
    const installedOld = makeValidCatalogFixture()
    installedOld.version = '0.0.9'
    let fallbackLoads = 0
    const registry = new CatalogRegistry(new Map([
      ['0.1.0', async () => current],
      ['0.0.9', async () => installedOld],
      ['current', async () => {
        fallbackLoads += 1
        return makeValidCatalogFixture()
      }],
    ]))

    await expect(registry.load('0.1.0')).resolves.toMatchObject({ ok: true, value: { version: '0.1.0' } })
    await expect(registry.load('0.0.9')).resolves.toMatchObject({ ok: true, value: { version: '0.0.9' } })
    await expect(registry.load('0.0.8')).resolves.toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'CATALOG_VERSION_MISSING' })],
    })
    expect(fallbackLoads).toBe(0)
    expect(registry.has('0.0.9')).toBe(true)
    expect(registry.has('0.0.8')).toBe(false)
  })

  it('returns a diagnostic when an exact installed loader rejects', async () => {
    const registry = new CatalogRegistry(new Map([
      ['0.1.0', async () => Promise.reject(new Error('catalog unavailable'))],
    ]))

    await expect(registry.load('0.1.0')).resolves.toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({
        severity: 'error',
        code: 'CATALOG_LOAD_FAILED',
        path: ['catalogVersion'],
      })],
    })
  })
})
