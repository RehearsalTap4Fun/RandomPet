import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { loadCommittedProductionCatalog } from './build-production-catalog.js'
import { generateContactSheets, type ProductionContactRenderer } from './render-production-contact-sheets.js'
import { productionPaths } from './production-paths.js'

const repositoryRoot = process.cwd()
const versionFlag = process.argv.indexOf('--version')
const version = versionFlag === -1 ? undefined : process.argv[versionFlag + 1]
if (versionFlag === -1 || version === undefined || version.startsWith('--') || process.argv.length !== 4) {
  throw new Error('Usage: tsx scripts/render-production-contact-sheets-browser.ts --version <release-version>')
}
const paths = productionPaths(version)
const catalogPath = join(repositoryRoot, paths.catalogDirectory, 'catalog.json')
const assetRoot = join(repositoryRoot, paths.assetDirectory)

function assetPath(relativePath: string): string {
  const resolved = normalize(join(assetRoot, relativePath))
  const remainder = relative(assetRoot, resolved)
  if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error(`Production asset route escaped root: ${relativePath}`)
  return resolved
}

async function main(): Promise<void> {
  const server = await createServer({
    root: join(repositoryRoot, 'apps', 'creator-web'),
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) throw new Error('Vite did not expose a local production-review URL.')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 360 } })
    await page.route('**/production-catalog.json', async route => {
      await route.fulfill({ contentType: 'application/json', body: await readFile(catalogPath) })
    })
    await page.route('**/production-assets/**', async route => {
      const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/production-assets/')[1] ?? '')
      await route.fulfill({ path: assetPath(relativePath) })
    })
    const renderer: ProductionContactRenderer = async (rigId, partId) => {
      await page.goto(`${baseUrl}production-render-test.html?contact=1&rig=${rigId}&part=${encodeURIComponent(partId)}`)
      await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
      const error = await page.evaluate(() => document.body.dataset.renderError)
      if (error !== undefined) throw new Error(`${partId}/${rigId}: ${error}`)
      return page.locator('#render-target').screenshot({ omitBackground: true, type: 'png' })
    }
    const { catalog } = await loadCommittedProductionCatalog({ version })
    const results = await generateContactSheets(catalog, renderer, paths)
    console.log(JSON.stringify(results.map(result => ({
      rigId: result.rigId,
      candidates: result.partIds.length,
      width: result.width,
      height: result.height,
      outputPath: result.outputPath,
      sha256: result.sha256,
    }))))
  } finally {
    await browser.close()
    await server.close()
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
