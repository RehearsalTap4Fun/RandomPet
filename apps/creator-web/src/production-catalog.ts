import { parseCatalog, type Catalog } from '@qmonster/generator-core'
import {
  loadActiveProductionRelease,
  type ProductionReleaseDocuments,
  type ProductionV09Release,
} from './v09-production-release.js'

const productionCatalogDocuments = import.meta.glob<unknown>(
  '../../../packages/asset-catalog/catalog/v*/catalog.json',
  { eager: true, import: 'default' },
)

export function loadLatestProductionCatalog(): Catalog {
  return selectLatestValidCatalog(productionCatalogDocuments)
}

/** Preview-only opt-in; production default selection never falls back to this candidate. */
export function loadExplicitProductionRelease(pointer: unknown, documents: ProductionReleaseDocuments = {}): Promise<ProductionV09Release> {
  return loadActiveProductionRelease({ ...documents, pointer })
}

export function selectLatestValidCatalog(documents: Readonly<Record<string, unknown>>): Catalog {
  const validCatalogs = Object.values(documents).flatMap(document => {
    const parsed = parseCatalog(document)
    return parsed.ok ? [parsed.value] : []
  })
  return pickLatestCatalog(validCatalogs)
}

export function pickLatestCatalog(catalogs: readonly Catalog[]): Catalog {
  if (catalogs.length === 0) throw new Error('Catalog report has no bundled production catalog.')
  return catalogs.reduce((latest, candidate) => (
    compareCatalogVersions(candidate.version, latest.version) > 0 ? candidate : latest
  ))
}

function compareCatalogVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(part => Number.parseInt(part, 10))
  const rightParts = right.split('.').map(part => Number.parseInt(part, 10))
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
