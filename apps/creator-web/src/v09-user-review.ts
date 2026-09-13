import { generateMonsterV09, V09_COMPOSITION_NODE_IDS } from '@qmonster/generator-core'
import { renderMonsterV09, resolveV09Composite } from '@qmonster/renderer-canvas'
import { toIncubatorRecordV09 } from '@qmonster/incubator-adapter'
import { createProductionV09ResourceResolver } from './components/PreviewCanvas.js'
import { loadActiveProductionRelease, type ProductionV09Release } from './v09-production-release.js'

let release: ProductionV09Release | undefined
const seen = new Set<string>()
const resolver = createProductionV09ResourceResolver()
async function initialize(pointer: unknown) {
  if (release !== undefined) throw new Error('Acceptance renderer is already initialized')
  release = await loadActiveProductionRelease({ pointer })
  const manifest = release.catalog.releaseManifest
  const assemblyApprovals = await Promise.all(manifest.approvals.map(async ref => ({ sha256: ref.sha256, approval: (await resolver.resolveJson(ref)).value })))
  return { manifestHash: release.manifestHash, rendererBuildSha256: manifest.rendererBuildSha256,
    assemblyTemplates: manifest.assemblyTemplates, assemblyApprovals, traitApprovals: manifest.traitApprovals }
}
async function renderOnce(seed: string) {
  if (!release || seen.has(seed)) throw new Error('Acceptance renderer unavailable or seed already consumed')
  seen.add(seed)
  const generated = generateMonsterV09({ seed }, release.catalog)
  if (generated.blocked) throw new Error(JSON.stringify(generated.diagnostics))
  const spec = generated.spec, record = toIncubatorRecordV09(spec, release.catalog)
  if (!record.ok) throw new Error(JSON.stringify(record.diagnostics))
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 2048
  const context = canvas.getContext('2d', { colorSpace: 'srgb' })!
  let draws = 0, transforms = 0
  const nativeDraw = context.drawImage.bind(context), nativeTransform = context.setTransform.bind(context)
  context.drawImage = ((source: CanvasImageSource, ...args: number[]) => {
    if (args.length !== 2 || args[0] !== 0 || args[1] !== 0) throw new Error('Non-identity draw')
    draws++; nativeDraw(source, 0, 0)
  }) as typeof context.drawImage
  context.setTransform = ((...args: number[]) => {
    if (args.join(',') !== '1,0,0,1,0,0') throw new Error('Non-identity transform')
    transforms++; nativeTransform(1, 0, 0, 1, 0, 0)
  }) as typeof context.setTransform
  const resourceIds = new Set<string>()
  const result = await renderMonsterV09(context, resolveV09Composite(spec, release.catalog), {
    resolvePng(ref) { resourceIds.add(ref.resourceId); return resolver.resolvePng(ref) },
    resolveJson(ref) { resourceIds.add(ref.resourceId); return resolver.resolveJson(ref) },
    createDrawable: resolver.createDrawable.bind(resolver),
  })
  if (JSON.stringify(result.trace) !== JSON.stringify(V09_COMPOSITION_NODE_IDS) || draws !== transforms) throw new Error('Composition graph mismatch')
  return { spec, trace: result.trace, identityTransforms: true, resourceIds: [...resourceIds].sort(),
    dataUrl: canvas.toDataURL('image/png'), incubator: record.value }
}
declare global {
  interface Window {
    initializeV09Review: typeof initialize
    renderV09ReviewOnce: typeof renderOnce
  }
}
window.initializeV09Review = initialize
window.renderV09ReviewOnce = renderOnce
document.body.dataset.rendererReady = 'true'
