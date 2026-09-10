import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import {
  V09_COMPOSITION_NODE_IDS,
  V09_VERSION_TUPLE,
  generateMonsterV09,
  type AssemblyTemplateV1,
  type CompositionGraphV1,
  type JsonResourceRef,
  type ReleaseManifestV09,
  type ResolvedV09Catalog,
  type SealedTraitArtifactV1,
  type SkeletonFamilyV1,
  type SkeletonPoolV1,
  type V09GenerationRequest,
} from '@qmonster/generator-core'
import { canonicalJsonSha256, decodedPngSha256 } from '@qmonster/asset-catalog'
import {
  renderMonsterV09,
  resolveV09Composite,
  type V09DecodedPng,
  type V09ResourceResolver,
} from '@qmonster/renderer-canvas'

const catalogRoot = join(process.cwd(), 'packages', 'asset-catalog')
const resourceRoot = join(catalogRoot, 'resources', 'by-sha256')

interface BrowserFixtureResult {
  spec: ReturnType<typeof generateMonsterV09>['spec']
  trace: string[]
  pixelSha256: string
  resourceIds: string[]
  drawCalls: number
  identityTransforms: boolean
}

interface NodeFixtureResult extends BrowserFixtureResult {}

function div255Round(value: number): number {
  const biased = value + 128
  return (biased + (biased >> 8)) >> 8
}

/** Produce lossless black/white projections of Chromium's premultiplied Canvas2D backing store. */
function compositeCanvasLayers(layers: readonly Uint8Array[]): Uint8Array {
  const premultiplied = new Uint8Array(2048 * 2048 * 4)
  for (const source of layers) {
    for (let index = 0; index < source.length; index += 4) {
      const sourceAlpha = source[index + 3]!
      if (sourceAlpha === 0) continue
      if (sourceAlpha === 255) {
        premultiplied.set(source.subarray(index, index + 4), index)
        continue
      }
      const destinationScale = 256 - sourceAlpha
      premultiplied[index] = div255Round(source[index]! * sourceAlpha) + ((premultiplied[index]! * destinationScale) >> 8)
      premultiplied[index + 1] = div255Round(source[index + 1]! * sourceAlpha) + ((premultiplied[index + 1]! * destinationScale) >> 8)
      premultiplied[index + 2] = div255Round(source[index + 2]! * sourceAlpha) + ((premultiplied[index + 2]! * destinationScale) >> 8)
      premultiplied[index + 3] = sourceAlpha + ((premultiplied[index + 3]! * destinationScale) >> 8)
    }
  }
  const output = new Uint8Array(premultiplied.length * 2)
  for (let index = 0; index < premultiplied.length; index += 4) {
    const alpha = premultiplied[index + 3]!
    output[index] = premultiplied[index]!
    output[index + 1] = premultiplied[index + 1]!
    output[index + 2] = premultiplied[index + 2]!
    output[index + 3] = 255
    const white = premultiplied.length + index
    output[white] = premultiplied[index]! + 255 - alpha
    output[white + 1] = premultiplied[index + 1]! + 255 - alpha
    output[white + 2] = premultiplied[index + 2]! + 255 - alpha
    output[white + 3] = 255
  }
  return output
}

async function resourceBytes(sha256: string): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`Invalid candidate resource digest: ${sha256}`)
  return readFile(join(resourceRoot, sha256))
}

async function readJsonRef<T>(ref: JsonResourceRef): Promise<T> {
  const value = JSON.parse((await resourceBytes(ref.sha256)).toString('utf8')) as T
  expect(canonicalJsonSha256(value)).toBe(ref.sha256)
  return value
}

async function loadCandidateCatalog(): Promise<ResolvedV09Catalog> {
  const pointerPath = join(catalogRoot, 'releases', 'candidate-v0.9.0.json')
  const pointer = JSON.parse((await readFile(pointerPath, 'utf8')).toString()) as {
    schemaVersion: string
    releaseManifestSha256: string
  }
  expect(pointer.schemaVersion).toBe('qmonster-active-release-v1')
  const releaseManifest = JSON.parse((await readFile(join(catalogRoot, 'releases', 'by-sha256', `${pointer.releaseManifestSha256}.json`), 'utf8')).toString()) as ReleaseManifestV09
  expect(canonicalJsonSha256(releaseManifest)).toBe(pointer.releaseManifestSha256)
  expect(releaseManifest.versionTuple).toEqual(V09_VERSION_TUPLE)
  return {
    releaseManifestSha256: pointer.releaseManifestSha256,
    releaseManifest,
    speciesRig: releaseManifest.speciesRig,
    skeletonPool: await readJsonRef<SkeletonPoolV1>(releaseManifest.skeletonPool),
    skeletonFamilies: await Promise.all(releaseManifest.skeletonFamilies.map(ref => readJsonRef<SkeletonFamilyV1>(ref))),
    assemblyTemplates: await Promise.all(releaseManifest.assemblyTemplates.map(ref => readJsonRef<AssemblyTemplateV1>(ref))),
    sealedTraits: await Promise.all(releaseManifest.sealedTraits.map(ref => readJsonRef<SealedTraitArtifactV1>(ref))),
    compositionGraph: await readJsonRef<CompositionGraphV1>(releaseManifest.compositionGraph),
  }
}

