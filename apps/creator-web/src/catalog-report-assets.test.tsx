import { describe, expect, it } from 'vitest'
import { resolveCatalogReportAssetUrl } from './catalog-report-assets.js'

describe('resolveCatalogReportAssetUrl', () => {
  it('resolves a tracked structural PNG but rejects an unbundled report image', async () => {
    await expect(resolveCatalogReportAssetUrl(
      '0.6.0',
      'assets/v0.6.0/anatomy/feline-sit/feline-sit-violet-curl/structural.png',
    )).resolves.toMatch(/feline-sit-violet-curl.*structural/)
    await expect(resolveCatalogReportAssetUrl('0.6.0', 'parts/not-a-report-image.png'))
      .rejects.toThrow('not bundled')
  })
})
