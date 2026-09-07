import { parseCatalog, type Catalog } from '@qmonster/generator-core'

const productionCatalogDocuments = import.meta.glob<unknown>(
  '../../../packages/asset-catalog/catalog/v*/catalog.json',
  { eager: true, import: 'default' },
)

export function loadLatestProductionCatalog(): Catalog {
  const parsedCatalogs = Object.entries(productionCatalogDocuments).map(([path, document]) => ({
    path,
    result: parseCatalog(document),
  }))
  const invalidCatalog = parsedCatalogs.find(item => !item.result.ok)
  if (invalidCatalog !== undefined && !invalidCatalog.result.ok) {
    throw new Error(
      `Catalog report cannot read ${invalidCatalog.path}: ${invalidCatalog.result.diagnostics.map(item => item.code).join(', ')}`,
    )
  }
  return pickLatestCatalog(parsedCatalogs.map(item => {
    if (!item.result.ok) throw new Error(`Catalog report cannot read ${item.path}.`)
    return item.result.value
  }))
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
