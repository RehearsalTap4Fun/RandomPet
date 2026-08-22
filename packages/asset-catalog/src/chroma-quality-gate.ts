export const PRODUCTION_CHROMA_GATE_VERSION = 'qmonster-chroma-quality-v3' as const

export interface ChromaGateProfile {
  safeBorderPixels: number
  maxBackgroundP95Delta: number
  maxBorderContaminationRatio: number
  borderContaminationDelta: number
  minOpaquePixelRatio: number
  minOpaquePixelsFloor: number
  minSubjectBackgroundDistanceP05: number
  maxSafeBorderForegroundRatio: number
  maxSafeBorderForegroundPixelsFloor: number
  maxPartialAlphaRatio: number
  minPartialAlphaOpaqueRatio: number
  minPartialAlphaPixelsFloor: number
  maxEdgeFringeP95: number
  maxEdgeColorDeltaP95: number
  maxEdgeNearestDistanceP95: number
  maxEdgePixelsWithoutOpaqueCore: number
}

export const PRODUCTION_CHROMA_GATE_PROFILE: Readonly<ChromaGateProfile> = Object.freeze({
  safeBorderPixels: 16,
  maxBackgroundP95Delta: 12,
  maxBorderContaminationRatio: 0.01,
  borderContaminationDelta: 24,
  minOpaquePixelRatio: 0.005,
  minOpaquePixelsFloor: 32,
  minSubjectBackgroundDistanceP05: 80,
  maxSafeBorderForegroundRatio: 0.0001,
  maxSafeBorderForegroundPixelsFloor: 16,
  maxPartialAlphaRatio: 0.45,
  minPartialAlphaOpaqueRatio: 0.001,
  minPartialAlphaPixelsFloor: 16,
  maxEdgeFringeP95: 4,
  maxEdgeColorDeltaP95: 12,
  maxEdgeNearestDistanceP95: 32,
  maxEdgePixelsWithoutOpaqueCore: 0,
})

export function chromaGateProfileForSafeBorder(safeBorderPixels: number): Readonly<ChromaGateProfile> {
  return Object.freeze({ ...PRODUCTION_CHROMA_GATE_PROFILE, safeBorderPixels })
}

export interface ChromaQualityMetrics {
  detectedKeyHex: string
  sampledKeyHex: string
  backgroundP95Delta: number
  borderContaminationRatio: number
  subjectCoverage: number
  subjectBackgroundDistanceP05: number
  partialAlphaPixels: number
  partialAlphaRatio: number
  edgeFringeP95: number
  edgeColorDeltaP95: number
  edgeNearestDistanceP95: number
  edgePixelsWithoutOpaqueCore: number
  safeBorderAlphaMax: number
  safeBorderForegroundPixels: number
}

export interface ChromaQualityThresholds {
  safeBorderPixels: number
  maxBackgroundP95Delta: number
  maxBorderContaminationRatio: number
  borderContaminationDelta: number
  minOpaquePixels: number
  minSubjectBackgroundDistanceP05: number
  maxSafeBorderForegroundPixels: number
  maxPartialAlphaRatio: number
  minPartialAlphaPixels: number
  maxEdgeFringeP95: number
  maxEdgeColorDeltaP95: number
  maxEdgeNearestDistanceP95: number
  maxEdgePixelsWithoutOpaqueCore: number
}

export interface ChromaGateDiagnostic {
  severity: 'error'
  code:
    | 'CHROMA_GATE_VERSION_UNKNOWN'
    | 'CHROMA_METRICS_INVALID'
    | 'CHROMA_KEY_INVALID'
    | 'CHROMA_BACKGROUND_NONUNIFORM'
    | 'CHROMA_BACKGROUND_CONTAMINATED'
    | 'CHROMA_SUBJECT_SIMILARITY'
    | 'CHROMA_SAFE_BORDER_CLIPPED'
    | 'CHROMA_EDGE_NO_CORE'
    | 'CHROMA_EDGE_DEGRADED'
  message: string
}

export interface ChromaGateEvaluation {
  approved: boolean
  diagnostics: ChromaGateDiagnostic[]
  thresholds: ChromaQualityThresholds
}

function diagnostic(code: ChromaGateDiagnostic['code'], message: string): ChromaGateDiagnostic {
  return { severity: 'error', code, message }
}

