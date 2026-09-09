import { isV09MaterialRegistry, type MaterialOperationV1, type V09SurfaceSlotId } from '@qmonster/generator-core'
import { z } from 'zod'

export class V09RenderError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) { super(message, options); this.name = 'V09RenderError' }
}

export const V09_SURFACE_ORDER = ['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface'] as const
export const V09_RGBA_LENGTH = 2048 * 2048 * 4
const pngSchema = z.strictObject({ resourceId: z.string().regex(/^sha256:[a-f0-9]{64}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), mediaType: z.literal('image/png'), width: z.literal(2048), height: z.literal(2048) }).refine(ref => ref.resourceId === `sha256:${ref.sha256}`)
const operationSchema = z.strictObject({
  schemaVersion: z.literal('qmonster-material-v1'), ownerMaterialId: z.string().refine(id => id.trim().length > 0),
  colorMap: pngSchema.optional(), colorLut: z.array(z.number().int().min(0).max(255)).length(1024).optional(),
  alphaPolicy: z.literal('preserve-skeleton-alpha'), blendMode: z.enum(['replace-color', 'multiply', 'overlay']),
}).refine(operation => operation.colorMap !== undefined || operation.colorLut !== undefined)

export function parseV09MaterialOperation(value: unknown): MaterialOperationV1 {
  const parsed = operationSchema.safeParse(value)
  if (!parsed.success) throw new V09RenderError('SURFACE_OWNER_VIOLATION', 'Material operations require strict RGBA8 sources and preserve-skeleton-alpha.')
  return parsed.data as MaterialOperationV1
}

export interface V09DecodedMaterialOperation {
  slotId: V09SurfaceSlotId
  operation: MaterialOperationV1
  colorMap?: Uint8Array | Uint8ClampedArray | undefined
}
export interface V09MaterialInput {
  neutralMaster: Uint8Array | Uint8ClampedArray
  materialMap: Uint8Array | Uint8ClampedArray
  materialRegistry: Record<string, number>
  operations: readonly V09DecodedMaterialOperation[]
}

export function requireV09Pixels(value: unknown, code: string): asserts value is Uint8Array | Uint8ClampedArray {
  if (!(value instanceof Uint8Array || value instanceof Uint8ClampedArray) || value.length !== V09_RGBA_LENGTH) throw new V09RenderError(code, 'Expected exactly 2048x2048 straight RGBA8 bytes.')
}

// All numerators are nonnegative integers, well below JS integer precision limits.
const round255 = (value: number) => Math.floor((value + 127) / 255)
const byte = (value: number) => Math.max(0, Math.min(255, value))

/** Deterministic whole-skeleton materialization; never mutates any input buffer. */
export function applyV09MaterialOperations(input: V09MaterialInput): Uint8Array {
  const code = 'SURFACE_OWNER_VIOLATION'
  const fail = (message: string): never => { throw new V09RenderError(code, message) }
  requireV09Pixels(input.neutralMaster, code); requireV09Pixels(input.materialMap, code)
  if (!isV09MaterialRegistry(input.materialRegistry)) fail('Material registry must contain unique integer indices 0..255.')
  if (input.operations.length !== 6 || input.operations.some((entry, index) => entry.slotId !== V09_SURFACE_ORDER[index])) fail('Material operations must follow all six frozen surface slots.')
  const { neutralMaster: neutral, materialMap: map } = input
  for (let i = 0; i < map.length; i += 4) {
    if (map[i + 1] !== 0 || map[i + 2] !== 0 || (map[i + 3] !== 0 && map[i + 3] !== 255)
      || (neutral[i + 3]! > 0 ? map[i + 3] !== 255 : map[i + 3] !== 0)) fail('Material map channels or skeleton coverage are invalid.')
  }
  const output = new Uint8Array(neutral)
  for (const entry of input.operations) {
    const operation = parseV09MaterialOperation(entry.operation)
    if (!Object.hasOwn(input.materialRegistry, operation.ownerMaterialId)) fail('Operation owner is not registered.')
    const owner = input.materialRegistry[operation.ownerMaterialId]!
    const colorMap = entry.colorMap; const lut = operation.colorLut
    if (operation.colorMap !== undefined) requireV09Pixels(colorMap, code)
    else if (colorMap !== undefined) fail('Undeclared colorMap pixels are forbidden.')
    for (let i = 0; i < output.length; i += 4) {
      const owned = map[i] === owner && map[i + 3] === 255
      if (!owned) {
        if (colorMap !== undefined && colorMap[i + 3] !== 0) fail('ColorMap writes outside its exact material owner.')
        continue
      }
      const sourceOffset = lut === undefined ? i : (colorMap === undefined ? output[i]! : colorMap[i]!) * 4
      const source = lut ?? colorMap!
      const alpha = lut !== undefined && colorMap !== undefined ? round255(lut[sourceOffset + 3]! * colorMap[i + 3]!) : source[sourceOffset + 3]!
      for (let channel = 0; channel < 3; channel += 1) {
        const base = output[i + channel]!; const color = source[sourceOffset + channel]!
        const target = operation.blendMode === 'replace-color' ? color
          : operation.blendMode === 'multiply' ? round255(base * color)
            : base < 128 ? round255(2 * base * color) : 255 - round255(2 * (255 - base) * (255 - color))
        output[i + channel] = byte(round255(byte(target) * alpha + base * (255 - alpha)))
      }
    }
  }
  return output
}
