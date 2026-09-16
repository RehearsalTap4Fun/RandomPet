import type { FelineCombinationResource } from '@qmonster/asset-catalog'

export type FelineCombinationCanvas = HTMLCanvasElement | OffscreenCanvas
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type FelineCombinationResourceResolver = (resource: Readonly<FelineCombinationResource>) => Promise<CanvasImageSource>
export interface FelineCombinationRenderOptions {
  createCanvas?: (width: number, height: number) => FelineCombinationCanvas
}
export type Registration = Readonly<{ scaleX: number; scaleY: number; translateX: number; translateY: number }>
export type Polygon = readonly (readonly [number, number])[]
export type FelineCanvasLayer =
  | { kind: 'clear'; polygons: readonly Polygon[]; feather: boolean }
  | { kind: 'draw'; resource: Readonly<FelineCombinationResource>; surface: 'frame' | 'subject'; transform?: Registration;
      occlusion?: { polygons: readonly Polygon[]; feather: number } }

function context(canvas: FelineCombinationCanvas): Context {
  const result = canvas.getContext('2d') as Context | null
  if (!result) throw new Error('Canvas 2D context is unavailable.')
  return result
}
function reset(canvas: FelineCombinationCanvas): void { canvas.width = 1254; canvas.height = 1254 }
function defaultCanvas(width: number, height: number): FelineCombinationCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height })
  throw new Error('No canvas factory is available.')
}
export function validateDecoded(source: CanvasImageSource, resource: Readonly<FelineCombinationResource>): void {
  if (!source || typeof source !== 'object') throw new Error(`Failed to decode feline resource ${resource.id}.`)
  const dimensions = source as unknown as Record<string, unknown>
  const width = dimensions.naturalWidth ?? dimensions.videoWidth ?? dimensions.displayWidth ?? dimensions.width
  const height = dimensions.naturalHeight ?? dimensions.videoHeight ?? dimensions.displayHeight ?? dimensions.height
  if (dimensions.complete === false || width !== resource.width || height !== resource.height) {
    throw new Error(`Decoded dimensions mismatch for feline resource ${resource.id}: ${String(width)}x${String(height)}.`)
  }
}

/** Internal composition engine. Each entry point owns validation and geometry. */
export async function composeFelineLayers(
  canvas: FelineCombinationCanvas, prepare: () => readonly FelineCanvasLayer[],
  resolver: FelineCombinationResourceResolver, options: FelineCombinationRenderOptions = {},
): Promise<void> {
  reset(canvas)
  const acquired = new Set<CanvasImageSource>()
  try {
    // Preparation and capture happen synchronously before the first resource load.
    const layers = structuredClone(prepare())
    const createCanvas = options.createCanvas ?? defaultCanvas
    const frame = createCanvas(1254, 1254), subject = createCanvas(1254, 1254)
    if (frame === subject || frame === canvas || subject === canvas) throw new Error('Canvas factory must return distinct isolated surfaces.')
    reset(frame); reset(subject)
    const frameContext = context(frame), subjectContext = context(subject)
    for (const layer of layers) {
      if (layer.kind === 'clear') {
        subjectContext.save()
        subjectContext.globalCompositeOperation = 'destination-out'
        if (layer.feather) subjectContext.filter = 'blur(2px)'
        subjectContext.fillStyle = '#000'
        for (const polygon of layer.polygons) {
          subjectContext.beginPath(); subjectContext.moveTo(...polygon[0]!)
          for (const vertex of polygon.slice(1)) subjectContext.lineTo(...vertex)
          subjectContext.closePath(); subjectContext.fill()
        }
        subjectContext.restore()
        continue
      }
      const source = await resolver(layer.resource)
      if (source) acquired.add(source)
      validateDecoded(source, layer.resource)
      const target = layer.surface === 'frame' ? frameContext : subjectContext
      let overlay: FelineCombinationCanvas | undefined
      if (layer.occlusion) {
        overlay = createCanvas(1254, 1254)
        if (overlay === canvas || overlay === frame || overlay === subject) throw new Error('Canvas factory must return distinct isolated surfaces.')
        reset(overlay)
      }
      const paint = overlay ? context(overlay) : target
      paint.save()
      if (layer.transform) {
        const t = layer.transform
        paint.setTransform(t.scaleX, 0, 0, t.scaleY, t.translateX, t.translateY)
      }
      paint.drawImage(source, 0, 0); paint.restore()
      if (overlay && layer.occlusion) {
        // Occlusion is authored in canvas coordinates and removes only this
        // accessory, preserving the face and the layers already underneath it.
        paint.save(); paint.globalCompositeOperation = 'destination-out'
        if (layer.occlusion.feather) paint.filter = `blur(${layer.occlusion.feather}px)`
        paint.fillStyle = '#000'
        for (const polygon of layer.occlusion.polygons) {
          paint.beginPath(); paint.moveTo(...polygon[0]!)
          for (const vertex of polygon.slice(1)) paint.lineTo(...vertex)
          paint.closePath(); paint.fill()
        }
        paint.restore(); target.drawImage(overlay, 0, 0)
      }
    }
    frameContext.drawImage(subject, 0, 0)
    context(canvas).drawImage(frame, 0, 0)
  } catch (error) { reset(canvas); throw error }
  finally {
    for (const source of acquired) (source as CanvasImageSource & { close?: () => void }).close?.()
  }
}
