import {
  isSpeciesRigCatalog,
  resolveSpeciesRig,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type ResourceRef,
  type VisualSlotId,
} from '@qmonster/generator-core'
import { measureVisibleBounds } from './composition-metrics.js'
import type {
  CompositionMetrics,
  ImageResolver,
  RenderOptions,
  RenderResult,
  RenderSurface,
  RenderSurfaceFactory,
  SpeciesRigRenderPlan,
} from './types.js'

const MASTER_SIZE = 2048
const METRIC_SIZE = 512
const FACE_SLOTS = ['eyes', 'mouthShape', 'oralDetail'] as const
type FaceSlot = typeof FACE_SLOTS[number]

interface SpeciesRigSurfaces {
  finalOutput: RenderSurface
  trait: RenderSurface
  mask: RenderSurface
  metricRaw: RenderSurface
  metricClipped: RenderSurface
  outputAlpha: RenderSurface
  faceAlpha: Record<FaceSlot, RenderSurface>
  faceOccluder: Record<FaceSlot, RenderSurface>
}

const defaultSurfaceCache = new WeakMap<object, SpeciesRigSurfaces>()

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function isSpeciesRigComposition(
  composition: NonNullable<SpeciesRigRenderPlan['traits'][number]['part']['composition']>,
): composition is SpeciesRigRenderPlan['traits'][number]['composition'] {
  return composition.mode === 'species-rig'
}

export function resolveSpeciesRigRenderPlan(
  spec: MonsterSpec,
  catalog: Catalog,
): SpeciesRigRenderPlan | null {
  if (!isSpeciesRigCatalog(catalog)) return null
  const speciesRig = resolveSpeciesRig(spec, catalog)
  if (speciesRig === null) return null
  if (
    speciesRig.layerOrder.length !== VISUAL_SLOT_IDS.length
    || new Set(speciesRig.layerOrder).size !== VISUAL_SLOT_IDS.length
    || VISUAL_SLOT_IDS.some(slotId => !speciesRig.layerOrder.includes(slotId))
  ) return null
  const bundle = catalog.anatomyBundles.find(candidate => candidate.id === spec.anatomyBundleId)
  if (bundle === undefined) return null

  const traits: SpeciesRigRenderPlan['traits'] = []
  for (const slotId of speciesRig.layerOrder) {
    const selection = spec.visualSlots[slotId]
    const part = catalog.parts.find(candidate => (
      candidate.id === selection.partId && candidate.slotId === slotId
    ))
    const composition = part?.composition
    if (part === undefined || composition === undefined || !isSpeciesRigComposition(composition)) return null
    if (
      composition.speciesRigId !== speciesRig.id
      || composition.rigVersion !== speciesRig.rigVersion
      || composition.sourceMasterSha256 !== speciesRig.sourceMasterSha256
      || composition.expressionKind !== speciesRig.allowedSlotExpressions[slotId]
      || selection.rigId !== speciesRig.rigId
    ) return null
    const ownerRegion = speciesRig.regions[composition.ownerRegionId]
    if (ownerRegion === undefined) return null
    traits.push({ slotId, part, composition, ownerRegion })
  }
  return traits.length === Object.keys(spec.visualSlots).length
    ? { speciesRig, bundle, traits }
    : null
}

function createSurfaces(
  context: CanvasRenderingContext2D,
  factory: RenderSurfaceFactory,
): SpeciesRigSurfaces | null {
  const cacheKey = context.canvas as unknown as object | undefined
  if (factory === defaultSurfaceFactory && cacheKey !== undefined) {
    const cached = defaultSurfaceCache.get(cacheKey)
    if (cached !== undefined) return cached
  }
  const create = (size: number) => factory(size, size, context)
  const full = [create(MASTER_SIZE), create(MASTER_SIZE), create(MASTER_SIZE)]
  const metric = Array.from({ length: 9 }, () => create(METRIC_SIZE))
  if ([...full, ...metric].some(surface => surface === null)) return null
  const result: SpeciesRigSurfaces = {
    finalOutput: full[0]!,
    trait: full[1]!,
    mask: full[2]!,
    metricRaw: metric[0]!,
    metricClipped: metric[1]!,
    outputAlpha: metric[2]!,
    faceAlpha: { eyes: metric[3]!, mouthShape: metric[4]!, oralDetail: metric[5]! },
    faceOccluder: { eyes: metric[6]!, mouthShape: metric[7]!, oralDetail: metric[8]! },
  }
  if (factory === defaultSurfaceFactory && cacheKey !== undefined) {
    defaultSurfaceCache.set(cacheKey, result)
  }
  return result
}

