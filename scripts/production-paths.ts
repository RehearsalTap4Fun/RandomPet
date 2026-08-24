export interface ProductionPaths {
  catalogDirectory: string
  assetDirectory: string
  sourceRoot: string
  sourceIndexPath: string
  auditDirectory: string
  reviewDirectory: string
  acceptanceDirectory: string
}

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

export function productionPaths(version: string): ProductionPaths {
  if (!RELEASE_VERSION.test(version)) throw new Error(`Invalid production version: ${version}`)
  const tag = `v${version}`
  const legacySourceIndex = version === '0.1.0'
  return {
    catalogDirectory: `packages/asset-catalog/catalog/${tag}`,
    assetDirectory: `packages/asset-catalog/assets/${tag}`,
    sourceRoot: `asset-source/${tag}`,
    sourceIndexPath: legacySourceIndex
      ? 'packages/asset-catalog/source-index.json'
      : `packages/asset-catalog/source-index-${tag}.json`,
    auditDirectory: `packages/asset-catalog/audit/${tag}`,
    reviewDirectory: `packages/asset-catalog/review/${tag}`,
    acceptanceDirectory: `artifacts/acceptance/v${version.split('.').slice(0, 2).join('.')}`,
  }
}
