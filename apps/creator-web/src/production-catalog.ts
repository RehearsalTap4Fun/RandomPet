import { parseCatalog, type Catalog } from '@qmonster/generator-core'

const productionCatalogDocuments = import.meta.glob<unknown>(
  '../../../packages/asset-catalog/catalog/v*/catalog.json',
  { eager: true, import: 'default' },
)

export function loadLatestProductionCatalog(): Catalog {
  return selectLatestValidCatalog(productionCatalogDocuments)
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
