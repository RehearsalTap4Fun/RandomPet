import type { Diagnostic } from '@qmonster/generator-core'

export interface SessionDiagnosticSources {
  generationDiagnostics: Diagnostic[]
  renderDiagnostics: Diagnostic[]
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify([
    diagnostic.severity,
    diagnostic.code,
    diagnostic.path,
    diagnostic.message,
  ])
}

export function mergeSessionDiagnostics(
  generationDiagnostics: readonly Diagnostic[],
  renderDiagnostics: readonly Diagnostic[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const seen = new Set<string>()
  for (const diagnostic of [...generationDiagnostics, ...renderDiagnostics]) {
    const key = diagnosticKey(diagnostic)
    if (seen.has(key)) continue
    seen.add(key)
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

export function refreshSessionValidity<T extends SessionDiagnosticSources>(
  session: T,
): T & { diagnostics: Diagnostic[]; blocked: boolean } {
  const diagnostics = mergeSessionDiagnostics(
    session.generationDiagnostics,
    session.renderDiagnostics,
  )
  return {
    ...session,
    diagnostics,
    blocked: diagnostics.some(diagnostic => diagnostic.severity === 'error'),
  }
}
