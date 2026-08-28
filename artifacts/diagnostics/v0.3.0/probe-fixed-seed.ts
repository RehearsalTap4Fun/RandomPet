import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { generateMonster, parseCatalog, VISUAL_SLOT_IDS } from '@qmonster/generator-core'
import { createServer } from 'vite'
import { browserCatalog, fsUrl } from '../../../scripts/render-limb-contact-sheets.js'

const seed = process.argv[2] ?? '2026082101'
const themeId = (process.argv[3] ?? 'deep-sea') as 'deep-sea' | 'fungal' | 'shadow'
const eyesShiftY = Number(process.argv[4] ?? 0)
const neckDepthScale = Number(process.argv[5] ?? 1)
const outputLabel = process.argv[6]
const faceSafeBottomAdd = Number(process.argv[7] ?? 0)
const catalog = parseCatalog(JSON.parse(await readFile(
  'packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8',
)))
if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics))
for (const part of catalog.value.parts) {
  if (part.composition?.mode !== 'interface') continue
  const variant = part.composition.variantsByRig.blob
  if (variant === undefined) continue
  for (const connector of variant.connectors) {
    if (connector.id === 'neck') connector.depth *= neckDepthScale
  }
  if (part.id === 'head_round_dome' && variant.featureSockets !== undefined) {
    variant.featureSockets.eyes.y += eyesShiftY
    variant.featureSockets.mouth.y = Math.max(
      variant.featureSockets.mouth.y,
      variant.featureSockets.eyes.y + 120,
    )
  }
  if (part.id === 'head_round_dome') {
    const bipedVariant = part.composition.variantsByRig.biped
    if (bipedVariant?.faceSafeZones?.[0] !== undefined) {
      bipedVariant.faceSafeZones[0].height += faceSafeBottomAdd
    }
  }
}
const generated = generateMonster({ seed, themeId, mode: 'normal' }, catalog.value)
if (generated.blocked || generated.diagnostics.length > 0) throw new Error(JSON.stringify(generated.diagnostics))

const temporaryRoot = await mkdtemp(resolve('.tmp-composite-probe-'))
const inputPath = resolve(temporaryRoot, `${seed}.json`)
const browserReadyCatalog = browserCatalog(catalog.value, {
  activeStructuralSlots: VISUAL_SLOT_IDS,
  applyPaletteMasks: true,
})
await writeFile(inputPath, `${JSON.stringify({ catalog: browserReadyCatalog, spec: generated.spec })}\n`)
const server = await createServer({
  root: resolve('apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
})
await server.listen()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 2048, height: 2048 } })
try {
  const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) throw new Error('No Vite URL')
  await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
  await page.waitForFunction(() => (
    document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined
  ))
  const error = await page.evaluate(() => document.body.dataset.renderError)
  if (error !== undefined) throw new Error(error)
  const evidence = await page.evaluate(() => JSON.parse(document.body.dataset.interfaceResult!))
  const suffix = outputLabel ?? (eyesShiftY === 0 && neckDepthScale === 1
    ? 'pre-fix'
    : `probe-eyes-${eyesShiftY}-neck-depth-${neckDepthScale}`)
  const imagePath = resolve(`artifacts/diagnostics/v0.3.0/task10-seed-${seed}-${suffix}-2048.png`)
  await page.locator('#render-target').screenshot({ path: imagePath, omitBackground: true })
  console.log(JSON.stringify({
    seed, themeId, eyesShiftY, neckDepthScale, faceSafeBottomAdd, visualSlots: generated.spec.visualSlots,
    evidence: {
      diagnostics: evidence.diagnostics,
      connectorMetrics: evidence.connectorMetrics,
      compositionMetrics: evidence.compositionMetrics,
      resolvedAssetCount: evidence.resolvedAssetPaths.length,
    },
    imagePath,
  }))
} finally {
  await page.close()
  await browser.close()
  await server.close()
  await rm(temporaryRoot, { recursive: true, force: true })
}
