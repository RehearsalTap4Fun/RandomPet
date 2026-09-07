import { describe, expect, it } from 'vitest'
import { parseCatalog } from '@qmonster/generator-core'
import v06CatalogDocument from '../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import { loadLatestProductionCatalog, pickLatestCatalog } from './production-catalog.js'

const parsedCatalog = parseCatalog(v06CatalogDocument)
if (!parsedCatalog.ok) throw new Error('Expected the v0.6 production catalog to be valid.')

describe('production catalog selection', () => {
  it('loads the latest bundled catalog instead of binding the report page to one version', () => {
    expect(loadLatestProductionCatalog().version).toBe('0.6.0')

    const older = { ...parsedCatalog.value, version: '0.5.0' }
    const newer = { ...parsedCatalog.value, version: '0.7.0' }

    expect(pickLatestCatalog([older, newer, parsedCatalog.value])).toBe(newer)
  })
})
