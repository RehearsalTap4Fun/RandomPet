import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { requirePixelArtCatalogV2 } from './pixel-art-catalog-v2.js'
const base = 'packages/asset-catalog/pixel/v2/'
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const approvalPath = 'docs/qa/flat-source-trial/stage3/approval.json'

it('promotes precisely the approved seven while retaining candidate bytes and canonical identity', () => {
  expect(existsSync(base + 'catalog.approved.json'), 'approved release must exist').toBe(true)
  const candidate = requirePixelArtCatalogV2(json(base + 'catalog.candidate.json'))
  const approved = requirePixelArtCatalogV2(json(base + 'catalog.approved.json'))
  const approval = json(approvalPath)
  expect(sha(readFileSync(base + 'catalog.candidate.json'))).toBe('94964fcdc7d4bbdcc961c6d2659a269d7b36e6dcc8f5edc2b24f39fb708ed738')
  expect(sha(readFileSync(base + 'provenance.json'))).toBe('a0c2f749555124c6091e099e803de1d748e3966a017814c4f62842b8a407b2a5')
  expect(approved.artVersion).toBe('1.2.0')
  expect(approved.rendererVersion).toBe('pixel-rgba-v1')
  expect(approved.coverage).toEqual(candidate.coverage.map(c => ({ ...c, review: 'approved' })))
  expect(approved.generatable).toEqual(approved.coverage.map(c => c.id))
  expect(approved.generatable).toHaveLength(21)
  expect(approved.resources).toEqual(candidate.resources)
  expect(approved.profiles).toEqual(candidate.profiles)
  expect(approval.userStatement).toBe('ok，通过')
  expect(approval.samples).toEqual(candidate.coverage.filter(c => c.review === 'pending').map(({id, phenotype, profileId, rgbaSha256}) => ({id, phenotype, profileId, rgbaSha256})))
  expect(approval.samples).toHaveLength(7)
  expect(approved.evidence[approvalPath]).toBe(sha(readFileSync(approvalPath)))
  const { revision, ...data } = approved
  expect(revision).toBe(sha(canonicalJson(data)))
  const files = ['catalog.candidate.json', 'provenance.json', ...Object.values(candidate.resources).map(r => r.path)]
  const before = files.map(f => sha(readFileSync(base + f)))
  const distBefore = files.map(f => {
    const file = 'dist/pixel-art/v2-candidate/' + (f === 'catalog.candidate.json' ? 'catalog.json' : f)
    return sha(readFileSync(existsSync(file) ? file : base + f))
  })
  execFileSync(process.execPath, ['scripts/build-pixel-art-v2.mjs'])
  expect(files.map(f => sha(readFileSync(base + f)))).toEqual(before)
  expect(files.map(f => sha(readFileSync('dist/pixel-art/v2-candidate/' + (f === 'catalog.candidate.json' ? 'catalog.json' : f))))).toEqual(distBefore)
})

it('rejects drift in the approval record, exact samples, and referenced evidence', async () => {
  expect(existsSync('scripts/pixel-art-v2-approval.mjs'), 'approval validation must exist').toBe(true)
  // @ts-expect-error Build-time JavaScript validator has no declaration file.
  const { validateApproval } = await import('../../../scripts/pixel-art-v2-approval.mjs')
  const candidate = requirePixelArtCatalogV2(json(base + 'catalog.candidate.json')), stage3 = json('docs/qa/flat-source-trial/stage3/report.json')
  const bytes = readFileSync(approvalPath)
  const context = { candidate, candidateBytes: readFileSync(base + 'catalog.candidate.json'), provenanceBytes: readFileSync(base + 'provenance.json'), stage3, read: (file: string) => readFileSync(file) }
  await expect(validateApproval(bytes, context)).resolves.toBeDefined()
  for (const mutate of [(a: any) => a.samples.pop(), (a: any) => a.samples[0].phenotype.eyes = 'round', (a: any) => a.samples[0].rgbaSha256 = '0'.repeat(64), (a: any) => a.userStatement = 'approved', (a: any) => a.exclusions = []]) {
    const changed = JSON.parse(bytes.toString()); mutate(changed)
    await expect(validateApproval(Buffer.from(JSON.stringify(changed)), context)).rejects.toThrow(/Approval/)
  }
  const approval = JSON.parse(bytes.toString())
  for (const file of [approval.report.path, approval.profile.path, ...Object.keys(approval.sourceAssets)]) {
    await expect(validateApproval(bytes, { ...context, read: (p: string) => p === file ? Buffer.from('drift') : readFileSync(p) })).rejects.toThrow(/Evidence/)
  }
})

