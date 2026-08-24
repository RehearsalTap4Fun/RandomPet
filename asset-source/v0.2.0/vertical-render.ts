import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { resolvePlacement } from '../../packages/renderer-canvas/src/layout.js'

const runtimePath = 'packages/asset-catalog/assets/v0.1.0/rigs/base_blob_v1.png'
const reviewPath = 'asset-source/v0.1.0/review/base_blob_v1-vertical-render.png'
const runtime = await readFile(runtimePath)
const placement = resolvePlacement(
  { x: 1024, y: 1024 },
  { x: 512, y: 512 },
  { scale: 1, mirrorX: false },
  [{ scale: 1, mirrorX: false }],
)
if (!placement.ok) throw new Error(JSON.stringify(placement.diagnostic))

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
  await page.setContent('<canvas id="target" width="1024" height="1024"></canvas>')
  const metrics = await page.locator('#target').evaluate(async (element, input) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')!
    const image = new Image()
    image.src = `data:image/png;base64,${input.runtimeBase64}`
    await image.decode()
    context.save()
    context.scale(0.5, 0.5)
    context.translate(input.x, input.y)
    context.scale(input.scaleX, input.scaleY)
    context.drawImage(image, 0, 0)
    context.restore()
    const pixels = context.getImageData(0, 0, 1024, 1024).data
    let nonzeroAlphaPixels = 0
    let boundaryAlphaPixels = 0
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) nonzeroAlphaPixels += 1
    }
    for (let x = 0; x < 1024; x += 1) {
      if (pixels[x * 4 + 3] !== 0) boundaryAlphaPixels += 1
      if (pixels[((1023 * 1024 + x) * 4) + 3] !== 0) boundaryAlphaPixels += 1
    }
    for (let y = 1; y < 1023; y += 1) {
      if (pixels[(y * 1024) * 4 + 3] !== 0) boundaryAlphaPixels += 1
      if (pixels[(y * 1024 + 1023) * 4 + 3] !== 0) boundaryAlphaPixels += 1
    }
    let binary = ''
    const chunk = 32768
    for (let offset = 0; offset < pixels.length; offset += chunk) {
      binary += String.fromCharCode(...pixels.subarray(offset, offset + chunk))
    }
    return {
      width: canvas.width,
      height: canvas.height,
      nonzeroAlphaPixels,
      boundaryAlphaPixels,
      rgbaBase64: btoa(binary),
    }
  }, {
    runtimeBase64: runtime.toString('base64'),
    ...placement.value,
  })
  await mkdir('asset-source/v0.1.0/review', { recursive: true })
  await page.locator('#target').screenshot({ path: reviewPath, omitBackground: true })
  const rgba = Buffer.from(metrics.rgbaBase64, 'base64')
  console.log(JSON.stringify({
    reviewPath,
    placement: placement.value,
    width: metrics.width,
    height: metrics.height,
    nonzeroAlphaPixels: metrics.nonzeroAlphaPixels,
    boundaryAlphaPixels: metrics.boundaryAlphaPixels,
    rgbaSha256: createHash('sha256').update(rgba).digest('hex'),
  }, null, 2))
} finally {
  await browser.close()
}
