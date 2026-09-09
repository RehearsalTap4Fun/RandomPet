import { beforeAll, describe, expect, it } from 'vitest'
import { access, readFile } from 'node:fs/promises'
import { prepareFelineMasters, validateFelineMasters, readInventory, loadReviewResources } from './prepare-v09-feline-masters.js'
import { canonicalJsonSha256, decodedPngSha256 } from '../packages/asset-catalog/src/v09-content-identity.js'
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

describe('v0.9 feline masters pending expanded visual review', () => {
  beforeAll(async () => { await access('asset-source/v0.9.0/feline/review/master-overlay-review.index.json') })
  it('locks exactly one base and one legendary whole master at 8:1', async () => {
    const inventory = await readInventory()
    expect(inventory.masters.map(item => [item.skeletonClass, item.weight])).toEqual([['base', 8], ['legendary', 1]])
    for (const item of inventory.masters) {
      expect(item.structuralShapeClasses).toEqual(['feline-standard', item.skeletonClass === 'base' ? 'cat-tail-long' : 'cat-tail-curled'])
      expect(item.speciesRigId).toBe('feline-sit-v2')
      expect(item.archetypeId).toBe('feline')
      const family = JSON.parse(await readFile(`asset-source/v0.9.0/feline/templates/${item.skeletonFamilyId}/family.json`, 'utf8'))
      expect(family.archetypeId).toBe('feline')
      expect(item.regions.tail).toBeDefined()
      expect(Object.keys(item)).not.toContain('structuralLayers')
      for (const region of Object.values(item.regions)) {
        expect(region.vertices.length).toBeGreaterThanOrEqual(3)
        for (const [x, y] of region.vertices) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(2048); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(2048) }
      }
    }
  })
  it('verifies RGBA masters, alpha continuity, binary masks, authored seams, strict templates and report hashes', async () => {
    expect(await validateFelineMasters()).toEqual([])
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
  it('commits the exact index and fullContextOverlay closure without needing ignored artifacts', async () => {
    const index = JSON.parse(await readFile('asset-source/v0.9.0/feline/review/master-overlay-review.index.json', 'utf8'))
    const resources = await loadReviewResources()
    const report = resources.find(item => item.ref.resourceId === index.report.resourceId)!
    expect(await decodedPngSha256(report.bytes)).toBe(index.report.sha256)
    const reportPixels = await sharp(report.bytes).raw().toBuffer()
    expect(resources.filter(item => item.ref.mediaType === 'application/qmonster-manifest-v1+json')).toHaveLength(2)
    for (const entry of (await readInventory()).masters) {
      const panels = index.panels.filter((panel: { skeletonFamilyId: string; maskName?: string }) => panel.skeletonFamilyId === entry.skeletonFamilyId && panel.maskName)
      expect(panels.map((panel: { maskName: string }) => panel.maskName).sort()).toEqual(Object.keys(entry.expectedMaskPaths).sort())
      expect(panels.every((panel: { visibleMaskPixels: number }) => panel.visibleMaskPixels > 0)).toBe(true)
      for (const panel of panels) {
        let pink = 0
        for (let y = panel.y; y < panel.y + panel.size; y++) for (let x = panel.x; x < panel.x + panel.size; x++) {
          const i = (y * 2048 + x) * 4
          if (reportPixels[i]! > reportPixels[i + 1]! + 40 && reportPixels[i + 2]! > 65) pink++
        }
        // Actual pixels, not just inventory metadata, must display each mask.
        expect(pink).toBeGreaterThanOrEqual(panel.visibleMaskPixels)
      }
    }
  })
  it('rebuilds exact committed review identities while expanded approval remains absent', async () => {
    const indexPath = 'asset-source/v0.9.0/feline/review/master-overlay-review.index.json'
    const before = canonicalJsonSha256(JSON.parse(await readFile(indexPath, 'utf8')))
    await prepareFelineMasters()
    expect(canonicalJsonSha256(JSON.parse(await readFile(indexPath, 'utf8')))).toBe(before)
    await expect(access('asset-source/v0.9.0/feline/approvals/assembly-approvals.json')).rejects.toThrow()
  }, 120_000)
  it('does not reuse superseded revision-1 approval for expanded scope', async () => {
    await expect(access('asset-source/v0.9.0/feline/approvals/assembly-approvals.json')).rejects.toThrow()
    const superseded = JSON.parse(await readFile('asset-source/v0.9.0/feline/approval-history/revision-1/superseded.json', 'utf8'))
    expect(superseded.status).toBe('superseded')
    expect(superseded.reason).toContain('visible')
    const required = await validateFelineMasters({ requireApproval: true })
    expect(required).toEqual(['Explicit owner approval records are required'])
  }, 120_000)
})
