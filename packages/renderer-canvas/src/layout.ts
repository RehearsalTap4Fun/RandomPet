import type { ApprovedTransform, Diagnostic } from '@qmonster/generator-core'
import type { PlacementResult } from './types.js'

interface Point {
  x: number
  y: number
}

const IDENTITY_TRANSFORM: ApprovedTransform = { scale: 1, mirrorX: false }

function sameTransform(left: ApprovedTransform, right: ApprovedTransform): boolean {
  return left.scale === right.scale && left.mirrorX === right.mirrorX
}

function invalidPreset(transform: ApprovedTransform): Diagnostic {
  return {
    severity: 'error',
    code: 'RENDER_PRESET_INVALID',
    path: ['transform'],
    message: `Transform scale=${transform.scale}, mirrorX=${transform.mirrorX} is not approved for this part.`,
  }
}

export function resolvePlacement(
  socket: Point,
  origin: Point,
  transform: ApprovedTransform,
  approvedTransforms: readonly ApprovedTransform[] = [],
): PlacementResult {
  const approved = approvedTransforms.length === 0
    ? sameTransform(transform, IDENTITY_TRANSFORM)
    : approvedTransforms.some(preset => sameTransform(preset, transform))
  if (!approved) return { ok: false, diagnostic: invalidPreset(transform) }

  const scaleX = transform.mirrorX ? -transform.scale : transform.scale
  return {
    ok: true,
    value: {
      x: socket.x - origin.x * scaleX,
      y: socket.y - origin.y * transform.scale,
      scaleX,
      scaleY: transform.scale,
    },
  }
}
