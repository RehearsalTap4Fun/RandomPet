import { expect, it } from 'vitest'
import { GENOME_LAYERS, VISUAL_SLOT_IDS, type GenomeLayer, type VisualSelection } from './contracts.js'
import {
  genomeFromVisualLayers,
  genomeLayerSeed,
  partIdsForGenomeLayer,
  syncDominantGenes,
} from './genome.js'

function layer(suffix: string): Record<typeof VISUAL_SLOT_IDS[number], VisualSelection> {
  return Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
    slotId,
    { partId: `${slotId}_${suffix}`, rigId: 'blob' as const },
  ])) as Record<typeof VISUAL_SLOT_IDS[number], VisualSelection>
}

it('keeps the dominant seed exact and domain-separates hidden layers', () => {
  expect(genomeLayerSeed('seed', 'P')).toBe('seed')
  const hidden = GENOME_LAYERS.slice(1).map(item => genomeLayerSeed('seed', item))
  expect(new Set(hidden).size).toBe(3)
  expect(hidden).not.toContain('seed')
  expect(genomeLayerSeed('seed', 'H1')).toBe(genomeLayerSeed('seed', 'H1'))
})

it('transposes four complete visual layers into slot genes', () => {
  const layers = Object.fromEntries(GENOME_LAYERS.map(item => [item, layer(item)])) as Record<
    GenomeLayer,
    ReturnType<typeof layer>
  >
  const genome = genomeFromVisualLayers(layers)

  expect(genome.genes.eyes).toEqual({
    P: 'eyes_P', H1: 'eyes_H1', H2: 'eyes_H2', H3: 'eyes_H3',
  })
  expect(partIdsForGenomeLayer(genome, 'H2').mouthShape).toBe('mouthShape_H2')
})

it('synchronizes only affected dominant genes', () => {
  const layers = Object.fromEntries(GENOME_LAYERS.map(item => [item, layer(item)])) as Record<
    GenomeLayer,
    ReturnType<typeof layer>
  >
  const genome = genomeFromVisualLayers(layers)
  const visible = layer('changed')
  const updated = syncDominantGenes(genome, visible, ['eyes', 'mouthShape'])

  expect(updated.genes.eyes.P).toBe('eyes_changed')
  expect(updated.genes.mouthShape.P).toBe('mouthShape_changed')
  expect(updated.genes.tail).toEqual(genome.genes.tail)
  expect(updated.genes.eyes.H1).toBe('eyes_H1')
  expect(genome.genes.eyes.P).toBe('eyes_P')
})
