import { z } from 'zod'
import { canonicalJson } from './canonical-json.js'

export const backdropIdSchema = z.enum(['none', 'doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'])
export type BackdropId = z.infer<typeof backdropIdSchema>

export const pixelSceneStateV1Schema = z.strictObject({
  schemaVersion: z.literal('pixel-scene-state-v1'),
  backdrop: backdropIdSchema,
})
export type PixelSceneStateV1 = z.infer<typeof pixelSceneStateV1Schema>

export const requirePixelSceneStateV1 = (input: unknown): PixelSceneStateV1 => pixelSceneStateV1Schema.parse(input)

export function migratePixelSceneStateV1(input: unknown): PixelSceneStateV1 {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid scene state.')
  if (Object.hasOwn(input, 'backdrop')) {
    return requirePixelSceneStateV1({
      schemaVersion: 'pixel-scene-state-v1',
      backdrop: (input as Record<string, unknown>).backdrop,
    })
  }
  return { schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' }
}

export const pixelSceneStateKey = (state: PixelSceneStateV1): string =>
  canonicalJson(['pixel-scene-state-v1', requirePixelSceneStateV1(state).backdrop])
