import { describe, expect, it, vi } from 'vitest'
import candidatePointer from '../../../packages/asset-catalog/releases/candidate-v0.9.0.json'
import { loadProductionBootstrap } from './production-bootstrap.js'
import { ProductionReleaseError } from './v09-production-release.js'
import { loadCandidateProductionRelease } from './v09-production-release.test-support.js'

describe('production entrypoint release activation', () => {
  it('keeps the legacy v0.8 target only when the active pointer is absent', async () => {
    const target = await loadProductionBootstrap(vi.fn(async () => {
      throw new ProductionReleaseError('ACTIVE_RELEASE_MISSING', 'not activated')
    }))

    expect(target.kind).toBe('legacy')
    if (target.kind === 'legacy') expect(target.catalog.version).toBe('0.8.0')
  })

  it('enters v0.9 deterministically when an active pointer resolves', async () => {
    const release = await loadCandidateProductionRelease()
    const target = await loadProductionBootstrap(vi.fn(async () => release))

    expect(target).toMatchObject({
      kind: 'v09',
      release: { manifestHash: candidatePointer.releaseManifestSha256 },
    })
    if (target.kind === 'v09') expect(target.resolver).toHaveProperty('resolvePng', expect.any(Function))
  })

  it('does not downgrade an invalid active release to v0.8', async () => {
    await expect(loadProductionBootstrap(vi.fn(async () => {
      throw new ProductionReleaseError('RELEASE_MANIFEST_HASH_MISMATCH', 'tampered')
    }))).rejects.toMatchObject({ code: 'RELEASE_MANIFEST_HASH_MISMATCH' })
  })
})
