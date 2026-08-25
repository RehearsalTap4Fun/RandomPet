import type { Diagnostic } from '@qmonster/generator-core'

export const STRUCTURAL_BLOCKING_DIAGNOSTIC_CODES = new Set([
  'CONNECTOR_VARIANT_MISSING',
  'CONNECTOR_PROFILE_INVALID',
  'CONNECTOR_WARP_EXCEEDED',
  'CONNECTOR_BRIDGE_MISSING',
  'CONNECTOR_COMPOSITE_FAILED',
  'STRUCTURE_DISCONNECTED',
])

export function isStructuralBlockingDiagnostic(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 'error'
    && STRUCTURAL_BLOCKING_DIAGNOSTIC_CODES.has(diagnostic.code)
}
