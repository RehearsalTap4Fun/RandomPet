import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { composePixelArt } from '../../renderer-canvas/src/pixel-art-render.js'
import { requirePixelArtCatalogV2, resolvePixelArtV2, generatablePixelPhenotypesV2 } from './pixel-art-catalog-v2.js'

const base = 'packages/asset-catalog/pixel/v2/coverage-standard-small-fangs-round/'
const release = 'packages/asset-catalog/pixel/v2/approved-1.2.1/'
const qa = 'docs/qa/pixel-standard-small-fangs-approved/'
const sha = (bytes: string | Uint8Array | Uint8ClampedArray) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const ids = ['horns', 'flame', 'horns-flame', 'horns-ears', 'horns-mane', 'ears-flame', 'mane-flame', 'horns-ears-mane', 'horns-ears-flame', 'horns-mane-flame', 'ears-mane-flame'].map(s => `standard-${s}`)

it('rechecks the historical candidate without broadening or rewriting its approved evidence', async () => {
  const reportPath = 'docs/qa/pixel-standard-small-fangs-coverage/reproducibility.json'
  const before = readFileSync(reportPath), approvedBefore = readFileSync(release + 'catalog.approved.json')
  expect(Object.keys(JSON.parse(before.toString()).files)).toHaveLength(175)
  try {
    execFileSync(process.execPath, ['scripts/verify-pixel-art-v2-coverage-reproducibility.mjs'], { stdio: 'pipe' })
    expect(readFileSync(reportPath), 'candidate evidence must remain byte-identical after later releases exist').toEqual(before)
    expect(readFileSync(release + 'catalog.approved.json')).toEqual(approvedBefore)
    // @ts-expect-error Build-time JavaScript validator has no declaration file.
    const { validateCoverageApproval } = await import('../../../scripts/pixel-art-v2-coverage-approval.mjs')
    await expect(validateCoverageApproval(readFileSync(qa + 'approval.json'), {
      candidate: json(base + 'catalog.candidate.json'), candidateBytes: readFileSync(base + 'catalog.candidate.json'),
      provenanceBytes: readFileSync(base + 'provenance.json'), read: (file: string) => readFileSync(file),
    })).resolves.toBeDefined()
  } finally {
    // Keep the immutable evidence intact even when exercising the pre-fix failure.
    if (!readFileSync(reportPath).equals(before)) writeFileSync(reportPath, before)
  }
}, 30000)

