import { describe, expect, test } from 'vitest'
import {
  PRODUCTION_CHROMA_GATE_PROFILE,
  PRODUCTION_CHROMA_GATE_VERSION,
  evaluateChromaQuality,
  type ChromaQualityMetrics,
} from './chroma-quality-gate.js'

const validMetrics: ChromaQualityMetrics = {
  detectedKeyHex: '#00ff00',
  sampledKeyHex: '#01fe02',
  backgroundP95Delta: 0,
  borderContaminationRatio: 0,
  subjectCoverage: 0.25,
  subjectBackgroundDistanceP05: 200,
  partialAlphaPixels: 100,
  partialAlphaRatio: 0.05,
  edgeFringeP95: 0,
  edgeColorDeltaP95: 1,
  edgeNearestDistanceP95: 2,
  edgePixelsWithoutOpaqueCore: 0,
  safeBorderAlphaMax: 0,
  safeBorderForegroundPixels: 0,
}

describe('immutable production chroma quality gate', () => {
  test('derives the production decision and dynamic thresholds from metrics and image size', () => {
    const result = evaluateChromaQuality({
      gateVersion: PRODUCTION_CHROMA_GATE_VERSION,
      profile: PRODUCTION_CHROMA_GATE_PROFILE,
      imageSize: { width: 100, height: 80 },
      metrics: validMetrics,
    })

    expect(result).toEqual({
      approved: true,
      diagnostics: [],
      thresholds: {
        safeBorderPixels: 16,
        maxBackgroundP95Delta: 12,
        maxBorderContaminationRatio: 0.01,
        borderContaminationDelta: 24,
        minOpaquePixels: 40,
        minSubjectBackgroundDistanceP05: 80,
        maxSafeBorderForegroundPixels: 16,
        maxPartialAlphaRatio: 0.45,
        minPartialAlphaPixels: 16,
        maxEdgeFringeP95: 4,
        maxEdgeColorDeltaP95: 12,
        maxEdgeNearestDistanceP95: 32,
        maxEdgePixelsWithoutOpaqueCore: 0,
      },
    })
  })

  test.each([
    ['negative ratio', { borderContaminationRatio: -0.01 }],
    ['ratio over one', { partialAlphaRatio: 1.01 }],
    ['negative distance', { edgeNearestDistanceP95: -1 }],
    ['fractional pixel count', { partialAlphaPixels: 1.5 }],
    ['impossible alpha', { safeBorderAlphaMax: 256 }],
    ['impossible safe-border count', { safeBorderForegroundPixels: 999_999 }],
  ])('rejects %s instead of comparing an attacker-controlled threshold', (_label, mutation) => {
    const result = evaluateChromaQuality({
      gateVersion: PRODUCTION_CHROMA_GATE_VERSION,
      profile: PRODUCTION_CHROMA_GATE_PROFILE,
      imageSize: { width: 100, height: 80 },
      metrics: { ...validMetrics, ...mutation },
    })

    expect(result.approved).toBe(false)
    expect(result.diagnostics.map(item => item.code)).toEqual(['CHROMA_METRICS_INVALID'])
  })

  test('rejects an unknown gate version before evaluating otherwise valid metrics', () => {
    const result = evaluateChromaQuality({
      gateVersion: 'forged-gate-v999',
      profile: PRODUCTION_CHROMA_GATE_PROFILE,
      imageSize: { width: 100, height: 80 },
      metrics: validMetrics,
    })

    expect(result.approved).toBe(false)
    expect(result.diagnostics.map(item => item.code)).toEqual(['CHROMA_GATE_VERSION_UNKNOWN'])
  })
})
