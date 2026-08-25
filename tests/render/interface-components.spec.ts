import { expect, test, type Page } from '@playwright/test'

type Variant = 'baseline' | 'foreground-hole' | 'background-hole' | 'shifted-contour'

interface InterfaceSnapshot {
  specJson: string
  catalogJson: string
  diagnostics: Array<{ code: string }>
  connectorMetrics: Array<{
    connectorId: string
    receiverCoverage: number
    plugCoverage: number
    largestComponentRatio: number
    centerlineGapPixels: number
  }>
  frontSeam: number[]
  rearSeam: number[]
  contourProbe: number[]
}

async function renderVariant(page: Page, variant: Variant): Promise<InterfaceSnapshot> {
  await page.goto(`/render-test.html?interfaceVariant=${variant}`)
  await page.waitForFunction(() => (
    document.body.dataset.renderComplete === 'true'
    || document.body.dataset.renderError !== undefined
  ))
  const error = await page.evaluate(() => document.body.dataset.renderError)
  if (error !== undefined) throw new Error(error)
  return page.locator('#render-target').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2D context unavailable')
    const result = document.body.dataset.interfaceResult
    if (result === undefined) throw new Error('Missing real interface-render result.')
    const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data)
    return {
      ...JSON.parse(result),
      frontSeam: pixel(1043, 1025),
      rearSeam: pixel(1005, 1010),
      contourProbe: pixel(1005, 1010),
    }
  })
}

test('changing only foreground connector pixels changes the front seam', async ({ browser }) => {
  const baselinePage = await browser.newPage()
  const foregroundPage = await browser.newPage()
  try {
    const baseline = await renderVariant(baselinePage, 'baseline')
    const foreground = await renderVariant(foregroundPage, 'foreground-hole')

    expect(baseline.diagnostics).toEqual([])
    expect(foreground.diagnostics).toEqual([])
    expect(baseline.specJson).toContain('"seed":"real-raster-causal-isolation"')
    expect(baseline.catalogJson).toContain('"version":"0.3.0"')
    expect(foreground.specJson).toBe(baseline.specJson)
    expect(foreground.catalogJson).toBe(baseline.catalogJson)
    expect(baseline.frontSeam[0]).toBeGreaterThan(baseline.frontSeam[2]!)
    expect(foreground.frontSeam[2]).toBeGreaterThan(foreground.frontSeam[0]!)
    expect(foreground.frontSeam).not.toEqual(baseline.frontSeam)
    expect(foreground.rearSeam).toEqual(baseline.rearSeam)
  } finally {
    await baselinePage.close()
    await foregroundPage.close()
  }
})

test('changing only background connector pixels changes the rear seam', async ({ browser }) => {
  const baselinePage = await browser.newPage()
  const backgroundPage = await browser.newPage()
  try {
    const baseline = await renderVariant(baselinePage, 'baseline')
    const background = await renderVariant(backgroundPage, 'background-hole')

    expect(baseline.diagnostics).toEqual([])
    expect(background.diagnostics).toEqual([])
    expect(background.specJson).toBe(baseline.specJson)
    expect(background.catalogJson).toBe(baseline.catalogJson)
    expect(baseline.rearSeam[3]).toBeGreaterThan(0)
    expect(background.rearSeam[3]).toBe(0)
    expect(background.frontSeam).toEqual(baseline.frontSeam)
  } finally {
    await baselinePage.close()
    await backgroundPage.close()
  }
})

test('real rasterized contours and warped masks feed bridge metrics and geometry', async ({ browser }) => {
  const baselinePage = await browser.newPage()
  const shiftedPage = await browser.newPage()
  try {
    const baseline = await renderVariant(baselinePage, 'baseline')
    const shifted = await renderVariant(shiftedPage, 'shifted-contour')
    const metric = baseline.connectorMetrics[0]!
    const shiftedMetric = shifted.connectorMetrics[0]!

    expect(baseline.diagnostics).toEqual([])
    expect(shifted.diagnostics).toEqual([])
    expect(shifted.specJson).toBe(baseline.specJson)
    expect(shifted.catalogJson).toBe(baseline.catalogJson)
    expect(metric.connectorId).toBe('neck')
    expect(metric.receiverCoverage).toBeGreaterThanOrEqual(0.9)
    expect(metric.receiverCoverage).toBeLessThan(1)
    expect(metric.plugCoverage).toBeGreaterThanOrEqual(0.9)
    expect(metric.plugCoverage).toBeLessThan(1)
    expect(metric.centerlineGapPixels).toBeGreaterThan(0)
    expect(metric.centerlineGapPixels).toBeLessThanOrEqual(2)
    expect(metric.largestComponentRatio).toBeGreaterThanOrEqual(0.99)
    expect(shiftedMetric.receiverCoverage).toBeGreaterThanOrEqual(0.9)
    expect(shiftedMetric.plugCoverage).toBeGreaterThanOrEqual(0.9)
    expect(shiftedMetric.centerlineGapPixels).toBeLessThanOrEqual(2)
    expect(shifted.contourProbe[3]).toBe(0)
    expect(baseline.contourProbe[3]).toBeGreaterThan(0)
  } finally {
    await baselinePage.close()
    await shiftedPage.close()
  }
})
