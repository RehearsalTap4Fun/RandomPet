import {
  GENOME_LAYERS,
  GENOME_VERSION,
  VISUAL_SLOT_IDS,
  type GenomeLayer,
  type MonsterGenome,
  type SlotGenes,
  type VisualSelection,
  type VisualSlotId,
} from './contracts.js'

export type VisualGenomeLayers = Record<
  GenomeLayer,
  Record<VisualSlotId, VisualSelection>
>

export function genomeLayerSeed(seed: string, layer: GenomeLayer): string {
  if (layer === 'P') return seed
  return JSON.stringify(['qmonster-genome', GENOME_VERSION, seed, layer])
}

export function genomeFromVisualLayers(layers: VisualGenomeLayers): MonsterGenome {
  const genes = {} as Record<VisualSlotId, SlotGenes>
  for (const slotId of VISUAL_SLOT_IDS) {
    const slotGenes = {} as SlotGenes
    for (const layer of GENOME_LAYERS) {
      slotGenes[layer] = layers[layer][slotId].partId
    }
    genes[slotId] = slotGenes
  }
  return { genomeVersion: GENOME_VERSION, genes }
}

export function partIdsForGenomeLayer(
  genome: MonsterGenome,
  layer: GenomeLayer,
): Record<VisualSlotId, string> {
  const partIds = {} as Record<VisualSlotId, string>
  for (const slotId of VISUAL_SLOT_IDS) {
    partIds[slotId] = genome.genes[slotId][layer]
  }
  return partIds
}

export function syncDominantGenes(
  genome: MonsterGenome,
  visualSlots: Record<VisualSlotId, VisualSelection>,
  affectedSlots: readonly VisualSlotId[],
): MonsterGenome {
  const affected = new Set(affectedSlots)
  const genes = {} as Record<VisualSlotId, SlotGenes>
  for (const slotId of VISUAL_SLOT_IDS) {
    genes[slotId] = {
      P: affected.has(slotId) ? visualSlots[slotId].partId : genome.genes[slotId].P,
      H1: genome.genes[slotId].H1,
      H2: genome.genes[slotId].H2,
      H3: genome.genes[slotId].H3,
    }
  }
  return { genomeVersion: genome.genomeVersion, genes }
}
