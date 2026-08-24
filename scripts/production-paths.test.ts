import { describe, expect, it } from 'vitest'
import { productionPaths } from './production-paths.js'

describe('productionPaths', () => {
  it('derives every production root from a validated semantic version', () => {
    expect(productionPaths('0.2.0')).toEqual({
      catalogDirectory: 'packages/asset-catalog/catalog/v0.2.0',
      assetDirectory: 'packages/asset-catalog/assets/v0.2.0',
      sourceRoot: 'asset-source/v0.2.0',
      sourceIndexPath: 'packages/asset-catalog/source-index-v0.2.0.json',
      auditDirectory: 'packages/asset-catalog/audit/v0.2.0',
      reviewDirectory: 'packages/asset-catalog/review/v0.2.0',
      acceptanceDirectory: 'artifacts/acceptance/v0.2',
    })
  })

  it('rejects path separators and prerelease labels as production versions', () => {
    expect(() => productionPaths('../0.2.0')).toThrow('Invalid production version')
    expect(() => productionPaths('0.2.0-rc.1')).toThrow('Invalid production version')
  })
})
