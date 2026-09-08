import { checkPartCompatibility } from './candidates.js'
import {
  GENOME_LAYERS,
  GENOME_VERSION,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type GenomeLayer,
  type MonsterSpec,
  type ParseResult,
  type VisualPartDefinition,
  type VisualSelection,
  type VisualSlotId,
} from './contracts.js'
import { validateStructuralSelections } from './connector-compatibility.js'
import {
  planComposition,
  validateCompositionSelections,
} from './composition.js'
import { generationOrderForCatalog } from './generate.js'
import { genomeLayerSeed } from './genome.js'
import { projectSemanticTraits } from './projection.js'

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function genePath(slotId: VisualSlotId, layer: GenomeLayer): string[] {
  return ['genome', 'genes', slotId, layer]
}

function versionDiagnostic(version: string): Diagnostic {
  return error(
    'SPEC_GENOME_VERSION_UNSUPPORTED',
    ['genome', 'genomeVersion'],
    `Monster genome version ${version} is unsupported; expected ${GENOME_VERSION}.`,
  )
}

function resolveLayerParts(
  spec: MonsterSpec & { genome: NonNullable<MonsterSpec['genome']> },
  layer: GenomeLayer,
  catalog: Catalog,
): ParseResult<Record<VisualSlotId, VisualPartDefinition>> {
  const parts = {} as Record<VisualSlotId, VisualPartDefinition>
  const diagnostics: Diagnostic[] = []
  for (const slotId of VISUAL_SLOT_IDS) {
    const partId = spec.genome.genes[slotId][layer]
    const part = catalog.parts.find(candidate => candidate.id === partId)
    if (part === undefined) {
      diagnostics.push(error(
        'SPEC_GENE_PART_MISSING',
        genePath(slotId, layer),
        `Catalog ${catalog.version} has no gene part ${partId} for ${slotId}.`,
      ))
      continue
    }
    if (part.slotId !== slotId) {
      diagnostics.push(error(
        'SPEC_GENE_PART_SLOT_MISMATCH',
        genePath(slotId, layer),
        `Gene part ${part.id} belongs to ${part.slotId}, not ${slotId}.`,
      ))
      continue
    }
    if (
      (catalog.version === '0.6.0' || catalog.version === '0.8.0')
      && part.archetypeIds?.includes(spec.archetypeId!) !== true
    ) {
      diagnostics.push(error(
        'SPEC_ARCHETYPE_PART_MISMATCH',
        genePath(slotId, layer),
        `Gene part ${part.id} is not compatible with archetype ${spec.archetypeId ?? 'missing'}.`,
      ))
      continue
    }
    parts[slotId] = part
  }
  return diagnostics.length === 0 ? { ok: true, value: parts } : { ok: false, diagnostics }
}

function firstDiagnosticSlot(
  diagnostics: readonly Diagnostic[],
  fallback: VisualSlotId,
): VisualSlotId {
  for (const diagnostic of diagnostics) {
    const slotId = diagnostic.path[0] === 'visualSlots' ? diagnostic.path[1] : undefined
    if (VISUAL_SLOT_IDS.includes(slotId as VisualSlotId)) return slotId as VisualSlotId
  }
  return fallback
}

export function materializeGenomeLayer(
  spec: MonsterSpec,
  layer: GenomeLayer,
  catalog: Catalog,
): ParseResult<Record<VisualSlotId, VisualSelection>> | null {
  if (spec.genome === undefined) return null
  if (spec.genome.genomeVersion !== GENOME_VERSION) {
    return { ok: false, diagnostics: [versionDiagnostic(spec.genome.genomeVersion)] }
  }

  if (layer === 'P') {
    const diagnostics = VISUAL_SLOT_IDS.flatMap(slotId => {
      const genePartId = spec.genome!.genes[slotId].P
      const phenotypePartId = spec.visualSlots[slotId].partId
      return genePartId === phenotypePartId ? [] : [error(
        'SPEC_GENOME_P_MISMATCH',
        genePath(slotId, layer),
        `Dominant gene ${genePartId} does not match phenotype part ${phenotypePartId}.`,
      )]
    })
    if (diagnostics.length > 0) return { ok: false, diagnostics }
  }

  const storedSpec = spec as MonsterSpec & { genome: NonNullable<MonsterSpec['genome']> }
  const resolved = resolveLayerParts(storedSpec, layer, catalog)
  if (!resolved.ok) return resolved

  const order = generationOrderForCatalog(catalog)
  let firstFailingSlot = order[0] ?? VISUAL_SLOT_IDS[0]
  let recordedFailure = false
  for (const rig of catalog.rigs) {
    const visualSlots: Partial<Record<VisualSlotId, VisualSelection>> = {}
    let failingSlot: VisualSlotId | undefined
    for (const slotId of order) {
      const part = resolved.value[slotId]
      if (
        !part.compatibleRigs.includes(rig.id)
        || !checkPartCompatibility(part, rig.id, catalog, visualSlots, spec.themeId)
      ) {
        failingSlot = slotId
        break
      }
      visualSlots[slotId] = { partId: part.id, rigId: rig.id }
    }
    if (failingSlot !== undefined) {
      if (!recordedFailure) {
        firstFailingSlot = failingSlot
        recordedFailure = true
      }
      continue
    }

    const completeVisualSlots = visualSlots as Record<VisualSlotId, VisualSelection>
    const layerSeed = genomeLayerSeed(spec.seed, layer)
    const { genome: _genome, ...genomeFreeSpec } = spec
    const temporarySpec: MonsterSpec = {
      ...genomeFreeSpec,
      seed: layerSeed,
      visualSlots: completeVisualSlots,
      semanticTraits: projectSemanticTraits(completeVisualSlots, layerSeed, catalog),
    }
    const compatibilityDiagnostics = [
      ...validateCompositionSelections(
        temporarySpec,
        catalog,
        planComposition(layerSeed, spec.themeId, rig.id, catalog),
      ),
      ...validateStructuralSelections(temporarySpec, catalog),
    ].filter(diagnostic => diagnostic.severity === 'error')
    if (compatibilityDiagnostics.length === 0) {
      return { ok: true, value: completeVisualSlots }
    }
    if (!recordedFailure) {
      firstFailingSlot = firstDiagnosticSlot(compatibilityDiagnostics, firstFailingSlot)
      recordedFailure = true
    }
  }

  return {
    ok: false,
    diagnostics: [error(
      'SPEC_GENOME_LAYER_INCOMPATIBLE',
      genePath(firstFailingSlot, layer),
      `Genome layer ${layer} has no common compatible rig in catalog ${catalog.version}.`,
    )],
  }
}

export function validateMonsterGenome(spec: MonsterSpec, catalog: Catalog): Diagnostic[] {
  if (spec.genome === undefined) return []
  if (spec.genome.genomeVersion !== GENOME_VERSION) {
    return [versionDiagnostic(spec.genome.genomeVersion)]
  }

  const diagnostics: Diagnostic[] = []
  for (const layer of GENOME_LAYERS) {
    const materialized = materializeGenomeLayer(spec, layer, catalog)
    if (materialized !== null && !materialized.ok) diagnostics.push(...materialized.diagnostics)
  }
  return diagnostics
}
