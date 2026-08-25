import { expect, test, type Page } from '@playwright/test'

type Variant = 'baseline' | 'swapped' | 'shifted-contour'

interface InterfaceSnapshot {
  diagnostics: Array<{ code: string }>
  connectorMetrics: Array<{
    connectorId: string
    receiverCoverage: number
    plugCoverage: number
    largestComponentRatio: number
    centerlineGapPixels: number
  }>
  leftSeam: number[]
  rightSeam: number[]
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
      leftSeam: pixel(1005, 1025),
      rightSeam: pixel(1043, 1025),
      contourProbe: pixel(1005, 1010),
    }
  })
}

test('real connector foreground/background masks swap composed seam pixels', async ({ browser }) => {
  const baselinePage = await browser.newPage()
  const swappedPage = await browser.newPage()
  try {
    const baseline = await renderVariant(baselinePage, 'baseline')
    const swapped = await renderVariant(swappedPage, 'swapped')

    expect(baseline.diagnostics).toEqual([])
    expect(swapped.diagnostics).toEqual([])
    expect(baseline.leftSeam[2]).toBeGreaterThan(baseline.leftSeam[0]!)
    expect(baseline.rightSeam[0]).toBeGreaterThan(baseline.rightSeam[2]!)
    expect(swapped.leftSeam[0]).toBeGreaterThan(swapped.leftSeam[2]!)
    expect(swapped.rightSeam[2]).toBeGreaterThan(swapped.rightSeam[0]!)
    expect(swapped.leftSeam).not.toEqual(baseline.leftSeam)
    expect(swapped.rightSeam).not.toEqual(baseline.rightSeam)
  } finally {
    await baselinePage.close()
    await swappedPage.close()
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
