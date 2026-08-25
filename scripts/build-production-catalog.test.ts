import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateMonster, VISUAL_SLOT_IDS } from '@qmonster/generator-core'
import {
  PRODUCTION_CHROMA_GATE_PROFILE,
  PRODUCTION_CHROMA_GATE_VERSION,
} from '../packages/asset-catalog/src/chroma-quality-gate.js'
import {
  PRODUCTION_EVIDENCE_CANONICALIZATION,
  PRODUCTION_EVIDENCE_MANIFEST_VERSION,
  computeProductionEvidenceRoot,
} from '../packages/asset-catalog/src/evidence-root.js'
import { buildProductionCatalog, loadCommittedProductionCatalog, resolveProductionPrompt } from './build-production-catalog.js'
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
    const bundle = await loadCommittedProductionCatalog({ version: '0.1.0' })
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
    const { parts } = await loadCommittedProductionCatalog({ version: '0.1.0' })
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
    const { sourceIndex } = await loadCommittedProductionCatalog({ version: '0.1.0' })
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

  it('commits the immutable gate and source-rich paths for every chroma evaluation', async () => {
    const { sourceIndex } = await loadCommittedProductionCatalog({ version: '0.1.0' })
    expect(sourceIndex.extractionGate).toEqual({
      gateVersion: PRODUCTION_CHROMA_GATE_VERSION,
      profile: PRODUCTION_CHROMA_GATE_PROFILE,
    })
    const sources = sourceIndex.sources as Array<Record<string, any>>
    const chromaSources = sources.filter(source => source.kind === 'rig-base' || source.kind === 'generated-slot-layer')
    expect(chromaSources).toHaveLength(54)
    expect(chromaSources.flatMap(source => source.candidateEvaluations)).toHaveLength(216)
    for (const source of chromaSources) {
      for (const candidate of source.candidateEvaluations) {
        expect(candidate).toMatchObject({
          gateVersion: PRODUCTION_CHROMA_GATE_VERSION,
          imageSize: { width: expect.any(Number), height: expect.any(Number) },
          sourcePath: expect.stringMatching(/^asset-source\/v0\.1\.0\//u),
          processedPath: expect.stringMatching(/^asset-source\/v0\.1\.0\//u),
        })
      }
      expect(source.selectedExtraction.gateVersion).toBe(PRODUCTION_CHROMA_GATE_VERSION)
    }
    const angler = sources.find(source => source.sourceId === 'head_angler_bulb')
    const componentEvaluations = [...angler.componentEvaluations.shell, ...angler.componentEvaluations.lure]
    expect(componentEvaluations).toHaveLength(8)
    for (const candidate of componentEvaluations) {
      expect(candidate.extraction).toMatchObject({
        gateVersion: PRODUCTION_CHROMA_GATE_VERSION,
        imageSize: { width: expect.any(Number), height: expect.any(Number) },
        sourcePath: expect.stringMatching(/^asset-source\/v0\.1\.0\//u),
        processedPath: expect.stringMatching(/^asset-source\/v0\.1\.0\//u),
      })
    }
  })

  it('anchors the canonical committed source-index in an independent evidence manifest', async () => {
    const { sourceIndex } = await loadCommittedProductionCatalog({ version: '0.1.0' })
    const manifest = JSON.parse(await readFile(join(
      process.cwd(),
      'packages',
      'asset-catalog',
      'audit',
      'v0.1.0',
      'evidence-manifest.json',
    ), 'utf8'))

    expect(manifest).toEqual({
      manifestVersion: PRODUCTION_EVIDENCE_MANIFEST_VERSION,
      canonicalization: PRODUCTION_EVIDENCE_CANONICALIZATION,
      catalogVersion: '0.1.0',
      sourceIndexPath: 'packages/asset-catalog/source-index.json',
      evidenceRootSha256: computeProductionEvidenceRoot(sourceIndex),
    })
  })

  it('describes the deep-sea and fungal color assets with their actual theme palettes', async () => {
    const { parts } = await loadCommittedProductionCatalog({ version: '0.1.0' })
    expect(parts.find(part => part.id === 'color_deep_sea_coral')?.description).toBe(
      'a modular palette overlay of deep ocean-blue primary patches, aqua secondary patches, and warm-gold accents arranged in three broad body-following zones; color patches only',
    )
    expect(parts.find(part => part.id === 'color_fungal_amber')?.description).toBe(
      'a modular palette overlay of olive primary patches, lime secondary patches, and warm-orange accents arranged in three broad body-following zones; color patches only',
    )
  })

  it('keeps nested palette-mask audit paths repository-relative', async () => {
    const { sourceIndex } = await loadCommittedProductionCatalog({ version: '0.1.0' })
    const sources = sourceIndex.sources as Array<Record<string, unknown>>
    const colorSources = sources.filter(source => source.slotId === 'colorScheme')

    expect(colorSources).toHaveLength(3)
    for (const source of colorSources) {
      const audit = source.paletteMaskAudit as { rigMasks: Record<string, { paths: Record<string, string> }> }
      for (const rig of Object.values(audit.rigMasks)) {
        for (const path of Object.values(rig.paths)) {
          expect(path).not.toMatch(/^[a-z]:[\\/]/iu)
          expect(path).toMatch(/^packages\/asset-catalog\/assets\/v0\.1\.0\/masks\//u)
        }
      }
    }
  })
})

describe('v0.2 composition-aware production catalog builder', () => {
  it('migrates all existing catalog budgets and gives every part explicit composition metadata', async () => {
    const { catalog } = await loadCommittedProductionCatalog({ version: '0.2.0' })

    expect(catalog.version).toBe('0.2.0')
    expect(catalog.themes).toHaveLength(3)
    expect(catalog.rigs).toHaveLength(3)
    expect(catalog.parts).toHaveLength(55)
    expect(catalog.semanticTraits).toHaveLength(61)
    expect(catalog.compositionPolicy).toEqual({
      motifSlots: ['headShape', 'eyes', 'mouthShape', 'oralDetail', 'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage', 'surfaceMaterial', 'pattern', 'effect'],
      surpriseRatio: 0.3,
      maxStrongFeatures: 2,
      optionalNoneRate: { min: 0.35, max: 0.5 },
      frameBounds: { x: 96, y: 64, width: 1856, height: 1888 },
      faceInsideRatio: 0.8,
      faceVisibleRatio: 0.85,
    })
    expect(catalog.parts.every(part => part.composition !== undefined)).toBe(true)
    for (const body of catalog.parts.filter(part => part.slotId === 'bodyFrame')) {
      expect(body.composition?.renderNodes).toHaveLength(1)
      expect(body.composition?.renderNodes[0]).toMatchObject({ parentSlot: null, socket: null })
    }
    for (const part of catalog.parts.filter(part => part.slotId === 'arms' || part.slotId === 'legs')) {
      expect(part.composition?.renderNodes.map(node => node.socket)).toEqual(
        part.slotId === 'arms' ? ['armLeft', 'armRight'] : ['legLeft', 'legRight'],
      )
    }
    expect(catalog.parts.find(part => part.id === 'extra_moth_wings')?.composition?.renderNodes.map(node => node.socket))
      .toEqual(['wingLeft', 'wingRight'])
  })

  it('records exactly the seven approved rework actions and intensity classifications', async () => {
    const rework = JSON.parse(await readFile('asset-source/v0.2.0/generation/composition-rework.json', 'utf8'))
    expect(rework.actions).toHaveLength(7)
    expect(rework.actions.map((action: { partIds: string[] }) => action.partIds)).toEqual([
      ['legs_mushroom'],
      ['arms_long_noodle'],
      ['head_mushroom_cap'],
      ['surface_soft_scales'],
      ['oral_gummy_ridges'],
      ['effect_spore_glow'],
      ['eyes_triple_pearl', 'mouth_wide_grin'],
    ])

    const { catalog } = await loadCommittedProductionCatalog({ version: '0.2.0' })
    const intensity = (id: string) => catalog.parts.find(part => part.id === id)?.composition?.visualIntensity
    expect(intensity('head_mushroom_cap')).toBe('strong')
    expect(intensity('eyes_triple_pearl')).toBe('strong')
    expect(intensity('mouth_wide_grin')).toBe('strong')
    expect(intensity('oral_lolling_tongue')).toBe('strong')
    expect(intensity('surface_gel_bubbles')).toBe('strong')
    expect(intensity('surface_soft_scales')).toBe('quiet')
    expect(intensity('oral_gummy_ridges')).toBe('quiet')
    expect(intensity('effect_spore_glow')).toBe('strong')
  })

  it('keeps every optional explicit-none selection within 35%-50% over 10,000 normal seeds', async () => {
    const { catalog } = await loadCommittedProductionCatalog({ version: '0.2.0' })
    const counts = { headAppendage: 0, tail: 0, extraAppendage: 0, effect: 0 }
    const noneIds = {
      headAppendage: 'head_appendage_none',
      tail: 'tail_none',
      extraAppendage: 'extra_appendage_none',
      effect: 'effect_none',
    } as const
    const themes = ['deep-sea', 'fungal', 'shadow'] as const
    for (let index = 0; index < 10_000; index += 1) {
      const result = generateMonster({ seed: `distribution-${index}`, themeId: themes[index % 3]!, mode: 'normal' }, catalog)
      for (const slotId of Object.keys(noneIds) as Array<keyof typeof noneIds>) {
        if (result.spec.visualSlots[slotId].partId === noneIds[slotId]) counts[slotId] += 1
      }
      const strong = Object.values(result.spec.visualSlots).filter(selection => (
        catalog.parts.find(part => part.id === selection.partId)?.composition?.visualIntensity === 'strong'
      )).length
      expect(strong).toBeLessThanOrEqual(2)
    }
    console.log('v0.2 optional-none distribution', Object.fromEntries(Object.entries(counts).map(([slot, count]) => [slot, count / 10_000])))
    for (const count of Object.values(counts)) {
      expect(count / 10_000).toBeGreaterThanOrEqual(0.35)
      expect(count / 10_000).toBeLessThanOrEqual(0.5)
    }
  }, 30_000)
})

describe('v0.3 interface production catalog builder', () => {
  it('builds the re-authored connection-aware round head without restoring retired provenance', async () => {
    const result = await buildProductionCatalog({ write: false, version: '0.3.0' })

    const round = result.catalog.parts.find(part => part.id === 'head_round_dome')
    expect(round?.composition?.mode).toBe('interface')
    expect(round?.composition?.mode === 'interface' ? Object.keys(round.composition.variantsByRig).sort() : []).toEqual(['biped', 'blob', 'floating'])
    expect(result.catalog.parts.find(part => part.id === 'head_mushroom_cap')).toBeDefined()
    expect(result.sourceIndex.sources.find(source => source.sourceId === 'head_round_dome')).toBeUndefined()
    for (const rigId of ['biped', 'blob', 'floating']) {
      expect(result.sourceIndex.sources.find(source => source.sourceId === `head_round_dome:${rigId}`)).toEqual(expect.objectContaining({
        kind: 'interface-structural',
        promptId: 'task7-body-head-connection-aware',
        promptPath: 'asset-source/v0.3.0/prompts/task7-body-head-prompts.json',
      }))
    }
  })
})