function keyIsSaturatedBinary(value: string): boolean {
  if (!/^#[a-f0-9]{6}$/u.test(value)) return false
  const channels = [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)]
  return channels.every(channel => channel === '00' || channel === 'ff')
    && channels.includes('00')
    && channels.includes('ff')
}

function validMetrics(
  metrics: ChromaQualityMetrics,
  pixelCount: number,
  borderPixelCount: number,
  width: number,
  height: number,
): boolean {
  const colorDistanceMax = Math.sqrt(3 * 255 ** 2)
  const finiteRange = (value: number, minimum: number, maximum: number): boolean => (
    Number.isFinite(value) && value >= minimum && value <= maximum
  )
  const integerRange = (value: number, minimum: number, maximum: number): boolean => (
    Number.isInteger(value) && value >= minimum && value <= maximum
  )
  return /^#[a-f0-9]{6}$/u.test(metrics.detectedKeyHex)
    && /^#[a-f0-9]{6}$/u.test(metrics.sampledKeyHex)
    && finiteRange(metrics.backgroundP95Delta, 0, colorDistanceMax)
    && finiteRange(metrics.borderContaminationRatio, 0, 1)
    && finiteRange(metrics.subjectCoverage, 0, 1)
    && finiteRange(metrics.subjectBackgroundDistanceP05, 0, colorDistanceMax)
    && integerRange(metrics.partialAlphaPixels, 0, pixelCount)
    && finiteRange(metrics.partialAlphaRatio, 0, 1)
    && finiteRange(metrics.edgeFringeP95, 0, 255)
    && finiteRange(metrics.edgeColorDeltaP95, 0, colorDistanceMax)
    && finiteRange(metrics.edgeNearestDistanceP95, 0, Math.hypot(width, height))
    && integerRange(metrics.edgePixelsWithoutOpaqueCore, 0, metrics.partialAlphaPixels)
    && integerRange(metrics.safeBorderAlphaMax, 0, 255)
    && integerRange(metrics.safeBorderForegroundPixels, 0, borderPixelCount)
}

