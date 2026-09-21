import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { phenotypeKeyV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import { requirePixelArtCatalogV3 } from './pixel-art-catalog-v3.js'

const baseRoot = 'packages/asset-catalog/pixel/v3/approved-1.5.0/'
const candidateRoot = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.0/'
const approvalPath = 'docs/qa/pixel-evolution-chains/approval.json'
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
})
