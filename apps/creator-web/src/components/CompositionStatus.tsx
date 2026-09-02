import {
  planComposition,
  strongFeatureCount,
  strongNonFacialFeatureCount,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
} from '@qmonster/generator-core'

interface CompositionStatusProps {
  spec: MonsterSpec
  catalog: Catalog
  diagnostics: readonly Diagnostic[]
}

const FACE_DIAGNOSTIC_CODES = new Set([
  'COMPOSITION_FACE_OUT_OF_ZONE',
  'COMPOSITION_FACE_OCCLUDED',
])
const STRUCTURE_DIAGNOSTIC_CODES = new Set([
  'CONNECTOR_VARIANT_MISSING',
  'CONNECTOR_PROFILE_INVALID',
  'CONNECTOR_WARP_EXCEEDED',
  'CONNECTOR_BRIDGE_MISSING',
  'CONNECTOR_COMPOSITE_FAILED',
  'STRUCTURE_DISCONNECTED',
])

export function CompositionStatus({ spec, catalog, diagnostics }: CompositionStatusProps) {
  const policy = catalog.compositionPolicy
  if (policy === undefined) return null

  const plan = planComposition(
    spec.seed,
    spec.themeId,
    spec.visualSlots.bodyFrame.rigId,
    catalog,
  )
  const allowedSurprise = Object.values(plan.motifModes).filter(mode => mode === 'surprise').length
  const usedSurprise = policy.motifSlots.filter(slotId => {
    if (plan.motifModes[slotId] !== 'surprise') return false
    const part = catalog.parts.find(candidate => candidate.id === spec.visualSlots[slotId].partId)
    return part?.composition?.isNone === false
  }).length
  const faceReady = !diagnostics.some(diagnostic => (
    diagnostic.severity === 'error' && FACE_DIAGNOSTIC_CODES.has(diagnostic.code)
  ))
  const structureReady = !diagnostics.some(diagnostic => (
    diagnostic.severity === 'error' && STRUCTURE_DIAGNOSTIC_CODES.has(diagnostic.code)
  ))

  return (
    <ul aria-label="组合约束" className="composition-status">
      <li>强特征 {strongFeatureCount(spec, catalog)}/{policy.maxStrongFeatures}</li>
      <li>
        强非脸部 {strongNonFacialFeatureCount(spec, catalog)}/
        {policy.maxStrongNonFacialFeatures ?? '—'}
      </li>
      <li>惊喜位 {usedSurprise}/{allowedSurprise}</li>
      <li>{faceReady ? '面部清晰' : '面部需调整'}</li>
      {(spec.rendererVersion === '0.3.0' || spec.rendererVersion === '0.4.0') && (
        <li>{structureReady ? '结构连续' : '结构需调整'}</li>
      )}
    </ul>
  )
}
