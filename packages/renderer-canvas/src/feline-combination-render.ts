import { parseFelineCombinationSpec } from '@qmonster/generator-core'
import type { FelineCombinationOperation, FelineCombinationRenderPlan } from '@qmonster/asset-catalog'
import authoredRegistrations from './feline-combination-registration.json' with { type: 'json' }

type Registration = { scaleX: number; scaleY: number; translateX: number; translateY: number }
const registrations: Readonly<Record<string, Readonly<Registration>>> = Object.freeze(Object.fromEntries(
  Object.entries(authoredRegistrations).map(([id, value]) => [id, Object.freeze(value)]),
))

export type FelineCombinationCanvas = HTMLCanvasElement | OffscreenCanvas
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Resource = Extract<FelineCombinationOperation, { kind: 'draw' }>['resource']
/** Return fresh decoded sources. The renderer closes close()-capable sources after use. */
export type FelineCombinationResourceResolver = (resource: Resource) => Promise<CanvasImageSource>
export interface FelineCombinationRenderOptions {
  createCanvas?: (width: number, height: number) => FelineCombinationCanvas
}

const point = (x: number, y: number) => Object.freeze([x, y] as const)
/** Pilot geometry only: these registrations and removal regions have not passed art review. */
export const FELINE_COMBINATION_TEMPLATE_V1 = Object.freeze({
  version: 'feline-sit-v1', width: 1254, height: 1254,
  review: 'pending' as const,
  ears: Object.freeze([
    Object.freeze([point(210, 0), point(490, 0), point(470, 190), point(220, 290)]),
    Object.freeze([point(625, 0), point(940, 0), point(900, 410), point(660, 200)]),
  ]),
  // Remove the exposed tail all the way down to the haunch, not through its middle.
  tailTip: Object.freeze([
    point(895, 350), point(1254, 350), point(1254, 1160), point(930, 1160),
    point(948, 1060), point(957, 940), point(960, 830), point(937, 730), point(895, 690),
  ]),
  dragonHorns: Object.freeze({ scaleX: 0.68, scaleY: 0.68, translateX: 137, translateY: -24 }),
  finEars: Object.freeze({ scaleX: 0.63, scaleY: 0.55, translateX: 150, translateY: 20 }),
  antlers: Object.freeze({ scaleX: 0.39, scaleY: 0.39, translateX: 310, translateY: -90 }),
  smallWings: Object.freeze({ scaleX: 0.8, scaleY: 0.75, translateX: 75, translateY: 200 }),
  smallLionMane: Object.freeze({ scaleX: 0.72, scaleY: 0.38, translateX: 60, translateY: 470 }),
  forkedTailTip: Object.freeze({ scaleX: 0.69, scaleY: 0.875, translateX: 376, translateY: 97 }),
})

function exactKeys(value: object, keys: string): boolean {
  return Object.keys(value).sort().join(',') === keys
}

