import { beforeAll, describe, expect, it } from 'vitest'
import { access, readFile } from 'node:fs/promises'
import { prepareFelineMasters, validateFelineMasters, readInventory, approvalBindingErrors } from './prepare-v09-feline-masters.js'
import { canonicalJsonSha256 } from '../packages/asset-catalog/src/v09-content-identity.js'
import { extractCheckerAlpha } from './extract-v09-feline-alpha.js'
import sharp from 'sharp'

it('removes neutral checker pixels and retains colored opaque pixels and partial fur coverage', () => {
  const rgb = Buffer.alloc(32 * 32 * 3)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 3
    const gray = ((x >> 2) + (y >> 2)) % 2 ? 204 : 255
    rgb.set(x >= 8 && x < 24 && y >= 8 && y < 24 ? [170, 210, 30] : [gray, gray, gray], i)
  }
  rgb.set([200, 220, 130], (7 * 32 + 16) * 3)
  const output = extractCheckerAlpha(rgb, 32, 32)
  expect(output[(16 * 32 + 16) * 4 + 3]).toBe(255)
  expect([...output.slice((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 3)]).toEqual([170, 210, 30])
  expect(output[3]).toBe(0)
  expect(output[(7 * 32 + 16) * 4 + 3]).toBeGreaterThan(0)
  expect(output[(7 * 32 + 16) * 4 + 3]).toBeLessThan(255)
})

it('removes enclosed checkerboard holes without discarding small neutral highlights', () => {
  const rgb = Buffer.alloc(64 * 64 * 3)
  for (let p = 0; p < 64 * 64; p++) rgb.set([170, 210, 30], p * 3)
  for (let y = 16; y < 40; y++) for (let x = 16; x < 40; x++) rgb.set([210, 210, 210], (y * 64 + x) * 3)
  rgb.set([240, 240, 240], (50 * 64 + 50) * 3)
  const output = extractCheckerAlpha(rgb, 64, 64)
  expect(output[(24 * 64 + 24) * 4 + 3]).toBe(0)
  expect(output[(50 * 64 + 50) * 4 + 3]).toBe(255)
})

describe('v0.9 approved authored feline masters', () => {
  beforeAll(async () => {
    // Acceptance artifacts are ignored by repository policy. A fresh checkout
    // reconstructs them from the committed authored sources before verification.
    try { await access('artifacts/acceptance/v0.9.0-feline/master-overlay-review.index.json') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await prepareFelineMasters() }
  }, 120_000)
  it('locks exactly one base and one legendary whole master at 8:1', async () => {
    const inventory = await readInventory()
    expect(inventory.masters.map(item => [item.skeletonClass, item.weight])).toEqual([['base', 8], ['legendary', 1]])
    for (const item of inventory.masters) {
      expect(item.structuralShapeClasses).toEqual(['feline-standard', item.skeletonClass === 'base' ? 'cat-tail-long' : 'cat-tail-curled'])
      expect(item.speciesRigId).toBe('feline-sit-v2')
      expect(item.regions.tail).toBeDefined()
      expect(Object.keys(item)).not.toContain('structuralLayers')
      for (const region of Object.values(item.regions)) {
        expect(region.vertices.length).toBeGreaterThanOrEqual(3)
        for (const [x, y] of region.vertices) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(2048); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(2048) }
      }
    }
  })
  it('verifies RGBA masters, alpha continuity, binary masks, authored seams, strict templates and report hashes', async () => {
    expect(await validateFelineMasters({ requireApproval: true })).toEqual([])
  }, 120_000)
  it('owns every visible pixel exactly once while retaining nose/ear color and three disjoint material indices', async () => {
    for (const entry of (await readInventory()).masters) {
      const master = await sharp(entry.masterPath).raw().toBuffer()
      const material = await sharp(`asset-source/v0.9.0/feline/templates/${entry.skeletonFamilyId}/material-map.png`).raw().toBuffer()
      const counts = new Map<number, number>()
      let invalid = 0
      for (let i = 0; i < master.length; i += 4) {
        if (master[i + 3]) {
          if (material[i + 3] !== 255 || ![1, 2, 3].includes(material[i]!)) invalid++
          counts.set(material[i]!, (counts.get(material[i]!) ?? 0) + 1)
        } else if (material[i] || material[i + 3]) invalid++
        if (material[i + 1] || material[i + 2]) invalid++
      }
      expect(invalid).toBe(0)
      expect([...counts.keys()].sort()).toEqual([1, 2, 3])
      expect(counts.get(1)!).toBeGreaterThan(counts.get(2)! * 10)
      expect(counts.get(3)!).toBeGreaterThan(1000)
    }
  }, 30_000)
  it('rebuilds deterministic decoded identities without changing owner approval', async () => {
    const indexPath = 'artifacts/acceptance/v0.9.0-feline/master-overlay-review.index.json'
    const before = await readFile(indexPath, 'utf8')
    const approvalPath = 'asset-source/v0.9.0/feline/approvals/assembly-approvals.json'
    const approvalBefore = await readFile(approvalPath, 'utf8')
    await prepareFelineMasters()
    expect(await readFile(indexPath, 'utf8')).toBe(before)
    expect(await readFile(approvalPath, 'utf8')).toBe(approvalBefore)
    const source = await readFile('scripts/prepare-v09-feline-masters.ts', 'utf8')
    expect(source).not.toMatch(/image_gen|imagegen|openai\.com|random\(/)
  }, 120_000)
  it('rejects altered master, template, mask, interface, report or formal approval bindings', async () => {
    const root = 'asset-source/v0.9.0/feline'
    const approvals = JSON.parse(await readFile(`${root}/approvals/assembly-approvals.json`, 'utf8'))
    const evidence = JSON.parse(await readFile(`${root}/approvals/approved-master-review.json`, 'utf8'))
    const allowlist = JSON.parse(await readFile(`${root}/approvals/attachment-allowlist.json`, 'utf8'))
    const index = JSON.parse(await readFile('artifacts/acceptance/v0.9.0-feline/master-overlay-review.index.json', 'utf8'))
    expect(approvalBindingErrors(approvals, evidence, allowlist, index)).toEqual([])
    expect(approvals).toHaveLength(2)
    expect(evidence.assemblyApprovalsSha256).toBe(canonicalJsonSha256(approvals))
    for (const field of ['neutralMasterSha256', 'assemblyTemplateSha256', 'fixedOccluderMasksSha256', 'overlaySha256']) {
      const changed = structuredClone(approvals)
      changed[0][field] = '0'.repeat(64)
      expect(approvalBindingErrors(changed, evidence, allowlist, index).length).toBeGreaterThan(0)
    }
    for (const field of ['maskSetSha256', 'attachmentInterfacesSha256']) {
      const changed = structuredClone(index)
      changed.families[0][field] = '0'.repeat(64)
      expect(approvalBindingErrors(approvals, evidence, allowlist, changed).length).toBeGreaterThan(0)
    }
    const changed = structuredClone(index)
    changed.report.sha256 = '0'.repeat(64)
    expect(approvalBindingErrors(approvals, evidence, allowlist, changed).length).toBeGreaterThan(0)
  })
})