const defaultSurfaceFactory: RenderSurfaceFactory = (width, height, destination) => {
  const targetCanvas = destination.canvas as HTMLCanvasElement | undefined
  const ownerDocument = targetCanvas?.ownerDocument
  let canvas: HTMLCanvasElement | OffscreenCanvas
  if (ownerDocument !== undefined) canvas = ownerDocument.createElement('canvas')
  else if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height)
  else return null
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) return null
  return {
    canvas: canvas as CanvasImageSource,
    context: context as CanvasRenderingContext2D,
  }
}

function clear(surface: RenderSurface, size = MASTER_SIZE): void {
  surface.context.clearRect(0, 0, size, size)
}

function withSavedContext<T>(context: CanvasRenderingContext2D, action: () => T): T {
  context.save()
  try {
    return action()
  } finally {
    context.restore()
  }
}

function drawMetric(destination: RenderSurface, source: RenderSurface): void {
  destination.context.drawImage(source.canvas, 0, 0, METRIC_SIZE, METRIC_SIZE)
}

function alphaMass(pixels: Uint8ClampedArray): number {
  let total = 0
  for (let offset = 3; offset < pixels.length; offset += 4) total += pixels[offset] ?? 0
  return total
}

function visibleRatio(feature: Uint8ClampedArray, occluder: Uint8ClampedArray): number {
  let total = 0
  let visible = 0
  for (let offset = 3; offset < feature.length; offset += 4) {
    const alpha = feature[offset] ?? 0
    total += alpha
    visible += alpha * (1 - (occluder[offset] ?? 0) / 255)
  }
  return total === 0 ? 1 : visible / total
}

function scaledBounds(pixels: Uint8ClampedArray): CompositionMetrics['visibleBounds'] {
  const bounds = measureVisibleBounds(pixels, METRIC_SIZE, METRIC_SIZE)
  if (bounds === null) return null
  const scale = MASTER_SIZE / METRIC_SIZE
  return {
    x: bounds.x * scale,
    y: bounds.y * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  }
}

function assetLoadDiagnostic(assetPath: string, path: string[]): Diagnostic {
  return error('V08_ASSET_LOAD_FAILED', path, `Failed to load required v0.8 resource ${assetPath}.`)
}

async function loadRequiredAssets(
  plan: SpeciesRigRenderPlan,
  resolver: ImageResolver,
): Promise<{ sources: Map<string, CanvasImageSource>; diagnostics: Diagnostic[] }> {
  const sources = new Map<string, CanvasImageSource>()
  const diagnostics: Diagnostic[] = []
  const required = new Map<string, string[]>([
    [plan.bundle.structural.assetPath, ['anatomyBundles', plan.bundle.id, 'structural']],
  ])
  for (const trait of plan.traits) {
    required.set(trait.part.assetPath, ['parts', trait.part.id, 'assetPath'])
    required.set(trait.ownerRegion.assetPath, [
      'speciesRigs', plan.speciesRig.id, 'regions', trait.composition.ownerRegionId,
    ])
    if (trait.composition.expressionKind === 'protected-effect') {
      required.set(plan.speciesRig.regions.faceProtection.assetPath, [
        'speciesRigs', plan.speciesRig.id, 'regions', 'faceProtection',
      ])
    }
  }
  for (const [assetPath, path] of required) {
    try {
      sources.set(assetPath, await resolver.resolve(assetPath))
    } catch {
      diagnostics.push(assetLoadDiagnostic(assetPath, path))
    }
  }
  return { sources, diagnostics }
}

