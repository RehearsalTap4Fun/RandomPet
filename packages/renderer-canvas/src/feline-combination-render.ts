import { parseFelineCombinationSpec } from '../../generator-core/src/feline-combination.js'
import type { FelineCombinationOperation, FelineCombinationRenderPlan } from '@qmonster/asset-catalog'
import { composeFelineLayers, validateDecoded, type FelineCanvasLayer } from './feline-canvas-compositor.js'
import type { FelineCombinationCanvas, FelineCombinationResourceResolver, FelineCombinationRenderOptions } from './feline-canvas-compositor.js'
export type { FelineCombinationCanvas, FelineCombinationResourceResolver, FelineCombinationRenderOptions } from './feline-canvas-compositor.js'
import authoredRegistrations from './feline-combination-registration.json' with { type: 'json' }

type Registration = { scaleX: number; scaleY: number; translateX: number; translateY: number }
const registrations: Readonly<Record<string, Readonly<Registration>>> = Object.freeze(Object.fromEntries(
  Object.entries(authoredRegistrations).map(([id, value]) => [id, Object.freeze(value)]),
))

type Resource = Extract<FelineCombinationOperation, { kind: 'draw' }>['resource']

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
  finalCoordinates: Object.freeze({ scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 }),
})

// Dispatch by the selected mutation, never by a resource filename or just its slot.
const mutationTransforms: Readonly<Record<string, Readonly<Registration>>> = Object.freeze({
  'dragon-horns': FELINE_COMBINATION_TEMPLATE_V1.dragonHorns,
  antlers: FELINE_COMBINATION_TEMPLATE_V1.antlers,
  'fin-ears': FELINE_COMBINATION_TEMPLATE_V1.finEars,
  'small-wings': FELINE_COMBINATION_TEMPLATE_V1.smallWings,
  'small-lion-mane': FELINE_COMBINATION_TEMPLATE_V1.smallLionMane,
  'forked-tail-tip': FELINE_COMBINATION_TEMPLATE_V1.forkedTailTip,
  halo: FELINE_COMBINATION_TEMPLATE_V1.finalCoordinates,
  'dragon-wings': FELINE_COMBINATION_TEMPLATE_V1.finalCoordinates,
  'feathered-wings': FELINE_COMBINATION_TEMPLATE_V1.finalCoordinates,
  'frill-neck': FELINE_COMBINATION_TEMPLATE_V1.finalCoordinates,
  'flame-tail': FELINE_COMBINATION_TEMPLATE_V1.finalCoordinates,
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

/** Compose one validated legacy plan with its original immutable geometry. */
export async function renderFelineCombination(
  canvas: FelineCombinationCanvas,
  inputPlan: FelineCombinationRenderPlan,
  resolver: FelineCombinationResourceResolver,
  options: FelineCombinationRenderOptions = {},
): Promise<void> {
  return composeFelineLayers(canvas, () => {
    const plan = structuredClone(inputPlan)
    validatePlan(plan)
    return plan.operations.map((operation): FelineCanvasLayer => {
      if (operation.kind === 'clear') return {
        kind: 'clear', feather: operation.region === 'tailTip',
        polygons: operation.region === 'tailTip' ? [FELINE_COMBINATION_TEMPLATE_V1.tailTip] : FELINE_COMBINATION_TEMPLATE_V1.ears,
      }
      const mutation = operation.slot === 'body' ? undefined : plan.spec.selections[operation.slot]
      let transform = mutation ? mutationTransforms[mutation] : undefined
      if (mutation && !transform) throw new Error(`Missing mutation transform: ${mutation}.`)
      if (transform && mutation && ['fin-ears', 'small-lion-mane', 'forked-tail-tip'].includes(mutation) && operation.slot !== 'body') {
        const authored = registrations[`${plan.spec.selections.coat}-${plan.spec.selections[operation.slot]}`]
        if (!authored) throw new Error(`Missing authored registration for ${plan.spec.selections.coat}-${plan.spec.selections[operation.slot]}.`)
        transform = {
          scaleX: transform.scaleX * authored.scaleX, scaleY: transform.scaleY * authored.scaleY,
          translateX: transform.translateX + transform.scaleX * authored.translateX,
          translateY: transform.translateY + transform.scaleY * authored.translateY,
        }
      }
      return { kind: 'draw', resource: operation.resource,
        surface: ['back', 'crown', 'neck', 'tailTip'].includes(operation.slot) ? 'frame' : 'subject',
        ...(transform ? { transform } : {}),
      }
    })
  }, resolver, options)
}