function validatePlan(plan: FelineCombinationRenderPlan): void {
  if (!plan || !exactKeys(plan, 'canvas,catalogVersion,operations,schemaVersion,spec,templateVersion')
    || plan.schemaVersion !== 'feline-combination-render-plan-v1'
    || plan.templateVersion !== 'feline-sit-v1' || plan.catalogVersion !== '0.10.0-candidate.1'
    || plan.canvas?.width !== 1254 || plan.canvas.height !== 1254 || !exactKeys(plan.canvas, 'height,width')) {
    throw new Error('Unsupported feline combination render plan or template.')
  }
  const parsed = parseFelineCombinationSpec(plan.spec)
  if (!parsed.ok || parsed.value.catalogVersion !== plan.catalogVersion) throw new Error('Invalid feline combination spec or version.')
  const selections = parsed.value.selections
  const expected: string[] = []
  for (const slot of ['back', 'crown', 'body', 'ears', 'tailTip', 'neck'] as const) {
    if (slot !== 'body' && selections[slot] === 'none') continue
    if (slot === 'ears' || slot === 'tailTip') expected.push(`clear:${slot}`)
    expected.push(`draw:${slot}`)
  }
  if (!Array.isArray(plan.operations) || plan.operations.length !== expected.length) throw new Error('Invalid feline operation coverage.')
  for (const [index, operation] of plan.operations.entries()) {
    if (!operation || (operation.kind !== 'draw' && operation.kind !== 'clear')) throw new Error('Unknown feline operation.')
    const name = operation.kind === 'clear' ? operation.region : operation.slot
    if (`${operation.kind}:${name}` !== expected[index]
      || !exactKeys(operation, operation.kind === 'clear' ? 'kind,region' : 'kind,resource,slot')) {
      throw new Error('Invalid feline operation order or caller-defined geometry.')
    }
    if (operation.kind === 'draw') {
      const resource = operation.resource
      if (!resource || resource.width !== 1254 || resource.height !== 1254
        || resource.mediaType !== 'image/png' || resource.hasAlpha !== true
        || !/^[a-f0-9]{64}$/.test(resource.sha256)) throw new Error('Invalid feline PNG resource metadata.')
    }
  }
}

function context(canvas: FelineCombinationCanvas): Context {
  const result = canvas.getContext('2d') as Context | null
  if (!result) throw new Error('Canvas 2D context is unavailable.')
  return result
}

function reset(canvas: FelineCombinationCanvas): void {
  // Reassigning dimensions also removes prior clipping, transforms and compositing state.
  canvas.width = 1254
  canvas.height = 1254
}

function defaultCanvas(width: number, height: number): FelineCombinationCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height })
  throw new Error('No canvas factory is available.')
}

function validateDecoded(source: CanvasImageSource, resource: Resource): void {
  if (!source || typeof source !== 'object') throw new Error(`Failed to decode feline resource ${resource.id}.`)
  const dimensions = source as unknown as Record<string, unknown>
  // Natural dimensions take precedence over HTML image display width/height.
  const width = dimensions.naturalWidth ?? dimensions.videoWidth ?? dimensions.displayWidth ?? dimensions.width
  const height = dimensions.naturalHeight ?? dimensions.videoHeight ?? dimensions.displayHeight ?? dimensions.height
  if (dimensions.complete === false || width !== resource.width || height !== resource.height) {
    throw new Error(`Decoded dimensions mismatch for feline resource ${resource.id}: ${String(width)}x${String(height)}.`)
  }
}

/** Browser loader. URL mapping changes delivery only; the declared SHA-256 pins the bytes. */
export function createFelineCombinationResourceResolver(
  resolveUrl: (resource: Resource) => string = resource => resource.path,
): FelineCombinationResourceResolver {
  return async resource => {
    const response = await fetch(resolveUrl(resource))
    if (!response.ok) throw new Error(`HTTP ${response.status} loading feline resource ${resource.id}.`)
    const bytes = await response.arrayBuffer()
    const signature = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength))
    if (signature.length !== 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => signature[index] !== value)) {
      throw new Error(`Invalid PNG signature for feline resource ${resource.id}.`)
    }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
    if (digest !== resource.sha256) throw new Error(`SHA-256 mismatch for feline resource ${resource.id}.`)
    const header = new Uint8Array(bytes)
    if (header.length < 33 || ![4, 6].includes(header[25]!)) throw new Error(`PNG alpha channel missing for feline resource ${resource.id}.`)
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    } catch (cause) {
      throw new Error(`Failed to decode PNG resource ${resource.id}.`, { cause })
    }
    try {
      validateDecoded(bitmap, resource)
      return bitmap
    } catch (error) {
      bitmap.close()
      throw error
    }
  }
}

