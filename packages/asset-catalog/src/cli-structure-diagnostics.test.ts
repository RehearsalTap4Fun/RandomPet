import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@qmonster/generator-core'
import { filterV06CatalogStructureDiagnostics } from './cli-structure-diagnostics.js'

describe('v0.6 CLI structure diagnostics', () => {
  it('suppresses only documented legacy rig coverage while retaining feline-sit coverage errors', () => {
    const diagnostics: Diagnostic[] = [
      { severity: 'error', code: 'CATALOG_RIG_UNCOVERED', path: ['rig'], message: 'Missing required rig: blob' },
      { severity: 'error', code: 'CATALOG_RIG_UNCOVERED', path: ['rig'], message: 'Missing required rig: feline-sit' },
      { severity: 'error', code: 'CATALOG_PART_INVALID', path: ['parts', 'tail_feline_long'], message: 'Tail metadata is invalid.' },
    ]

    expect(filterV06CatalogStructureDiagnostics(diagnostics)).toEqual([
      diagnostics[1],
      diagnostics[2],
    ])
  })
})
