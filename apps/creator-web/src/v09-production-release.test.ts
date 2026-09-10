import { describe, expect, it } from 'vitest'
import candidatePointer from '../../../packages/asset-catalog/releases/candidate-v0.9.0.json'
import candidateManifest from '../../../packages/asset-catalog/releases/by-sha256/e9ec104f13c2fcc2559cfddb648f3e5af18daf910a890d4c3c7ed80aecb6fb21.json'
import {
  ProductionReleaseError,
  loadActiveProductionRelease,
} from './v09-production-release.js'

describe('browser production v0.9 release loading', () => {
  it('fails closed when no active pointer is supplied or bundled', () => {
    expect(() => loadActiveProductionRelease({ activePointerDocuments: {} }))
      .toThrowError(expect.objectContaining({ code: 'ACTIVE_RELEASE_MISSING' }))
  })

  it('resolves only the explicitly injected candidate hash', () => {
    const release = loadActiveProductionRelease({ pointer: candidatePointer })

    expect(release.manifestHash).toBe(candidatePointer.releaseManifestSha256)
    expect(release.catalog.releaseManifestSha256).toBe(candidatePointer.releaseManifestSha256)
    expect(release.catalog.releaseManifest.versionTuple).toEqual({
      schemaVersion: '0.4.0',
      catalogVersion: '0.9.0',
      generatorVersion: '0.9.0',
    })
    expect(release.catalog.skeletonPool.candidates.map(candidate => candidate.weight)).toEqual([8, 1])
    expect(release.traits).toHaveLength(312)
    expect(release.traits.every(trait => trait.approvalState === 'approved')).toBe(true)
  })

  it('rejects a mixed version tuple instead of coercing it', () => {
    const hash = candidatePointer.releaseManifestSha256
    const mixedManifest = structuredClone(candidateManifest)
    mixedManifest.versionTuple.generatorVersion = '0.8.0' as '0.9.0'

    expect(() => loadActiveProductionRelease({
      pointer: candidatePointer,
      releaseManifestDocuments: { [hash]: mixedManifest },
    })).toThrowError(expect.objectContaining({ code: 'VERSION_TUPLE_MISMATCH' }))
  })

  it('fails closed when the immutable trait approval inventory is unavailable', () => {
    expect(() => loadActiveProductionRelease({
      pointer: candidatePointer,
      traitApprovalDocuments: {},
    })).toThrowError(expect.objectContaining({ code: 'TRAIT_APPROVAL_MISSING' }))
  })

  it('exposes stable structured failures', () => {
    const error = new ProductionReleaseError('ACTIVE_RELEASE_MISSING', 'missing')
    expect(error).toMatchObject({ name: 'ProductionReleaseError', code: 'ACTIVE_RELEASE_MISSING' })
  })
})
