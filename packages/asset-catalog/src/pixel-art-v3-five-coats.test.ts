import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { requirePixelArtCatalogV3 } from './pixel-art-catalog-v3.js'

const baseRoot = 'packages/asset-catalog/pixel/v3/approved-1.3.1/'
const candidateRoot = 'packages/asset-catalog/pixel/v3/five-coats-1.4.0/'
const releaseRoot = 'packages/asset-catalog/pixel/v3/approved-1.4.0/'
const qaRoot = 'docs/qa/pixel-five-coats/'
const coats = ['brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const alpha = async (file: string) => {
  const rgba = await sharp(file).ensureAlpha().raw().toBuffer()
  return Buffer.from(rgba.filter((_, index) => index % 4 === 3))
}

it('adds five standard round coat islands without changing approved 1.3.1 rows', async () => {
  expect(existsSync(candidateRoot + 'catalog.candidate.json'), 'five-coat candidate must exist').toBe(true)
  const base = requirePixelArtCatalogV3(json(baseRoot + 'catalog.approved.json'))
  const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))

  expect(candidate.artVersion).toBe('1.4.0-candidate.1')
  expect(candidate.profiles).toHaveLength(18)
  expect(candidate.coverage).toHaveLength(5184)
  expect(candidate.generatable).toEqual(base.generatable)
  expect(Object.keys(candidate.resources)).toHaveLength(48)
  expect(candidate.profiles.slice(0, base.profiles.length)).toEqual(base.profiles)
  expect(candidate.coverage.slice(0, base.coverage.length)).toEqual(base.coverage)
  expect(candidate.resources).toMatchObject(base.resources)

  const addedProfiles = candidate.profiles.slice(base.profiles.length)
  expect(new Set(addedProfiles.map(profile => profile.coat))).toEqual(new Set(coats))
  for (const coat of coats) {
    const coatProfiles = addedProfiles.filter(profile => profile.coat === coat)
    expect(coatProfiles).toHaveLength(2)
    expect(coatProfiles.map(profile => profile.expression).sort()).toEqual(['parted-mouth', 'small-fangs'])
    expect(coatProfiles.every(profile => profile.body === 'standard' && profile.eyes === 'round')).toBe(true)
    expect(candidate.coverage.filter(row => coatProfiles.some(profile => profile.id === row.profileId))).toHaveLength(576)
  }
  expect(candidate.coverage.slice(base.coverage.length).every(row => row.review === 'pending')).toBe(true)

  const templateProfiles = Object.fromEntries(base.profiles
    .filter(profile => profile.body === 'standard' && profile.eyes === 'round')
    .map(profile => [profile.expression, profile]))
  for (const profile of addedProfiles) {
    const template = templateProfiles[profile.expression]!
    for (const slot of ['body', 'ears', 'neck', 'tailTip']) {
      const step = profile.steps.find(item => item.slot === slot)!
      const templateStep = template.steps.find(item => item.slot === slot)!
      const trait = slot === 'body' ? profile.expression : slot === 'ears' ? 'fin-ears' : slot === 'neck' ? 'small-lion-mane' : 'forked-tail-tip'
      const actual = candidate.resources[step.resources[trait]!]!
      const expected = base.resources[templateStep.resources[trait]!]!
      expect(await alpha(candidateRoot + actual.path), `${profile.id}/${trait}`).toEqual(await alpha(baseRoot + expected.path))
    }
  }
})

it('writes exactly three deterministic combination samples per new coat', () => {
  const report = json(qaRoot + 'report.json')
  expect(report.status).toBe('engineering-passed-art-review-pending')
  expect(report.sampling.total).toBe(15)
  expect(report.sampling.seed).toBe('five-coats-1.4.0-stratified-v1')
  for (const coat of coats) expect(report.sampling.rows.filter((row: any) => row.phenotype.coat === coat)).toHaveLength(3)
  for (const row of report.sampling.rows) {
    expect(existsSync(qaRoot + row.file)).toBe(true)
    expect(sha(readFileSync(qaRoot + row.file))).toBe(row.pngSha256)
  }
})

it('promotes the exact sampled candidate to immutable 1.4.0 while keeping runtime disabled', async () => {
  expect(existsSync(releaseRoot + 'catalog.approved.json'), 'approved 1.4.0 must exist').toBe(true)
  const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
  const approved = requirePixelArtCatalogV3(json(releaseRoot + 'catalog.approved.json'))
  const approval = json(qaRoot + 'approval.json')

  expect(approval.userStatement).toBe('验收通过')
  expect(approval.runtimeEnabled).toBe(false)
  expect(approval.samples).toHaveLength(15)
  expect(approved.artVersion).toBe('1.4.0')
  expect(approved.profiles).toEqual(candidate.profiles)
  expect(approved.resources).toEqual(candidate.resources)
  expect(approved.coverage).toEqual(candidate.coverage.map(row => ({ ...row, review: 'approved' })))
  expect(approved.generatable).toEqual(approved.coverage.map(row => row.id))
  expect(approved.coverage).toHaveLength(5184)
  expect(approved.evidence[qaRoot + 'approval.json']).toBe(sha(readFileSync(qaRoot + 'approval.json')))
  const { revision, ...content } = approved
  expect(revision).toBe(sha(canonicalJson(content)))
  for (const [id, resource] of Object.entries(candidate.resources)) {
    expect(readFileSync(releaseRoot + resource.path), id).toEqual(readFileSync(candidateRoot + resource.path))
  }

  // @ts-expect-error Build-time JavaScript validator has no declaration file.
  const { validateFiveCoatsApproval } = await import('../../../scripts/pixel-art-v3-five-coats-approval.mjs')
  await expect(validateFiveCoatsApproval(readFileSync(qaRoot + 'approval.json'), {
    candidate,
    candidateBytes: readFileSync(candidateRoot + 'catalog.candidate.json'),
    provenanceBytes: readFileSync(candidateRoot + 'provenance.json'),
    report: json(qaRoot + 'report.json'),
    read: (file: string) => readFileSync(file),
  })).resolves.toBeDefined()
})
