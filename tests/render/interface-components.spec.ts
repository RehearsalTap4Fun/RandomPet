import { expect, test, type Page } from '@playwright/test'

type Variant = 'baseline' | 'foreground-hole' | 'background-hole' | 'shifted-contour' | 'curved-head-split' | 'misaligned-occlusion-masks'

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
  outwardPlug: number[]
  inwardHeadShell: number[]
  face: number[]
  curvedShellEdge: number[]
  pedestal: number[]
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
      outwardPlug: pixel(995, 990),
      inwardHeadShell: pixel(1005, 1055),
      face: pixel(910, 810),
      curvedShellEdge: pixel(960, 1045),
      pedestal: pixel(1024, 1120),
    }
  })
}

test('keeps a head plug under the body while its inward shell and face stay in front', async ({ page }) => {
  const rendered = await renderVariant(page, 'baseline')

  expect(rendered.outwardPlug).toEqual([0, 64, 255, 255])
  expect(rendered.inwardHeadShell).toEqual([255, 32, 0, 255])
  expect(rendered.face).toEqual([17, 17, 17, 255])
})

test('uses the declared organic head shell mask instead of a connector half-plane', async ({ page }) => {
  const rendered = await renderVariant(page, 'curved-head-split')

  expect(rendered.curvedShellEdge).toEqual([255, 32, 0, 255])
  expect(rendered.pedestal).toEqual([0, 64, 255, 255])
})

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
    expect(metric.centerlineGapPixels).toBeLessThan(0.1)
    expect(shiftedMetric.centerlineGapPixels).toBeLessThan(0.1)
    // Bundled browsers rasterize the shifted 1px contour to a zero gap while
    // system Chrome/Edge retain a subpixel gap. The structural contract is the
    // same: the shifted contour must measurably change the metric vector while
    // both shapes remain far inside the 2px production gate.
    const metricVectorDelta = (
      Math.abs(shiftedMetric.receiverCoverage - metric.receiverCoverage)
      + Math.abs(shiftedMetric.plugCoverage - metric.plugCoverage)
      + Math.abs(shiftedMetric.centerlineGapPixels - metric.centerlineGapPixels)
    )
    expect(metricVectorDelta).toBeGreaterThan(0.01)
  } finally {
    await baselinePage.close()
    await shiftedPage.close()
  }
})

test('structural bridge metrics do not depend on visual occlusion-mask alignment', async ({ page }) => {
  const rendered = await renderVariant(page, 'misaligned-occlusion-masks')
  const metric = rendered.connectorMetrics[0]!

  expect(rendered.diagnostics).toEqual([])
  expect(metric.receiverCoverage).toBeGreaterThanOrEqual(0.9)
  expect(metric.plugCoverage).toBeGreaterThanOrEqual(0.9)
  expect(metric.centerlineGapPixels).toBeLessThanOrEqual(2)
})