it('publishes immutable 1.2.1 with exactly the eleven approved rows and identical art', async () => {
  expect(existsSync(release + 'catalog.approved.json'), 'approved 1.2.1 must exist').toBe(true)
  const candidate = requirePixelArtCatalogV2(json(base + 'catalog.candidate.json'))
  const approved = requirePixelArtCatalogV2(json(release + 'catalog.approved.json'))
  const approval = json(qa + 'approval.json')
  expect(candidate.revision).toBe('98db61376007d0fa62932ab0626c0b93ebcd29221e6f63182db31ca87efacc4c')
  expect(sha(readFileSync(base + 'catalog.candidate.json'))).toBe('528c240b6c4595c5fba902c11c147a550fbd208a6d18400189bd4250e2ae6538')
  expect(approval.userStatement).toBe('通过')
  expect(approval.samples.map((r: any) => r.id)).toEqual(ids)
  expect(approval.samples).toEqual(candidate.coverage.filter(r => r.review === 'pending').map(({ id, phenotype, profileId, rgbaSha256 }) => ({ id, phenotype, profileId, rgbaSha256 })))
  expect(approved.artVersion).toBe('1.2.1')
  expect(approved.coverage).toEqual(candidate.coverage.map(r => ({ ...r, review: 'approved' })))
  expect(approved.generatable).toEqual(approved.coverage.map(r => r.id))
  expect(generatablePixelPhenotypesV2(approved)).toHaveLength(32)
  expect(approved.profiles).toEqual(candidate.profiles)
  expect(approved.resources).toEqual(candidate.resources)
  expect(Object.keys(approved.resources)).toHaveLength(15)
  expect(approved.rendererVersion).toBe(candidate.rendererVersion)
  expect(approved).toEqual({ ...candidate, artVersion: '1.2.1', revision: approved.revision,
    coverage: candidate.coverage.map(row => ({ ...row, review: 'approved' })),
    generatable: candidate.coverage.map(row => row.id),
    evidence: { ...candidate.evidence, [qa + 'approval.json']: sha(readFileSync(qa + 'approval.json')) } })
  const { revision, ...data } = approved
  expect(revision).toBe(sha(canonicalJson(data)))
  expect(approved.evidence[qa + 'approval.json']).toBe(sha(readFileSync(qa + 'approval.json')))
  const layers: Record<string, Uint8ClampedArray> = {}
  for (const [id, resource] of Object.entries(approved.resources)) {
    const bytes = readFileSync(release + resource.path)
    expect(bytes).toEqual(readFileSync(base + resource.path))
    layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
  }
  for (const row of approved.coverage) for (let run = 0; run < 2; run++) expect(sha(composePixelArt(resolvePixelArtV2(row.phenotype, approved), layers))).toBe(row.rgbaSha256)
  for (const patch of [{ body: 'shortleg-round' }, { eyes: 'sleepy-almond' }, { back: 'bat-wings' }]) expect(() => resolvePixelArtV2({ ...approved.coverage[21]!.phenotype, ...patch }, approved)).toThrow(/Unsupported|Invalid/)
  for (const [file, hash] of Object.entries(json(qa + 'baseline.json').files)) expect(sha(readFileSync(file)), file).toBe(hash)
})

it('rejects changed approval, candidate identity, exact row scope, and source or QA evidence', async () => {
  expect(existsSync('scripts/pixel-art-v2-coverage-approval.mjs'), 'approval validator must exist').toBe(true)
  // @ts-expect-error Build-time JavaScript validator has no declaration file.
  const { validateCoverageApproval } = await import('../../../scripts/pixel-art-v2-coverage-approval.mjs')
  const bytes = readFileSync(qa + 'approval.json'), approval = JSON.parse(bytes.toString())
  const context = { candidate: json(base + 'catalog.candidate.json'), candidateBytes: readFileSync(base + 'catalog.candidate.json'), provenanceBytes: readFileSync(base + 'provenance.json'), read: (file: string) => readFileSync(file) }
  await expect(validateCoverageApproval(bytes, context)).resolves.toBeDefined()
  for (const mutate of [(a: any) => a.samples.pop(), (a: any) => a.samples.reverse(), (a: any) => a.samples[0].phenotype.eyes = 'sleepy-almond', (a: any) => a.userStatement = 'approved', (a: any) => a.candidate.revision = '0'.repeat(64), (a: any) => a.runtimeEnabled = true]) {
    const changed = structuredClone(approval); mutate(changed)
    await expect(validateCoverageApproval(Buffer.from(JSON.stringify(changed)), context)).rejects.toThrow(/Approval/)
  }
  const changed = structuredClone(context.candidate); changed.coverage[21].rgbaSha256 = '0'.repeat(64)
  await expect(validateCoverageApproval(bytes, { ...context, candidate: changed })).rejects.toThrow(/Approval/)
  await expect(validateCoverageApproval(bytes, { ...context, candidateBytes: Buffer.from('drift') })).rejects.toThrow(/Approval/)
  await expect(validateCoverageApproval(bytes, { ...context, provenanceBytes: Buffer.from('drift') })).rejects.toThrow(/Approval/)
  for (const file of Object.keys(approval.evidence)) await expect(validateCoverageApproval(bytes, { ...context, read: (p: string) => p === file ? Buffer.from('drift') : readFileSync(p) })).rejects.toThrow(/Evidence/)
})
