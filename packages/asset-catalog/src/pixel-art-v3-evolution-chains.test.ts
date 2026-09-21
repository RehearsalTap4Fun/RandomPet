import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { phenotypeKeyV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import { requirePixelArtCatalogV3 } from './pixel-art-catalog-v3.js'

const baseRoot = 'packages/asset-catalog/pixel/v3/approved-1.5.0/'
const candidateRoot = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.0/'
const releaseRoot = 'packages/asset-catalog/pixel/v3/approved-1.6.0/'
const approvalPath = 'docs/qa/pixel-evolution-chains/approval.json'
const qaRoot = 'docs/qa/pixel-evolution-chain-registration/'
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

const traits = {
  crown: ['crystal-horns'],
  ears: ['feathered-ears', 'celestial-ears'],
  neck: ['sunburst-ruff'],
  tailTip: ['phoenix-tail'],
} as const

describe('pixel evolution-chain 1.6.0 candidate', () => {
  it('registers every approved trait on all profiles while appending only 13 representative rows', () => {
    expect(existsSync(candidateRoot + 'catalog.candidate.json'), 'candidate catalog must exist').toBe(true)
    expect(existsSync(candidateRoot + 'provenance.json'), 'candidate provenance must exist').toBe(true)

    const base = requirePixelArtCatalogV3(json(baseRoot + 'catalog.approved.json'))
    const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
    const approval = json(approvalPath)
    const provenance = json(candidateRoot + 'provenance.json')

    expect(candidate.artVersion).toBe('1.6.0-candidate.1')
    expect(candidate.rendererVersion).toBe('pixel-rgba-v1')
    expect(candidate.profiles).toHaveLength(28)
    expect(candidate.coverage).toHaveLength(8_077)
    expect(candidate.generatable).toEqual(base.generatable)
    expect(candidate.coverage.slice(0, base.coverage.length)).toEqual(base.coverage)
    expect(Object.keys(candidate.resources)).toHaveLength(63)
    expect(provenance.registration).toEqual({
      profiles: 28,
      baseCoverage: 8_064,
      sampledPending: 13,
      catalogCoverage: 8_077,
      theoreticalCoverage: 35_840,
      generatedForValidation: 13,
      resources: 63,
    })
    expect(provenance.validationMode).toBe('representative-samples')
    expect(provenance.runtimeEnabled).toBe(false)

    const approvedById = new Map(approval.scope.map((item: { id: string }) => [item.id, item]))
    for (const profile of candidate.profiles) {
      const baseProfile = base.profiles.find(item => item.id === profile.id)
      expect(baseProfile, `base profile ${profile.id}`).toBeDefined()
      for (const [slot, ids] of Object.entries(traits)) {
        const step = profile.steps.find(item => item.slot === slot)!
        for (const id of ids) {
          const approved = approvedById.get(id) as { pixelSha256: string } | undefined
          const resourceId = step.resources[id]
          expect(resourceId, `${profile.id} ${slot}/${id}`).toBeDefined()
          expect(candidate.resources[resourceId!]?.sha256).toBe(approved?.pixelSha256)
        }
      }
      const sunburst = profile.steps.find(item => item.slot === 'neck')!.variants?.['sunburst-ruff']
      expect(sunburst).toEqual({
        target: 'subject',
        clear: [],
        occlusion: (approvedById.get('sunburst-ruff') as { occlusionByBody: Record<string, unknown> }).occlusionByBody[profile.body],
      })

      const projected = structuredClone(profile)
      for (const [slot, ids] of Object.entries(traits)) {
        const step = projected.steps.find(item => item.slot === slot)!
        for (const id of ids) delete step.resources[id]
        if (slot === 'neck') {
          delete step.variants?.['sunburst-ruff']
          if (step.variants && Object.keys(step.variants).length === 0) delete step.variants
        }
      }
      expect(projected).toEqual(baseProfile)
    }

    const sampled = candidate.coverage.slice(base.coverage.length)
    expect(sampled).toHaveLength(13)
    expect(sampled.every(row => row.review === 'pending')).toBe(true)
    expect(new Set(sampled.map(row => phenotypeKeyV2(row.phenotype))).size).toBe(13)
    expect(new Set(sampled.map(row => row.phenotype.coat))).toEqual(new Set(['orange-white', 'brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']))
    expect(new Set(sampled.map(row => row.phenotype.body))).toEqual(new Set(['standard', 'shortleg-round', 'slender-tall']))
    for (const ids of Object.values(traits)) for (const id of ids) {
      expect(sampled.some(row => Object.values(row.phenotype).includes(id)), `sample contains ${id}`).toBe(true)
    }
  })

  it('pins every candidate resource to its declared bytes', () => {
    const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
    for (const resource of Object.values(candidate.resources)) {
      const bytes = readFileSync(candidateRoot + resource.path)
      expect(sha(bytes), resource.path).toBe(resource.sha256)
    }
  })

  it('publishes exactly 13 representative rendered samples', () => {
    expect(existsSync(qaRoot + 'report.json'), 'registration report must exist').toBe(true)
    expect(existsSync(qaRoot + 'index.html'), 'registration review page must exist').toBe(true)
    const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
    const report = json(qaRoot + 'report.json')
    const pending = candidate.coverage.filter(row => row.review === 'pending')
    expect(report.schemaVersion).toBe('pixel-evolution-chain-registration-review-v1')
    expect(report.status).toBe('technical-sample-passed')
    expect(report.validationMode).toBe('representative-samples')
    expect(report.candidate.revision).toBe(candidate.revision)
    expect(report.sampling).toEqual({ total: 13, theoreticalCoverage: 35_840, generated: 13, rows: report.sampling.rows })
    expect(report.sampling.rows).toHaveLength(13)
    expect(report.sampling.rows.map((row: { coverageId: string }) => row.coverageId)).toEqual(pending.map(row => row.id))
    expect(new Set(report.sampling.rows.map((row: { coat: string }) => row.coat))).toEqual(new Set(['orange-white', 'brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']))
    expect(new Set(report.sampling.rows.map((row: { body: string }) => row.body))).toEqual(new Set(['standard', 'shortleg-round', 'slender-tall']))
    for (const row of report.sampling.rows) {
      const file = qaRoot + row.file
      expect(existsSync(file), file).toBe(true)
      expect(sha(readFileSync(file)), row.file).toBe(row.pngSha256)
      const coverage = pending.find(item => item.id === row.coverageId)
      expect(row.rgbaSha256).toBe(coverage?.rgbaSha256)
      expect(row.phenotype).toEqual(coverage?.phenotype)
    }
  })

  it('promotes the replayed candidate to immutable 1.6.0 without enabling runtime', async () => {
    expect(existsSync(qaRoot + 'approval.json'), 'promotion approval must exist').toBe(true)
    expect(existsSync(releaseRoot + 'catalog.approved.json'), 'approved 1.6.0 must exist').toBe(true)
    const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
    const approved = requirePixelArtCatalogV3(json(releaseRoot + 'catalog.approved.json'))
    const approval = json(qaRoot + 'approval.json')
    const provenance = json(releaseRoot + 'provenance.json')

    expect(approval.userStatement).toBe('回放通过了')
    expect(approval.approvedArtVersion).toBe('1.6.0')
    expect(approval.runtimeEnabled).toBe(false)
    expect(approval.consumerReplay).toMatchObject({ nutriCommit: 'b5dd350', replayed: 8_077, matched: 8_077, sampled: 13 })
    expect(approved.artVersion).toBe('1.6.0')
    expect(approved.profiles).toEqual(candidate.profiles)
    expect(approved.resources).toEqual(candidate.resources)
    expect(approved.coverage).toEqual(candidate.coverage.map(row => ({ ...row, review: 'approved' })))
    expect(approved.generatable).toEqual(approved.coverage.map(row => row.id))
    expect(approved.coverage).toHaveLength(8_077)
    expect(approved.evidence[qaRoot + 'approval.json']).toBe(sha(readFileSync(qaRoot + 'approval.json')))
    expect(provenance).toMatchObject({ status: 'approved', runtimeEnabled: false, promotedCoverage: 13,
      registration: { profiles: 28, coverage: 8_077, approved: 8_077, pending: 0, generatable: 8_077, resources: 63 } })
    const { revision, ...content } = approved
    expect(revision).toBe(sha(Buffer.from(canonicalJson(content))))
    for (const [id, resource] of Object.entries(candidate.resources)) {
      expect(readFileSync(releaseRoot + resource.path), id).toEqual(readFileSync(candidateRoot + resource.path))
    }
    // @ts-expect-error Build-time JavaScript validator has no declaration file.
    const { validateEvolutionChainsPromotionApproval } = await import('../../../scripts/pixel-art-v3-evolution-chains-approval.mjs')
    await expect(validateEvolutionChainsPromotionApproval(readFileSync(qaRoot + 'approval.json'), {
      candidate,
      candidateBytes: readFileSync(candidateRoot + 'catalog.candidate.json'),
      provenanceBytes: readFileSync(candidateRoot + 'provenance.json'),
      report: json(qaRoot + 'report.json'),
      read: (file: string) => readFileSync(file),
    })).resolves.toBeDefined()
  })
})
