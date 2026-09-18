import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { generatablePixelPhenotypesV3, requirePixelArtCatalogV3 } from './pixel-art-catalog-v3.js'

const candidateRoot = 'packages/asset-catalog/pixel/v3/parts-coverage-1.3.0/'
const releaseRoot = 'packages/asset-catalog/pixel/v3/approved-1.3.0/'
const qaRoot = 'docs/qa/pixel-parts-coverage/'
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

it('promotes the exact sampled v3 candidate to immutable 1.3.0 without changing art', async () => {
  expect(existsSync(releaseRoot + 'catalog.approved.json'), 'approved 1.3.0 must exist').toBe(true)
  const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
  const approved = requirePixelArtCatalogV3(json(releaseRoot + 'catalog.approved.json'))
  const approval = json(qaRoot + 'approval.json')
  const report = json(qaRoot + 'report.json')

  expect(approval.userStatement).toBe('抽样过了就行，其他的默认不需要验收了')
  expect(approval.samples).toEqual(report.sampling.rows.map(({ coverageId, phenotype, profileId, rgbaSha256, file }: any) => ({ coverageId, phenotype, profileId, rgbaSha256, file })))
  expect(approval.samples).toHaveLength(34)
  expect(approved.artVersion).toBe('1.3.0')
  expect(approved.coverage).toEqual(candidate.coverage.map(row => ({ ...row, review: 'approved' })))
  expect(approved.generatable).toEqual(approved.coverage.map(row => row.id))
  expect(generatablePixelPhenotypesV3(approved)).toHaveLength(2016)
  expect(approved.profiles).toEqual(candidate.profiles)
  expect(approved.resources).toEqual(candidate.resources)
  expect(approved.rendererVersion).toBe(candidate.rendererVersion)
  expect(approved.evidence[qaRoot + 'approval.json']).toBe(sha(readFileSync(qaRoot + 'approval.json')))
  const { revision, ...content } = approved
  expect(revision).toBe(sha(canonicalJson(content)))
  for (const resource of Object.values(approved.resources)) {
    expect(readFileSync(releaseRoot + resource.path)).toEqual(readFileSync(candidateRoot + resource.path))
  }
})

it('rejects drift in the sampled approval, candidate identity, or QA evidence', async () => {
  expect(existsSync('scripts/pixel-art-v3-approval.mjs'), 'v3 approval validator must exist').toBe(true)
  // @ts-expect-error Build-time JavaScript validator has no declaration file.
  const { validatePixelArtV3Approval } = await import('../../../scripts/pixel-art-v3-approval.mjs')
  const bytes = readFileSync(qaRoot + 'approval.json')
  const context = {
    candidate: json(candidateRoot + 'catalog.candidate.json'),
    candidateBytes: readFileSync(candidateRoot + 'catalog.candidate.json'),
    provenanceBytes: readFileSync(candidateRoot + 'provenance.json'),
    report: json(qaRoot + 'report.json'),
    read: (file: string) => readFileSync(file),
  }
  await expect(validatePixelArtV3Approval(bytes, context)).resolves.toBeDefined()
  const approval = JSON.parse(bytes.toString())
  for (const mutate of [
    (value: any) => value.samples.pop(),
    (value: any) => value.samples[0].rgbaSha256 = '0'.repeat(64),
    (value: any) => value.userStatement = '通过',
    (value: any) => value.candidate.revision = '0'.repeat(64),
    (value: any) => value.runtimeEnabled = true,
  ]) {
    const changed = structuredClone(approval); mutate(changed)
    await expect(validatePixelArtV3Approval(Buffer.from(JSON.stringify(changed)), context)).rejects.toThrow(/Approval/)
  }
  for (const file of Object.keys(approval.evidence)) {
    await expect(validatePixelArtV3Approval(bytes, { ...context, read: (path: string) => path === file ? Buffer.from('drift') : readFileSync(path) })).rejects.toThrow(/Evidence/)
  }
})