async function renderInBrowser(page: Page, request: V09GenerationRequest, catalog: ResolvedV09Catalog): Promise<BrowserFixtureResult> {
  return page.evaluate(
    async input => {
      try {
        return await window.renderV09CandidateFixture(input.request, input.catalog)
      } catch (error) {
        const messages: string[] = []
        let current: unknown = error
        while (current instanceof Error) {
          messages.push(`${current.name}: ${current.message}`)
          current = current.cause
        }
        throw new Error(messages.join(' <- '))
      }
    },
    { request, catalog },
  )
}

function nodeResolver(resourceIds: Set<string>): V09ResourceResolver {
  const pngs = new Map<string, Promise<V09DecodedPng>>()
  return {
    resolvePng(ref) {
      let pending = pngs.get(ref.resourceId)
      if (pending !== undefined) return pending
      pending = (async () => {
        resourceIds.add(ref.resourceId)
        const bytes = await resourceBytes(ref.sha256)
        expect(await decodedPngSha256(bytes)).toBe(ref.sha256)
        const { data, info } = await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        expect([info.width, info.height, info.channels]).toEqual([2048, 2048, 4])
        const pixels = new Uint8Array(data)
        return {
          sha256: ref.sha256,
          width: 2048,
          height: 2048,
          pixels,
          drawable: { pixels } as unknown as CanvasImageSource,
        }
      })()
      pngs.set(ref.resourceId, pending)
      return pending
    },
    async resolveJson(ref) {
      resourceIds.add(ref.resourceId)
      const value = JSON.parse((await resourceBytes(ref.sha256)).toString('utf8')) as unknown
      expect(canonicalJsonSha256(value)).toBe(ref.sha256)
      return { sha256: ref.sha256, value }
    },
    async createDrawable(pixels, width, height) {
      expect([width, height]).toEqual([2048, 2048])
      return { pixels: pixels.slice() } as unknown as CanvasImageSource
    },
  }
}

async function renderInNode(request: V09GenerationRequest, catalog: ResolvedV09Catalog): Promise<NodeFixtureResult> {
  const generated = generateMonsterV09(request, catalog)
  expect(generated.blocked).toBe(false)
  expect(generated.diagnostics).toEqual([])
  const resourceIds = new Set<string>()
  const layers: Uint8Array[] = []
  const transforms: number[][] = []
  const context = {
    canvas: { width: 2048, height: 2048 },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    shadowBlur: 0,
    shadowColor: 'rgba(0,0,0,0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    setTransform: (...values: number[]) => transforms.push(values),
    drawImage: (drawable: { pixels: Uint8Array }, x: number, y: number) => {
      expect([x, y]).toEqual([0, 0])
      layers.push(drawable.pixels)
    },
  } as unknown as CanvasRenderingContext2D
  const rendered = await renderMonsterV09(context, resolveV09Composite(generated.spec, catalog), nodeResolver(resourceIds))
  const pixels = compositeCanvasLayers(layers)
  return {
    spec: generated.spec,
    trace: rendered.trace,
    pixelSha256: createHash('sha256').update(pixels).digest('hex'),
    resourceIds: [...resourceIds].sort(),
    drawCalls: layers.length,
    identityTransforms: transforms.length === layers.length && transforms.every(values => values.join(',') === '1,0,0,1,0,0'),
  }
}

test('renders the immutable v0.9 base and legendary candidate identically in Node and Chromium', async ({ page }) => {
  test.setTimeout(180_000)
  const catalog = await loadCandidateCatalog()
  const decodedResources = new Map<string, Promise<Buffer>>()
  await page.route('**/__v09_candidate_resource__/*', async route => {
    const url = new URL(route.request().url())
    const sha256 = url.pathname.split('/').at(-1) ?? ''
    let body: Buffer
    if (url.searchParams.get('representation') === 'rgba8') {
      let pending = decodedResources.get(sha256)
      if (pending === undefined) {
        pending = sharp(await resourceBytes(sha256)).toColourspace('srgb').ensureAlpha().raw().toBuffer()
        decodedResources.set(sha256, pending)
      }
      body = await pending
    } else {
      body = await resourceBytes(sha256)
    }
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body })
  })
  await page.goto('/v09-render-test.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')

  for (const fixture of [
    { request: { seed: 'task9-parity', skeletonRoll: 0 }, family: 'feline-sit-v2-core', skeletonClass: 'base', pixelSha256: '660db94afd16f675b5a256a8ce1f49e758f86747aca1a53c480a092314672bff' },
    { request: { seed: 'task9-parity', skeletonRoll: 10 }, family: 'feline-sit-v2-legendary-01', skeletonClass: 'legendary', pixelSha256: '683c1402e24c890d12fd449fb06cf6774c3b954e4ad3b71067be2f1fbf6b8d31' },
  ] as const) {
    const node = await renderInNode(fixture.request, catalog)
    const browser = await renderInBrowser(page, fixture.request, catalog)
    expect(browser.spec).toEqual(node.spec)
    expect(browser.spec).toMatchObject({
      ...V09_VERSION_TUPLE,
      skeletonFamilyId: fixture.family,
      skeletonSelection: { class: fixture.skeletonClass },
    })
    expect(browser.trace).toEqual([...V09_COMPOSITION_NODE_IDS])
    expect(node.trace).toEqual(browser.trace)
    expect(browser.resourceIds).toEqual(node.resourceIds)
    expect(browser.drawCalls).toBe(node.drawCalls)
    expect(browser.identityTransforms).toBe(true)
    expect(node.identityTransforms).toBe(true)
    expect(browser.pixelSha256).toBe(node.pixelSha256)
    expect(browser.pixelSha256).toBe(fixture.pixelSha256)
  }
})
