import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@qmonster/generator-core'
import {
  mergeSessionDiagnostics,
  refreshSessionValidity,
} from './session-diagnostics.js'

const duplicate: Diagnostic = {
  severity: 'warning',
  code: 'SAME',
  path: ['visualSlots', 'eyes'],
  message: 'same diagnostic',
}

describe('session diagnostics', () => {
  it('stably de-duplicates generation diagnostics before render diagnostics', () => {
    const generationOnly: Diagnostic = {
      severity: 'warning', code: 'GENERATION', path: [], message: 'generation',
    }
    const renderOnly: Diagnostic = {
      severity: 'error', code: 'RENDER', path: [], message: 'render',
    }

    expect(mergeSessionDiagnostics(
      [generationOnly, duplicate, duplicate],
      [duplicate, renderOnly],
    )).toEqual([generationOnly, duplicate, renderOnly])
  })

  it('derives the cache and blocked state from both source buckets', () => {
    const renderError: Diagnostic = {
      severity: 'error', code: 'ASSET_LOAD_FAILED', path: ['parts', 'eyes'], message: 'missing',
    }
    const session = refreshSessionValidity({
      generationDiagnostics: [duplicate],
      renderDiagnostics: [renderError],
      diagnostics: [],
      blocked: false,
    })

    expect(session.diagnostics).toEqual([duplicate, renderError])
    expect(session.blocked).toBe(true)
    expect(refreshSessionValidity({ ...session, renderDiagnostics: [] })).toMatchObject({
      diagnostics: [duplicate],
      blocked: false,
    })
  })
})
