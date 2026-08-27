import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('v0.2 composition acceptance input closure', () => {
  it('loads the canonical tracked acceptance input', async () => {
    const { loadCompositionAcceptanceInput } = await import('./composition-acceptance-input.js')
    const document = await loadCompositionAcceptanceInput(process.cwd())
    expect(document.entries).toHaveLength(21)
  })

  it('fails fast with a precise diagnostic when the required input is absent', async () => {
    const { loadCompositionAcceptanceInput } = await import('./composition-acceptance-input.js')
    const emptyRoot = await mkdtemp(join(tmpdir(), 'qmonster-v02-acceptance-missing-'))
    try {
      await expect(loadCompositionAcceptanceInput(emptyRoot)).rejects.toThrow('V02_ACCEPTANCE_INPUT_MISSING:artifacts/acceptance/v0.2/acceptance-set.json')
    } finally {
      await rm(emptyRoot, { recursive: true, force: true })
    }
  })
})
