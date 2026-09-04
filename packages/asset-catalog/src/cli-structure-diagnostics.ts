import type { Diagnostic } from '@qmonster/generator-core'

const LEGACY_V06_REQUIRED_RIGS = new Set(['blob', 'biped', 'floating'])

export function filterV06CatalogStructureDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(diagnostic => !(
    diagnostic.code === 'CATALOG_RIG_UNCOVERED'
    && LEGACY_V06_REQUIRED_RIGS.has(diagnostic.message.replace('Missing required rig: ', ''))
  ))
}
