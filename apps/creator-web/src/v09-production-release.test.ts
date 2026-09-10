import { describe, expect, it } from 'vitest'
import candidatePointer from '../../../packages/asset-catalog/releases/candidate-v0.9.0.json'
import candidateManifest from '../../../packages/asset-catalog/releases/by-sha256/e9ec104f13c2fcc2559cfddb648f3e5af18daf910a890d4c3c7ed80aecb6fb21.json'
import coreTemplate from '../../../asset-source/v0.9.0/feline/templates/feline-sit-v2-core.json'
import firstSealed from '../../../packages/asset-catalog/catalog/v0.9.0/sealed-traits/feline-sit-v2-core/bodyColor/common/body-color-cloud-gray.json'
import secondSealed from '../../../packages/asset-catalog/catalog/v0.9.0/sealed-traits/feline-sit-v2-core/bodyColor/common/body-color-coral-cream.json'
import firstApproval from '../../../packages/asset-catalog/audit/v0.9.0/trait-approvals/feline-sit-v2-core/bodyColor/common/body-color-cloud-gray.json'
import secondApproval from '../../../packages/asset-catalog/audit/v0.9.0/trait-approvals/feline-sit-v2-core/bodyColor/common/body-color-coral-cream.json'
import {
  ProductionReleaseError,
  loadActiveProductionRelease,
} from './v09-production-release.js'
import { candidateProductionReleaseOptions } from './v09-production-release.test-support.js'

describe('browser production v0.9 release loading', () => {
  it('fails closed when no active pointer is supplied or bundled', async () => {
    await expect(loadActiveProductionRelease({ activePointerDocuments: {} }))
      .rejects.toMatchObject({ code: 'ACTIVE_RELEASE_MISSING' })
  })

  it('resolves only the explicitly injected candidate hash through content-addressed resources', async () => {
    const release = await loadActiveProductionRelease(candidateProductionReleaseOptions())

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

  it('rejects a changed manifest body stored under the unchanged pointer digest', async () => {
    const hash = candidatePointer.releaseManifestSha256
    const tamperedManifest = structuredClone(candidateManifest)
    tamperedManifest.rendererBuildSha256 = '0'.repeat(64)

    await expect(loadActiveProductionRelease(candidateProductionReleaseOptions({
      releaseManifestDocuments: { [hash]: tamperedManifest },
    }))).rejects.toMatchObject({ code: 'RELEASE_MANIFEST_HASH_MISMATCH' })
  })

  it('rejects sealed traits and approvals swapped beneath their content identities', async () => {
    const firstSealedRef = candidateManifest.sealedTraits[0]!
    const secondSealedRef = candidateManifest.sealedTraits[1]!
    const firstApprovalRef = candidateManifest.traitApprovals[0]!
    const secondApprovalRef = candidateManifest.traitApprovals[1]!

    await expect(loadActiveProductionRelease(candidateProductionReleaseOptions({
      resourceDocuments: {
        [firstSealedRef.sha256]: secondSealed,
        [secondSealedRef.sha256]: firstSealed,
        [firstApprovalRef.sha256]: secondApproval,
        [secondApprovalRef.sha256]: firstApproval,
      },
    }))).rejects.toMatchObject({ code: 'RESOURCE_HASH_MISMATCH' })
  })

  it('rejects a canonically addressed family/template mismatch', async () => {
    const changedTemplate = structuredClone(coreTemplate)
    changedTemplate.skeletonFamilyId = 'feline-sit-v2-legendary-01'
    const changedTemplateHash = await canonicalHash(changedTemplate)
    const changedManifest = structuredClone(candidateManifest)
    changedManifest.assemblyTemplates[0] = {
      ...changedManifest.assemblyTemplates[0]!,
      resourceId: `sha256:${changedTemplateHash}`,
      sha256: changedTemplateHash,
    }
    const changedManifestHash = await canonicalHash(changedManifest)

    await expect(loadActiveProductionRelease(candidateProductionReleaseOptions({
      pointer: { schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: changedManifestHash },
      releaseManifestDocuments: { [changedManifestHash]: changedManifest },
      resourceDocuments: { [changedTemplateHash]: changedTemplate },
    }))).rejects.toMatchObject({ code: 'SKELETON_PROJECTION_MISSING' })
  })

  it('exposes stable structured failures', () => {
    const error = new ProductionReleaseError('ACTIVE_RELEASE_MISSING', 'missing')
    expect(error).toMatchObject({ name: 'ProductionReleaseError', code: 'ACTIVE_RELEASE_MISSING' })
  })
})

async function canonicalHash(value: unknown): Promise<string> {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number') {
      return JSON.stringify(item)
    }
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
    const record = item as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
