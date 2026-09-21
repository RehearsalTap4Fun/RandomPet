import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { phenotypeKeyV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import { requirePixelArtCatalogV3 } from './pixel-art-catalog-v3.js'

const baseRoot = 'packages/asset-catalog/pixel/v3/approved-1.6.0/'
const candidateRoot = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.1/'
const releaseRoot = 'packages/asset-catalog/pixel/v3/approved-1.6.1/'
const qaRoot = 'docs/qa/pixel-evolution-chain-complete/'
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

function derivedKeys(catalog: ReturnType<typeof requirePixelArtCatalogV3>) {
  const keys = new Set<string>()
  for (const profile of catalog.profiles) {
    const slots = ['crown', 'ears', 'neck', 'back', 'tailTip'] as const
    const options = slots.map(slot => ['none', ...Object.keys(profile.steps.find(step => step.slot === slot)!.resources)])
    for (const crown of options[0]!) for (const ears of options[1]!) for (const neck of options[2]!) {
      for (const back of options[3]!) for (const tailTip of options[4]!) keys.add(phenotypeKeyV2({
        schemaVersion: 'feline-phenotype-v2', body: profile.body, coat: profile.coat, eyes: profile.eyes,
        expression: profile.expression, crown, ears, neck, back, tailTip,
      }))
    }
  }
  return keys
}

it('completes the 35,840-row compact-runtime coverage grid without new QA images', () => {
  expect(existsSync(candidateRoot + 'catalog.candidate.json'), 'complete-grid candidate must exist').toBe(true)
  const base = requirePixelArtCatalogV3(json(baseRoot + 'catalog.approved.json'))
  const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
  const report = json(qaRoot + 'report.json')

  expect(candidate.artVersion).toBe('1.6.1-candidate.1')
  expect(candidate.profiles).toEqual(base.profiles)
  expect(candidate.resources).toEqual(base.resources)
  expect(candidate.coverage.slice(0, base.coverage.length)).toEqual(base.coverage)
  expect(candidate.coverage).toHaveLength(35_840)
  expect(candidate.coverage.filter(row => row.review === 'pending')).toHaveLength(27_763)
  expect(candidate.generatable).toEqual(base.generatable)
  const explicit = new Set(candidate.coverage.map(row => phenotypeKeyV2(row.phenotype)))
  const derived = derivedKeys(candidate)
  expect(explicit.size).toBe(35_840)
  expect(derived.size).toBe(35_840)
  expect(explicit).toEqual(derived)
  expect(report).toMatchObject({ status: 'mechanical-coverage-complete', explicitCoverage: 35_840,
    derivedCoverage: 35_840, reusedCoverage: 8_077, generatedDigests: 27_763, renderedPngs: 0, reviewSamples: 13 })
})

it('promotes the complete grid to immutable formal 1.6.1 with runtime still disabled', async () => {
  expect(existsSync(releaseRoot + 'catalog.approved.json'), 'approved 1.6.1 must exist').toBe(true)
  const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
  const approved = requirePixelArtCatalogV3(json(releaseRoot + 'catalog.approved.json'))
  const approval = json(qaRoot + 'approval.json')
  const provenance = json(releaseRoot + 'provenance.json')

  expect(approval.userStatement).toBe('ok')
  expect(approval.runtimeEnabled).toBe(false)
  expect(approval.compactRuntimeContract).toMatchObject({ sourceExchangeCommit: '8d357b08af26e23254997609892cced0a780e45c', explicitCoverage: 35_840, derivedCoverage: 35_840 })
  expect(approved.artVersion).toBe('1.6.1')
  expect(approved.profiles).toEqual(candidate.profiles)
  expect(approved.resources).toEqual(candidate.resources)
  expect(approved.coverage).toEqual(candidate.coverage.map(row => ({ ...row, review: 'approved' })))
  expect(approved.generatable).toEqual(approved.coverage.map(row => row.id))
  expect(provenance).toMatchObject({ status: 'approved', runtimeEnabled: false, promotedCoverage: 27_763,
    registration: { profiles: 28, coverage: 35_840, approved: 35_840, pending: 0, generatable: 35_840, resources: 63 } })
  const { revision, ...content } = approved
  expect(revision).toBe(sha(canonicalJson(content)))
  for (const [id, resource] of Object.entries(candidate.resources)) {
    expect(readFileSync(releaseRoot + resource.path), id).toEqual(readFileSync(candidateRoot + resource.path))
  }
  // @ts-expect-error Build-time JavaScript validator has no declaration file.
  const { validateEvolutionChainsCompleteApproval } = await import('../../../scripts/pixel-art-v3-evolution-chains-complete-approval.mjs')
  await expect(validateEvolutionChainsCompleteApproval(readFileSync(qaRoot + 'approval.json'), {
    candidate,
    candidateBytes: readFileSync(candidateRoot + 'catalog.candidate.json'),
    provenanceBytes: readFileSync(candidateRoot + 'provenance.json'),
    report: json(qaRoot + 'report.json'),
    read: (file: string) => readFileSync(file),
  })).resolves.toBeDefined()
})