function faceSlot(slotId: VisualSlotId): FaceSlot | null {
  return FACE_SLOTS.includes(slotId as FaceSlot) ? slotId as FaceSlot : null
}

function metricPixels(surface: RenderSurface): Uint8ClampedArray {
  return surface.context.getImageData(0, 0, METRIC_SIZE, METRIC_SIZE).data
}

function boundsInsideMaster(bounds: CompositionMetrics['visibleBounds']): boolean {
  return bounds === null || (
    bounds.x >= 0
    && bounds.y >= 0
    && bounds.x + bounds.width <= MASTER_SIZE
    && bounds.y + bounds.height <= MASTER_SIZE
  )
}

function renderPlanDiagnostic(): Diagnostic {
  return error(
    'V08_RENDER_PLAN_INVALID',
    ['speciesRigId'],
    'The exact v0.8 spec, anatomy bundle, species rig, and selected traits do not agree.',
  )
}

async function renderSpeciesRigMonsterUnchecked(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  const plan = resolveSpeciesRigRenderPlan(spec, catalog)
  if (plan === null) {
    return {
      drawnAssetIds: [], diagnostics: [renderPlanDiagnostic()],
      compositionMetrics: null, connectorMetrics: [],
    }
  }
  const surfaces = createSurfaces(context, options.surfaceFactory ?? defaultSurfaceFactory)
  if (surfaces === null) {
    return {
      drawnAssetIds: [],
      diagnostics: [error(
        'V08_RENDER_SURFACE_UNAVAILABLE', ['renderOptions', 'surfaceFactory'],
        'V0.8 rendering requires fixed-canvas isolated surfaces.',
      )],
      compositionMetrics: null,
      connectorMetrics: [],
    }
  }
  const loaded = await loadRequiredAssets(plan, resolver)
  if (loaded.diagnostics.length > 0) {
    return {
      drawnAssetIds: [], diagnostics: loaded.diagnostics,
      compositionMetrics: null, connectorMetrics: [],
    }
  }

  const allSurfaces = [
    surfaces.finalOutput, surfaces.trait, surfaces.mask,
    surfaces.metricRaw, surfaces.metricClipped, surfaces.outputAlpha,
    ...Object.values(surfaces.faceAlpha), ...Object.values(surfaces.faceOccluder),
  ]
  for (const surface of allSurfaces) {
    clear(surface, surface === surfaces.finalOutput || surface === surfaces.trait || surface === surfaces.mask
      ? MASTER_SIZE
      : METRIC_SIZE)
  }
  surfaces.finalOutput.context.drawImage(loaded.sources.get(plan.bundle.structural.assetPath)!, 0, 0)
  drawMetric(surfaces.outputAlpha, surfaces.finalOutput)

  const insideRatios: Record<FaceSlot, number | null> = {
    eyes: null, mouthShape: null, oralDetail: null,
  }
  const started = new Set<FaceSlot>()
  for (const trait of plan.traits) {
    clear(surfaces.trait)
    surfaces.trait.context.drawImage(loaded.sources.get(trait.part.assetPath)!, 0, 0)
    const currentFaceSlot = faceSlot(trait.slotId)
    let rawMass = 0
    if (currentFaceSlot !== null && trait.composition.isNone !== true) {
      clear(surfaces.metricRaw, METRIC_SIZE)
      drawMetric(surfaces.metricRaw, surfaces.trait)
      rawMass = alphaMass(metricPixels(surfaces.metricRaw))
    }

    clear(surfaces.mask)
    surfaces.mask.context.drawImage(loaded.sources.get(trait.ownerRegion.assetPath)!, 0, 0)
    withSavedContext(surfaces.trait.context, () => {
      surfaces.trait.context.globalCompositeOperation = 'destination-in'
      surfaces.trait.context.drawImage(surfaces.mask.canvas, 0, 0)
    })
    if (trait.composition.expressionKind === 'protected-effect') {
      clear(surfaces.mask)
      const protection = plan.speciesRig.regions.faceProtection.assetPath
      surfaces.mask.context.drawImage(loaded.sources.get(protection)!, 0, 0)
      withSavedContext(surfaces.trait.context, () => {
        surfaces.trait.context.globalCompositeOperation = 'destination-out'
        surfaces.trait.context.drawImage(surfaces.mask.canvas, 0, 0)
      })
    }

    if (currentFaceSlot !== null && trait.composition.isNone !== true) {
      clear(surfaces.metricClipped, METRIC_SIZE)
      drawMetric(surfaces.metricClipped, surfaces.trait)
      const clippedMass = alphaMass(metricPixels(surfaces.metricClipped))
      insideRatios[currentFaceSlot] = rawMass === 0 ? 1 : clippedMass / rawMass
      drawMetric(surfaces.faceAlpha[currentFaceSlot], surfaces.trait)
      started.add(currentFaceSlot)
    }
    for (const slotId of started) {
      if (slotId !== currentFaceSlot) drawMetric(surfaces.faceOccluder[slotId], surfaces.trait)
    }
    withSavedContext(surfaces.finalOutput.context, () => {
      surfaces.finalOutput.context.globalCompositeOperation = trait.composition.blendMode
      surfaces.finalOutput.context.globalAlpha = trait.composition.opacity
      surfaces.finalOutput.context.drawImage(surfaces.trait.canvas, 0, 0)
    })
    drawMetric(surfaces.outputAlpha, surfaces.trait)
  }

  const visibleBounds = scaledBounds(metricPixels(surfaces.outputAlpha))
  const visibleRatios = Object.fromEntries(FACE_SLOTS.map(slotId => [
    slotId,
    insideRatios[slotId] === null
      ? null
      : visibleRatio(metricPixels(surfaces.faceAlpha[slotId]), metricPixels(surfaces.faceOccluder[slotId])),
  ])) as Record<FaceSlot, number | null>
  const compositionMetrics: CompositionMetrics = {
    eyesInsideRatio: insideRatios.eyes ?? 1,
    eyesVisibleRatio: visibleRatios.eyes ?? 1,
    mouthInsideRatio: insideRatios.mouthShape ?? 1,
    mouthVisibleRatio: visibleRatios.mouthShape ?? 1,
    oralDetailInsideRatio: insideRatios.oralDetail,
    oralDetailVisibleRatio: visibleRatios.oralDetail,
    visibleBounds,
  }
  const diagnostics: Diagnostic[] = []
  for (const slotId of FACE_SLOTS) {
    const ratio = insideRatios[slotId]
    if (ratio !== null && ratio < 0.99) diagnostics.push(error(
      'COMPOSITION_FACE_OUT_OF_ZONE', ['visualSlots', slotId],
      `${slotId} alpha ratio ${ratio.toFixed(3)} is below 0.99.`,
    ))
  }
  if (!boundsInsideMaster(visibleBounds)) diagnostics.push(error(
    'COMPOSITION_BOUNDS_EXCEEDED', ['visualSlots', 'bodyFrame'],
    'Visible v0.8 composition pixels exceed the canonical 2048×2048 frame.',
  ))

  withSavedContext(context, () => {
    context.scale(options.width / MASTER_SIZE, options.height / MASTER_SIZE)
    context.drawImage(surfaces.finalOutput.canvas, 0, 0)
  })
  return {
    drawnAssetIds: [plan.bundle.id, ...plan.traits.map(trait => trait.part.id)],
    diagnostics,
    compositionMetrics,
    connectorMetrics: [],
  }
}

export async function renderSpeciesRigMonster(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  try {
    return await renderSpeciesRigMonsterUnchecked(context, spec, catalog, resolver, options)
  } catch {
    return {
      drawnAssetIds: [],
      diagnostics: [error(
        'V08_RENDER_FAILED', ['speciesRigId'],
        'The canonical v0.8 frame could not be rendered or measured.',
      )],
      compositionMetrics: null,
      connectorMetrics: [],
    }
  }
}