function clearSubject(ctx: Context, region: 'ears' | 'tailTip'): void {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  // A tiny fixed feather preserves a fur edge at the haunch occlusion boundary.
  if (region === 'tailTip') ctx.filter = 'blur(2px)'
  ctx.fillStyle = '#000'
  for (const polygon of region === 'tailTip' ? [FELINE_COMBINATION_TEMPLATE_V1.tailTip] : FELINE_COMBINATION_TEMPLATE_V1.ears) {
    ctx.beginPath()
    ctx.moveTo(...polygon[0]!)
    for (const vertex of polygon.slice(1)) ctx.lineTo(...vertex)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** Compose one validated candidate plan. Failures leave the output transparent, never partly drawn. */
export async function renderFelineCombination(
  canvas: FelineCombinationCanvas,
  inputPlan: FelineCombinationRenderPlan,
  resolver: FelineCombinationResourceResolver,
  options: FelineCombinationRenderOptions = {},
): Promise<void> {
  reset(canvas)
  const acquired = new Set<CanvasImageSource>()
  try {
    // Detach before the first async boundary even if a caller supplies an unfrozen plan.
    const plan = structuredClone(inputPlan)
    validatePlan(plan)
    const createCanvas = options.createCanvas ?? defaultCanvas
    const frame = createCanvas(1254, 1254)
    const subject = createCanvas(1254, 1254)
    if (frame === subject || frame === canvas || subject === canvas) throw new Error('Canvas factory must return distinct isolated surfaces.')
    reset(frame); reset(subject)
    const frameContext = context(frame)
    const subjectContext = context(subject)
    for (const operation of plan.operations) {
      if (operation.kind === 'clear') {
        clearSubject(subjectContext, operation.region)
        continue
      }
      const image = await resolver(operation.resource)
      if (image) acquired.add(image)
      validateDecoded(image, operation.resource)
      // The intact face/neck fur occludes the mane roots; no hard U-shaped muzzle seam.
      const target = operation.slot === 'back' || operation.slot === 'crown' || operation.slot === 'neck' || operation.slot === 'tailTip' ? frameContext : subjectContext
      let transform: Readonly<Registration> | undefined = operation.slot === 'crown' && plan.spec.selections.crown === 'dragon-horns'
        ? FELINE_COMBINATION_TEMPLATE_V1.dragonHorns
        : operation.slot === 'crown' ? FELINE_COMBINATION_TEMPLATE_V1.antlers
          : operation.slot === 'ears' ? FELINE_COMBINATION_TEMPLATE_V1.finEars
            : operation.slot === 'back' ? FELINE_COMBINATION_TEMPLATE_V1.smallWings
              : operation.slot === 'neck' ? FELINE_COMBINATION_TEMPLATE_V1.smallLionMane
                : operation.slot === 'tailTip' ? FELINE_COMBINATION_TEMPLATE_V1.forkedTailTip : undefined
      if (transform && (operation.slot === 'ears' || operation.slot === 'neck' || operation.slot === 'tailTip')) {
        const authored = registrations[`${plan.spec.selections.coat}-${plan.spec.selections[operation.slot]}`]
        if (!authored) throw new Error(`Missing authored registration for ${plan.spec.selections.coat}-${plan.spec.selections[operation.slot]}.`)
        transform = {
          scaleX: transform.scaleX * authored.scaleX, scaleY: transform.scaleY * authored.scaleY,
          translateX: transform.translateX + transform.scaleX * authored.translateX,
          translateY: transform.translateY + transform.scaleY * authored.translateY,
        }
      }
      // The replacement is a continuous whole tail. Its root is hidden by the body;
      // no crossfade can repair mismatched mid-shaft silhouettes or coat markings.
      target.save()
      if (transform) target.setTransform(transform.scaleX, 0, 0, transform.scaleY, transform.translateX, transform.translateY)
      target.drawImage(image, 0, 0)
      target.restore()
    }
    frameContext.drawImage(subject, 0, 0)
    context(canvas).drawImage(frame, 0, 0)
  } catch (error) {
    reset(canvas)
    throw error
  } finally {
    for (const image of acquired) {
      const disposable = image as CanvasImageSource & { close?: () => void }
      disposable.close?.()
    }
  }
}
