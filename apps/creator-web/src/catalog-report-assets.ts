const REPORT_ASSET_ROOT = '../../../packages/asset-catalog/assets/'

const reportAssetUrls = import.meta.glob<string>(
  '../../../packages/asset-catalog/assets/v*/anatomy/**/structural.png',
  { query: '?url', import: 'default' },
)

export async function resolveCatalogReportAssetUrl(catalogVersion: string, assetPath: string): Promise<string> {
  const normalizedPath = assetPath.startsWith('assets/')
    ? assetPath.slice('assets/'.length)
    : `v${catalogVersion}/${assetPath}`
  const loadUrl = reportAssetUrls[`${REPORT_ASSET_ROOT}${normalizedPath}`]
  if (loadUrl === undefined) {
    throw new Error(`Catalog report asset is not bundled: v${catalogVersion}/${assetPath}`)
  }
  return loadUrl()
}
