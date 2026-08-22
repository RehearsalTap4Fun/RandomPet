import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VISUAL_SLOT_IDS } from '@qmonster/generator-core'
import { loadCommittedProductionCatalog, resolveProductionPrompt } from './build-production-catalog.js'
import { PRODUCTION_PARTS, buildPartPrompt } from './qmonster-part-production.js'

const expectedCounts = {
  bodyFrame: 5,
  headShape: 4,
  eyes: 5,
  mouthShape: 4,
  oralDetail: 4,
  headAppendage: 4,
  arms: 3,
  legs: 4,
  tail: 4,
  extraAppendage: 4,
  surfaceMaterial: 4,
  pattern: 4,
  colorScheme: 3,
  effect: 3,
} as const

describe('v0.1 production catalog builder', () => {
  it('preserves the exact locally recorded generation prompt instead of replacing it with a template', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'qmonster-prompt-'))
    await mkdir(join(sourceRoot, 'prompts'), { recursive: true })
    const part = PRODUCTION_PARTS.find(candidate => candidate.id === 'effect_bioluminescent_orbs')!
    await writeFile(join(sourceRoot, 'prompts', `${part.id}.txt`), 'exact built-in image generation prompt\n')

    await expect(resolveProductionPrompt(sourceRoot, part)).resolves.toMatchObject({
      prompt: 'exact built-in image generation prompt',
      source: 'recorded',
    })
    await expect(resolveProductionPrompt(sourceRoot, PRODUCTION_PARTS[0]!)).resolves.toMatchObject({
      prompt: buildPartPrompt(PRODUCTION_PARTS[0]!),
      source: 'template-fallback',
    })
  })

  it('builds the exact visual, semantic-only and modifier budgets with traceable runtime hashes', async () => {
    const bundle = await loadCommittedProductionCatalog()
    const counts = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
      slotId,
      bundle.catalog.parts.filter(part => part.slotId === slotId).length,
    ]))

    expect(bundle.catalog.parts).toHaveLength(55)
    expect(counts).toEqual(expectedCounts)
    expect(bundle.catalog.parts.filter(part => part.id.endsWith('_none')).map(part => part.id).sort()).toEqual([
      'effect_none', 'extra_appendage_none', 'head_appendage_none', 'tail_none',
    ])
    expect(bundle.semanticTraits.filter(trait => trait.semanticSlotId === 'personality')).toHaveLength(6)
    expect(bundle.semanticTraits.filter(trait => trait.semanticSlotId === 'quirk')).toHaveLength(6)
    expect(bundle.modifiers.filter(modifier => modifier.kind === 'mutation').map(modifier => modifier.id).sort()).toEqual([
      'mutation_albino', 'mutation_double_head',
    ])
    expect(bundle.modifiers.filter(modifier => modifier.kind === 'aberration').map(modifier => modifier.id).sort()).toEqual([
      'aberration_color_discord', 'aberration_misplaced_eye',
    ])

    for (const part of bundle.parts) {
      expect(part.displayName).not.toBe('')
      expect(part.flavorText).not.toBe('')
      const runtime = await readFile(`packages/asset-catalog/assets/v0.1.0/${part.assetPath}`)
      expect(createHash('sha256').update(runtime).digest('hex')).toBe(part.assetSha256)
    }
    for (const entry of [...bundle.semanticTraits, ...bundle.modifiers]) {
      expect(entry.displayName).not.toBe('')
      expect(entry.flavorText).not.toBe('')
      expect(entry.themeBoosts).toBeDefined()
      expect(entry.excludes).toBeDefined()
      expect(entry.boosts).toBeDefined()
      expect(entry.visualMapping).toBeDefined()
    }
  })

  it('preserves authored socket and origin for body, head, mouth, appendage, and tail layers', async () => {
    const { parts } = await loadCommittedProductionCatalog()
    const placement = (id: string) => {
      const candidate = parts.find(part => part.id === id)
      expect(candidate, `missing ${id}`).toBeDefined()
      return { socket: candidate!.socket, origin: candidate!.origin }
    }

    expect(placement('body_blob_round')).toEqual({ socket: null, origin: { x: 512, y: 512 } })
    expect(placement('head_round_dome')).toEqual({ socket: 'head', origin: { x: 512, y: 512 } })
    expect(placement('mouth_wide_grin')).toEqual({ socket: 'head', origin: { x: 512, y: 512 } })
    expect(placement('arms_short_plush')).toEqual({ socket: null, origin: { x: 512, y: 512 } })
    expect(placement('tail_soft_curl')).toEqual({ socket: 'tail', origin: { x: 512, y: 512 } })
  })

  it('commits complete chroma-quality audit data for all twelve rig candidates', async () => {
    const { sourceIndex } = await loadCommittedProductionCatalog()
    const sources = sourceIndex.sources as Array<Record<string, unknown>>
    const rigSources = sources.filter(source => source.kind === 'rig-base')
    expect(rigSources).toHaveLength(3)
    for (const rig of rigSources) {
      const candidates = rig.candidateEvaluations as Array<Record<string, unknown>>
      expect(candidates).toHaveLength(4)
      expect(candidates.filter(candidate => candidate.selected)).toHaveLength(1)
      for (const candidate of candidates) {
        expect(candidate.machineApproved).toBeTypeOf('boolean')
        expect(candidate.diagnostics).toBeInstanceOf(Array)
        expect(candidate.metrics).toMatchObject({
          detectedKeyHex: expect.stringMatching(/^#[a-f0-9]{6}$/),
          edgeColorDeltaP95: expect.any(Number),
          safeBorderForegroundPixels: expect.any(Number),
        })
        expect(candidate.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
        expect(candidate.processedSha256).toMatch(/^[a-f0-9]{64}$/)
      }
      expect(rig.selectedExtraction).toMatchObject({ approved: true })
    }
    expect(sourceIndex.qualityGateSummary).toMatchObject({
      rigCandidatesEvaluated: 12,
      partCandidatesEvaluated: 204,
      approvedRigSelectionsPassing: 3,
      approvedPartSelectionsPassing: 51,
    })
  })
})
