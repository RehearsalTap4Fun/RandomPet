import { describe, expect, it } from 'vitest'
import {
  connectorMetricMeetsThresholds,
  measureConnectorAlpha,
  structureMetricMeetsThreshold,
} from './connector-metrics.js'

function raster(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  return {
    pixels,
    point(x: number, y: number, alpha = 255) {
      pixels[(y * width + x) * 4 + 3] = alpha
      return this
    },
    line(fromX: number, toX: number, y: number, alpha = 255) {
      for (let x = fromX; x <= toX; x += 1) this.point(x, y, alpha)
      return this
    },
  }
}

describe('measureConnectorAlpha', () => {
  it('measures bridge alpha overlap against full antialiased contour rasters', () => {
    const width = 10
    const receiverContour = raster(width, 2).line(0, 9, 0).pixels
    const plugContour = raster(width, 2).line(0, 9, 1).pixels
    const bridge = raster(width, 2)
      .line(0, 8, 0)
      .line(0, 7, 1)
      .point(8, 1, 128)
      .point(9, 1, 127)
      .pixels
    const structure = raster(width, 2).line(0, 9, 0).line(0, 9, 1).pixels

    const metric = measureConnectorAlpha({
      connectorId: 'neck', bridge, receiverContour, plugContour, structure,
      width, height: 2, centerline: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    })

    expect(metric.receiverCoverage).toBe(0.9)
    expect(metric.plugCoverage).toBe(0.9)
    expect(connectorMetricMeetsThresholds(metric, false)).toBe(true)

    bridge[(1 * width + 9) * 4 + 3] = 126
    const below = measureConnectorAlpha({
      connectorId: 'neck', bridge, receiverContour, plugContour, structure,
      width, height: 2, centerline: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    })
    expect(below.plugCoverage).toBeLessThan(0.9)
    expect(connectorMetricMeetsThresholds(below, false)).toBe(false)
  })

  it('uses alpha mass rather than occupied-pixel count for connected components', () => {
    const structure = raster(4, 1)
      .point(0, 0, 255)
      .point(1, 0, 255)
      .point(3, 0, 5)
      .pixels
    const contour = raster(4, 1).point(0, 0).pixels
    const bridge = raster(4, 1).point(0, 0).pixels

    const metric = measureConnectorAlpha({
      connectorId: 'neck', bridge, receiverContour: contour, plugContour: contour,
      structure, width: 4, height: 1, centerline: [{ x: 0, y: 0 }],
    })

    expect(metric.largestComponentRatio).toBeCloseTo(510 / 515, 8)
    expect(structureMetricMeetsThreshold(metric)).toBe(true)

    const disconnected = structure.slice()
    disconnected[3 * 4 + 3] = 6
    expect(structureMetricMeetsThreshold(measureConnectorAlpha({
      connectorId: 'neck', bridge, receiverContour: contour, plugContour: contour,
      structure: disconnected, width: 4, height: 1, centerline: [{ x: 0, y: 0 }],
    }))).toBe(false)
  })

  it('normalizes full-centerline alpha gaps to the 1024 render scale', () => {
    const measure = (width: 1024 | 2048, samples: number, gaps: number) => {
      const bridgeRaster = raster(width, 1)
      const centerline = Array.from({ length: samples }, (_, x) => ({ x, y: 0 }))
      for (let x = gaps; x < samples; x += 1) bridgeRaster.point(x, 0)
      const contour = raster(width, 1).point(samples - 1, 0).pixels
      return measureConnectorAlpha({
        connectorId: 'neck', bridge: bridgeRaster.pixels,
        receiverContour: contour, plugContour: contour, structure: bridgeRaster.pixels,
        width, height: 1, centerline,
      }).centerlineGapPixels
    }

    expect(measure(1024, 16, 2)).toBe(2)
    expect(measure(2048, 32, 4)).toBe(2)
  })

  it('reports external alpha mass only when body and visible limb masks are supplied', () => {
    const body = raster(6, 1).line(0, 2, 0).pixels
    const child = raster(6, 1).line(2, 5, 0).pixels
    const bridge = raster(6, 1).line(0, 5, 0).pixels
    const contour = raster(6, 1).point(0, 0).pixels
    const base = {
      connectorId: 'shoulderLeft', bridge, receiverContour: contour, plugContour: contour,
      structure: bridge, width: 6, height: 1, centerline: [{ x: 0, y: 0 }],
    }

    expect(measureConnectorAlpha({ ...base, body, child }).childOutsideBodyRatio).toBe(0.75)
    expect(measureConnectorAlpha(base).childOutsideBodyRatio).toBeNull()
  })
})
