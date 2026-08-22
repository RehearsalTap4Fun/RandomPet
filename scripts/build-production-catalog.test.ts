import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { VISUAL_SLOT_IDS } from '@qmonster/generator-core'
import { buildProductionCatalog } from './build-production-catalog.js'

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
  it('builds the exact visual, semantic-only and modifier budgets with traceable runtime hashes', async () => {
    const bundle = await buildProductionCatalog({ write: false })
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
})