export function evaluateChromaQuality(input: {
  gateVersion: string
  profile: Readonly<ChromaGateProfile>
  imageSize: { width: number; height: number }
  metrics: ChromaQualityMetrics
}): ChromaGateEvaluation {
  const width = input.imageSize.width
  const height = input.imageSize.height
  const validSize = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
  const safeWidth = validSize ? width : 1
  const safeHeight = validSize ? height : 1
  const border = Math.max(1, Math.min(
    Math.floor(Math.min(safeWidth, safeHeight) / 4),
    Math.floor(input.profile.safeBorderPixels),
  ))
  const pixelCount = safeWidth * safeHeight
  const borderPixelCount = pixelCount - Math.max(0, safeWidth - border * 2) * Math.max(0, safeHeight - border * 2)
  const opaquePixels = Math.round(input.metrics.subjectCoverage * pixelCount)
  const thresholds: ChromaQualityThresholds = {
    safeBorderPixels: border,
    maxBackgroundP95Delta: input.profile.maxBackgroundP95Delta,
    maxBorderContaminationRatio: input.profile.maxBorderContaminationRatio,
    borderContaminationDelta: input.profile.borderContaminationDelta,
    minOpaquePixels: Math.max(input.profile.minOpaquePixelsFloor, Math.floor(pixelCount * input.profile.minOpaquePixelRatio)),
    minSubjectBackgroundDistanceP05: input.profile.minSubjectBackgroundDistanceP05,
    maxSafeBorderForegroundPixels: Math.max(
      input.profile.maxSafeBorderForegroundPixelsFloor,
      Math.floor(borderPixelCount * input.profile.maxSafeBorderForegroundRatio),
    ),
    maxPartialAlphaRatio: input.profile.maxPartialAlphaRatio,
    minPartialAlphaPixels: Math.max(
      input.profile.minPartialAlphaPixelsFloor,
      Math.floor(opaquePixels * input.profile.minPartialAlphaOpaqueRatio),
    ),
    maxEdgeFringeP95: input.profile.maxEdgeFringeP95,
    maxEdgeColorDeltaP95: input.profile.maxEdgeColorDeltaP95,
    maxEdgeNearestDistanceP95: input.profile.maxEdgeNearestDistanceP95,
    maxEdgePixelsWithoutOpaqueCore: input.profile.maxEdgePixelsWithoutOpaqueCore,
  }
  if (input.gateVersion !== PRODUCTION_CHROMA_GATE_VERSION) {
    const diagnostics = [diagnostic('CHROMA_GATE_VERSION_UNKNOWN', `Unknown chroma gate version ${input.gateVersion}.`)]
    return { approved: false, diagnostics, thresholds }
  }
  if (!validSize || !validMetrics(input.metrics, pixelCount, borderPixelCount, safeWidth, safeHeight)) {
    const diagnostics = [diagnostic('CHROMA_METRICS_INVALID', 'Chroma metrics contain an impossible, non-finite, negative, fractional-count, or out-of-domain value.')]
    return { approved: false, diagnostics, thresholds }
  }

  const diagnostics: ChromaGateDiagnostic[] = []
  const metrics = input.metrics
  if (!keyIsSaturatedBinary(metrics.detectedKeyHex)) {
    diagnostics.push(diagnostic(
      'CHROMA_KEY_INVALID',
      `Detected border color ${metrics.detectedKeyHex} is not a saturated binary chroma key.`,
    ))
  }
  if (metrics.backgroundP95Delta > thresholds.maxBackgroundP95Delta) {
    diagnostics.push(diagnostic(
      'CHROMA_BACKGROUND_NONUNIFORM',
      `Safe-border chroma p95 delta ${metrics.backgroundP95Delta.toFixed(2)} exceeds ${thresholds.maxBackgroundP95Delta}.`,
    ))
  }
  if (metrics.borderContaminationRatio > thresholds.maxBorderContaminationRatio) {
    diagnostics.push(diagnostic(
      'CHROMA_BACKGROUND_CONTAMINATED',
      `Safe-border contamination ${(metrics.borderContaminationRatio * 100).toFixed(2)}% exceeds ${thresholds.maxBorderContaminationRatio * 100}%.`,
    ))
  }
  if (opaquePixels < thresholds.minOpaquePixels || metrics.subjectBackgroundDistanceP05 < thresholds.minSubjectBackgroundDistanceP05) {
    diagnostics.push(diagnostic(
      'CHROMA_SUBJECT_SIMILARITY',
      `Opaque subject coverage ${(metrics.subjectCoverage * 100).toFixed(2)}% and key-distance p05 ${metrics.subjectBackgroundDistanceP05.toFixed(2)} do not safely separate foreground from chroma.`,
    ))
  }
  if (metrics.safeBorderForegroundPixels > thresholds.maxSafeBorderForegroundPixels) {
    diagnostics.push(diagnostic(
      'CHROMA_SAFE_BORDER_CLIPPED',
      `${metrics.safeBorderForegroundPixels} foreground pixels (max alpha ${metrics.safeBorderAlphaMax}/255) enter the required ${thresholds.safeBorderPixels}px safe border.`,
    ))
  }
  if (metrics.edgePixelsWithoutOpaqueCore > thresholds.maxEdgePixelsWithoutOpaqueCore) {
    diagnostics.push(diagnostic(
      'CHROMA_EDGE_NO_CORE',
      `${metrics.edgePixelsWithoutOpaqueCore} partial-alpha edge pixels have no opaque inward color core.`,
    ))
  }
  if (
    metrics.partialAlphaPixels < thresholds.minPartialAlphaPixels
    || metrics.partialAlphaRatio > thresholds.maxPartialAlphaRatio
    || metrics.edgeFringeP95 > thresholds.maxEdgeFringeP95
    || metrics.edgeColorDeltaP95 > thresholds.maxEdgeColorDeltaP95
    || metrics.edgeNearestDistanceP95 > thresholds.maxEdgeNearestDistanceP95
  ) {
    diagnostics.push(diagnostic(
      'CHROMA_EDGE_DEGRADED',
      `Partial-alpha pixels ${metrics.partialAlphaPixels}, ratio ${(metrics.partialAlphaRatio * 100).toFixed(2)}%, fringe p95 ${metrics.edgeFringeP95.toFixed(2)}, color delta p95 ${metrics.edgeColorDeltaP95.toFixed(2)}, nearest distance p95 ${metrics.edgeNearestDistanceP95.toFixed(2)} failed edge limits.`,
    ))
  }
  return { approved: diagnostics.length === 0, diagnostics, thresholds }
}
