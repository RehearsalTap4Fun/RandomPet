import type { Catalog } from '@qmonster/generator-core'
import type { CompositionMetrics } from './types.js'

export const EYES_INSIDE_RATIO_MIN = 0.80

export function faceMetricThresholds(
  policy: NonNullable<Catalog['compositionPolicy']>,
  slotId: string,
): { inside: number; visible: number } | null {
  if (slotId === 'eyes') return {
    inside: EYES_INSIDE_RATIO_MIN,
    visible: policy.faceVisibleRatio,
  }
  if (slotId === 'mouthShape') return {
    inside: policy.faceInsideRatio,
    visible: policy.faceVisibleRatio,
  }
  return null
}

export function boundsInsideFrame(
  bounds: NonNullable<CompositionMetrics['visibleBounds']>,
  frame: NonNullable<Catalog['compositionPolicy']>['frameBounds'],
): boolean {
  return bounds.x >= frame.x
    && bounds.y >= frame.y
    && bounds.x + bounds.width <= frame.x + frame.width
    && bounds.y + bounds.height <= frame.y + frame.height
}

export function compositionMetricsMeetThresholds(
  metrics: CompositionMetrics,
  policy: NonNullable<Catalog['compositionPolicy']>,
): boolean {
  const eyes = faceMetricThresholds(policy, 'eyes')!
  const mouth = faceMetricThresholds(policy, 'mouthShape')!
  return metrics.eyesInsideRatio >= eyes.inside
    && metrics.eyesVisibleRatio >= eyes.visible
    && metrics.mouthInsideRatio >= mouth.inside
    && metrics.mouthVisibleRatio >= mouth.visible
    && metrics.visibleBounds !== null
    && metrics.visibleBounds.width > 0
    && metrics.visibleBounds.height > 0
    && boundsInsideFrame(metrics.visibleBounds, policy.frameBounds)
}
