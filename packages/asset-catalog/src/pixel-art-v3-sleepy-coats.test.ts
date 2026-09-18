import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { requirePixelArtCatalogV3 } from './pixel-art-catalog-v3.js'

const baseRoot = 'packages/asset-catalog/pixel/v3/approved-1.4.0/'
const candidateRoot = 'packages/asset-catalog/pixel/v3/sleepy-coats-1.5.0/'
const releaseRoot = 'packages/asset-catalog/pixel/v3/approved-1.5.0/'
const qaRoot = 'docs/qa/pixel-sleepy-coats/'
const coats = ['brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const alpha = async (file: string) => {
  const rgba = await sharp(file).ensureAlpha().raw().toBuffer()
  return Buffer.from(rgba.filter((_, index) => index % 4 === 3))
}

it('adds the ten missing sleepy-almond bodies as five complete expression pairs', async () => {
  expect(existsSync(candidateRoot + 'catalog.candidate.json'), 'sleepy-coat candidate must exist').toBe(true)
  const base = requirePixelArtCatalogV3(json(baseRoot + 'catalog.approved.json'))
  const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))

  expect(candidate.artVersion).toBe('1.5.0-candidate.1')
  expect(candidate.profiles).toHaveLength(28)
  expect(candidate.coverage).toHaveLength(8064)
  expect(candidate.generatable).toEqual(base.generatable)
  expect(Object.keys(candidate.resources)).toHaveLength(58)
  expect(candidate.profiles.slice(0, base.profiles.length)).toEqual(base.profiles)
  expect(candidate.coverage.slice(0, base.coverage.length)).toEqual(base.coverage)
  expect(candidate.resources).toMatchObject(base.resources)

  const addedProfiles = candidate.profiles.slice(base.profiles.length)
  for (const coat of coats) {
    const profiles = addedProfiles.filter(profile => profile.coat === coat)
    expect(profiles).toHaveLength(2)
    expect(profiles.map(profile => profile.expression).sort()).toEqual(['parted-mouth', 'small-fangs'])
    expect(profiles.every(profile => profile.body === 'standard' && profile.eyes === 'sleepy-almond')).toBe(true)
    expect(candidate.coverage.filter(row => profiles.some(profile => profile.id === row.profileId))).toHaveLength(576)
  }
  expect(candidate.coverage.slice(base.coverage.length).every(row => row.review === 'pending')).toBe(true)

  for (const profile of addedProfiles) {
    const template = base.profiles.find(item => item.body === 'standard' && item.coat === 'orange-white' &&
      item.eyes === 'sleepy-almond' && item.expression === profile.expression)!
    const actualId = profile.steps.find(step => step.slot === 'body')!.resources[profile.expression]!
    const templateId = template.steps.find(step => step.slot === 'body')!.resources[profile.expression]!
    expect(await alpha(candidateRoot + candidate.resources[actualId]!.path), profile.id)
      .toEqual(await alpha(baseRoot + base.resources[templateId]!.path))
  }
})

it('writes three deterministic sleepy-almond combination samples per coat', () => {
  const report = json(qaRoot + 'report.json')
  expect(report.status).toBe('engineering-passed-art-review-pending')
  expect(report.sampling.total).toBe(15)
  expect(report.sampling.seed).toBe('sleepy-coats-1.5.0-stratified-v1')
  for (const coat of coats) expect(report.sampling.rows.filter((row: any) => row.phenotype.coat === coat)).toHaveLength(3)
  for (const row of report.sampling.rows) {
    expect(row.phenotype.eyes).toBe('sleepy-almond')
    expect(existsSync(qaRoot + row.file)).toBe(true)
    expect(sha(readFileSync(qaRoot + row.file))).toBe(row.pngSha256)
  }
})

it('promotes the exact sampled candidate to immutable 1.5.0 while keeping runtime disabled', async () => {
  expect(existsSync(releaseRoot + 'catalog.approved.json'), 'approved 1.5.0 must exist').toBe(true)
  const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
  const approved = requirePixelArtCatalogV3(json(releaseRoot + 'catalog.approved.json'))
  const approval = json(qaRoot + 'approval.json')

  expect(approval.userStatement).toBe('ok，通过')
  expect(approval.runtimeEnabled).toBe(false)
  expect(approval.samples).toHaveLength(15)
  expect(approved.artVersion).toBe('1.5.0')
  expect(approved.profiles).toEqual(candidate.profiles)
  expect(approved.resources).toEqual(candidate.resources)
  expect(approved.coverage).toEqual(candidate.coverage.map(row => ({ ...row, review: 'approved' })))
  expect(approved.generatable).toEqual(approved.coverage.map(row => row.id))
  expect(approved.coverage).toHaveLength(8064)
  expect(approved.evidence[qaRoot + 'approval.json']).toBe(sha(readFileSync(qaRoot + 'approval.json')))
  const { revision, ...content } = approved
  expect(revision).toBe(sha(canonicalJson(content)))
  for (const [id, resource] of Object.entries(candidate.resources)) {
    expect(readFileSync(releaseRoot + resource.path), id).toEqual(readFileSync(candidateRoot + resource.path))
  }

  // @ts-expect-error Build-time JavaScript validator has no declaration file.
  const { validateSleepyCoatsApproval } = await import('../../../scripts/pixel-art-v3-sleepy-coats-approval.mjs')
  await expect(validateSleepyCoatsApproval(readFileSync(qaRoot + 'approval.json'), {
    candidate,
    candidateBytes: readFileSync(candidateRoot + 'catalog.candidate.json'),
    provenanceBytes: readFileSync(candidateRoot + 'provenance.json'),
    report: json(qaRoot + 'report.json'),
    read: (file: string) => readFileSync(file),
  })).resolves.toBeDefined()
})
