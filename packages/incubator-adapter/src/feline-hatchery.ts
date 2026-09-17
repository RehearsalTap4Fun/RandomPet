// Browser-side hatchery integration using the pinned release snapshot.
// Keep the legacy runtime independent of pixel schema exports in the package barrels.
import { generateFelineCombination, parseFelineCombinationSpec, type FelineCombinationSelections, type FelineCombinationSpec } from '../../generator-core/src/feline-combination.js'
import { parseFelineCombinationCatalog, auditFelineCombinationCatalog, resolveFelineCombination } from '../../asset-catalog/src/feline-combination-catalog.js'
import { createFelineCombinationResourceResolver, renderFelineCombination } from '../../renderer-canvas/src/feline-combination-render.js'
import { exportCanvas, CanvasExportError } from '../../renderer-canvas/src/export.js'
import snapshot from '../../../docs/integration/feline-combination-snapshot.json'
import previousSnapshot from '../../../docs/releases/v0.10.0/previous-snapshot.json'
import preBatchSnapshot from '../../../docs/releases/v0.10.0/mutation-batch1/previous-snapshot.json'
import reviewSnapshot from '../../../docs/releases/v0.10.0/mutation-batch1/review-snapshot.json'
import preBodySnapshot from '../../../docs/releases/v0.10.0/body-batch1/previous-snapshot.json'
import preManeSnapshot from '../../../docs/releases/v0.10.0/body-batch1/mane-fix-previous-snapshot.json'

export interface StoredFelineVisual {
  kind: 'qmonster-feline-combination'
  spec: FelineCombinationSpec
  catalogSha256: string
  runtimeRevision: string
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child)).join(',') + '}'
  }
  return JSON.stringify(value)
}
async function sha256(bytes: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('')
}

/** URLs come from application deployment config, never from a saved creature. */
export async function createFelineHatchery(config: { catalogUrl: string; resourceBaseUrl: string }) {
  const response = await fetch(config.catalogUrl)
  if (!response.ok) throw new Error(`CATALOG: HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  if (await sha256(bytes) !== snapshot.catalogSha256) throw new Error('CATALOG: snapshot hash mismatch')
  const parsed = parseFelineCombinationCatalog(JSON.parse(new TextDecoder().decode(bytes)))
  if (!parsed.ok) throw new Error('CATALOG: ' + JSON.stringify(parsed.diagnostics))
  const diagnostics = auditFelineCombinationCatalog(parsed.value)
  if (diagnostics.length) throw new Error('CATALOG: ' + JSON.stringify(diagnostics))
  const catalog = parsed.value
  const base = new URL(config.resourceBaseUrl, location.href)
  if (!base.pathname.endsWith('/')) throw new Error('CONFIG: resourceBaseUrl must end with /')
  const resolve = createFelineCombinationResourceResolver(resource => new URL(resource.path, base).href)

  async function render(visual: StoredFelineVisual) {
    const current = visual?.catalogSha256 === snapshot.catalogSha256 && visual.runtimeRevision === snapshot.runtimeRevision
    const previous = visual?.catalogSha256 === previousSnapshot.catalogSha256 && visual.runtimeRevision === previousSnapshot.runtimeRevision
    const preBatch = visual?.catalogSha256 === preBatchSnapshot.catalogSha256 && visual.runtimeRevision === preBatchSnapshot.runtimeRevision
    const reviewed = visual?.catalogSha256 === reviewSnapshot.catalogSha256 && visual.runtimeRevision === reviewSnapshot.runtimeRevision
    const preBody = visual?.catalogSha256 === preBodySnapshot.catalogSha256 && visual.runtimeRevision === preBodySnapshot.runtimeRevision
    const preMane = visual?.catalogSha256 === preManeSnapshot.catalogSha256 && visual.runtimeRevision === preManeSnapshot.runtimeRevision
    if (visual?.kind !== 'qmonster-feline-combination' || (!current && !previous && !preBatch && !reviewed && !preBody && !preMane)) throw new Error('RESTORE: unsupported visual snapshot')
    const parsedSpec = parseFelineCombinationSpec(visual.spec)
    if (!parsedSpec.ok) throw new Error('SPEC: ' + JSON.stringify(parsedSpec.diagnostics))
    if ((previous || preBatch) && Object.values(parsedSpec.value.selections).some(value => ['halo', 'dragon-wings', 'feathered-wings', 'frill-neck', 'flame-tail'].includes(value))) {
      throw new Error('RESTORE: mutation was not available in the saved snapshot')
    }
    const stored: StoredFelineVisual = { kind: visual.kind, spec: parsedSpec.value,
      catalogSha256: snapshot.catalogSha256, runtimeRevision: snapshot.runtimeRevision }
    // Each request owns a canvas: overlapping hatch requests cannot overwrite it.
    const canvas = document.createElement('canvas')
    await renderFelineCombination(canvas, resolveFelineCombination(stored.spec, catalog), resolve)
    let blob: Blob
    try { blob = await exportCanvas(canvas, 'image/webp') }
    catch (error) {
      if (!(error instanceof CanvasExportError) || error.code !== 'WEBP_EXPORT_UNSUPPORTED') throw error
      blob = await exportCanvas(canvas, 'image/png')
    }
    const specHash = await sha256(new TextEncoder().encode(canonical(stored.spec)))
    const cacheKey = `qmonster:feline:${stored.catalogSha256}:${stored.runtimeRevision}:1254:${blob.type}:${specHash}`
    return { visual: stored, image: { blob, mime: blob.type as 'image/webp' | 'image/png', width: 1254, height: 1254, cacheKey } }
  }
  return {
    hatch: (seed: string, selections: Partial<FelineCombinationSelections> = {}) => render({
      kind: 'qmonster-feline-combination', spec: generateFelineCombination(seed, selections),
      catalogSha256: snapshot.catalogSha256, runtimeRevision: snapshot.runtimeRevision,
    }),
    restore: render,
  }
}
