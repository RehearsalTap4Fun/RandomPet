import { buildCandidates, checkPartCompatibility } from './candidates.js'
import { validateStructuralSelections } from './connector-compatibility.js'
import { validateCatalogStructure } from './catalog-validation.js'
import {
  GENOME_LAYERS,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type GenomeLayer,
  type GenerationRequest,
  type GenerationResult,
  type RigId,
  type VisualPartDefinition,
  type VisualSelection,
  type VisualSlotId,
} from './contracts.js'
import {
  genomeFromVisualLayers,
  genomeLayerSeed,
  type VisualGenomeLayers,
} from './genome.js'
import { createRng, slotSeedParts } from './prng.js'
import { applyModifiers } from './modifiers.js'
import { projectSemanticTraits } from './projection.js'
import { selectRigId } from './rig-selection.js'
import {
  compositionAllowanceForSlot,
  planComposition,
  rendererVersionForCatalog,
  strongFeatureCountForSelections,
  validateCompositionSelections,
  type CompositionAllowance,
} from './composition.js'

export const GENERATION_ORDER: readonly VisualSlotId[] = [
  'bodyFrame', 'headShape', 'eyes', 'mouthShape', 'oralDetail',
  'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
  'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
]

const LEGACY_GENERATION_ORDER: readonly VisualSlotId[] = [
  'bodyFrame', 'colorScheme', 'surfaceMaterial', 'pattern',
  'headShape', 'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
  'eyes', 'mouthShape', 'oralDetail', 'effect',
]

export function generationOrderForCatalog(catalog: Catalog): readonly VisualSlotId[] {
  return catalog.compositionPolicy === undefined ? LEGACY_GENERATION_ORDER : GENERATION_ORDER
}

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function defaultRig(catalog: Catalog): RigId {
  return catalog.rigs[0]?.id ?? 'blob'
}

type VisualLayerRequest = Pick<GenerationRequest, 'seed' | 'themeId' | 'slotRolls' | 'lockedSelections'>

function lockedBodyRig(request: VisualLayerRequest, catalog: Catalog): RigId | undefined {
  const lockedBodyId = request.lockedSelections?.bodyFrame
  if (lockedBodyId === undefined) return undefined
  const lockedBody = catalog.parts.find(part => part.slotId === 'bodyFrame' && part.id === lockedBodyId)
  return lockedBody?.compatibleRigs.find(rigId => catalog.rigs.some(rig => rig.id === rigId))
}

function selectionFor(part: VisualPartDefinition, rigId: RigId): VisualSelection {
  return { partId: part.id, rigId }
}

export function resolveSlot(
  request: VisualLayerRequest,
  catalog: Catalog,
  slotId: VisualSlotId,
  rigId: RigId,
  visualSlots: Partial<Record<VisualSlotId, VisualSelection>>,
  diagnostics: Diagnostic[],
  composition?: CompositionAllowance,
): VisualSelection {
  const lockedPartId = request.lockedSelections?.[slotId]
  if (lockedPartId !== undefined) {
    const lockedPart = catalog.parts.find(part => part.slotId === slotId && part.id === lockedPartId)
    if (lockedPart === undefined) {
      diagnostics.push(error('LOCK_NOT_FOUND', ['visualSlots', slotId], `Locked part ${lockedPartId} does not exist in ${slotId}.`))
      return { partId: lockedPartId, rigId }
    }
    if (!checkPartCompatibility(lockedPart, rigId, catalog, visualSlots, request.themeId)) {
      diagnostics.push(error('LOCK_INCOMPATIBLE', ['visualSlots', slotId], `Locked part ${lockedPartId} is incompatible with the current selections.`))
    }
    return selectionFor(lockedPart, rigId)
  }

  const rerollIndex = request.slotRolls?.[slotId] ?? 0
  const result = buildCandidates({
    catalog,
    slotId,
    themeId: request.themeId,
    rigId,
    selections: visualSlots,
    rng: createRng(slotSeedParts(request.seed, request.themeId, slotId, rerollIndex)),
    ...(composition === undefined ? {} : { composition }),
  })
  if (composition?.motifMode === 'dominant' && result.trace.themeFallback) {
    diagnostics.push({
      severity: 'warning',
      code: 'COMPOSITION_THEME_FALLBACK',
      path: ['visualSlots', slotId],
      message: `No dominant ${request.themeId} motif candidate is available for ${slotId}; using a compatible fallback.`,
    })
  }
  if (result.part === null) {
    diagnostics.push(error('NO_COMPATIBLE_CANDIDATE', ['visualSlots', slotId], `No compatible weighted candidate exists for ${slotId}.`))
    return { partId: `missing_${slotId}`, rigId }
  }
  return selectionFor(result.part, rigId)
}

function reservedLockedStrongFeatures(
  request: VisualLayerRequest,
  visualSlots: Partial<Record<VisualSlotId, VisualSelection>>,
  catalog: Catalog,
): number {
  const unresolvedLockedSelections = Object.fromEntries(VISUAL_SLOT_IDS.flatMap(slotId => {
    const partId = request.lockedSelections?.[slotId]
    return partId !== undefined && visualSlots[slotId] === undefined ? [[slotId, { partId }]] : []
  })) as Partial<Record<VisualSlotId, { partId: string }>>
  return strongFeatureCountForSelections(unresolvedLockedSelections, catalog)
}

export interface GeneratedVisualLayer {
  visualSlots: Record<VisualSlotId, VisualSelection>
  diagnostics: Diagnostic[]
  rigId: RigId
}

export function generateVisualLayer(
  request: Pick<GenerationRequest, 'seed' | 'themeId' | 'slotRolls' | 'lockedSelections'>,
  catalog: Catalog,
): GeneratedVisualLayer {
  const diagnostics: Diagnostic[] = []
  const selectedRig = lockedBodyRig(request, catalog) ?? selectRigId({ ...request, mode: 'normal' }, catalog)
  const rigId = selectedRig ?? defaultRig(catalog)
  if (selectedRig === null) {
    diagnostics.push(error('NO_COMPATIBLE_RIG', ['visualSlots', 'bodyFrame'], 'No legal bodyFrame rig is available in the catalog.'))
  }
  const compositionPlan = planComposition(request.seed, request.themeId, rigId, catalog)
  const visualSlots: Partial<Record<VisualSlotId, VisualSelection>> = {}
  for (const slotId of generationOrderForCatalog(catalog)) {
    const strongFeaturesUsed = strongFeatureCountForSelections(visualSlots, catalog)
      + reservedLockedStrongFeatures(request, visualSlots, catalog)
    visualSlots[slotId] = resolveSlot(
      request,
      catalog,
      slotId,
      rigId,
      visualSlots,
      diagnostics,
      compositionAllowanceForSlot(slotId, compositionPlan, strongFeaturesUsed),
    )
  }
  return {
    visualSlots: visualSlots as Record<VisualSlotId, VisualSelection>,
    diagnostics,
    rigId,
  }
}

function mapLayerDiagnostics(diagnostics: readonly Diagnostic[], layer: GenomeLayer): Diagnostic[] {
  if (layer === 'P') return [...diagnostics]
  return diagnostics.map(diagnostic => (
    diagnostic.path[0] === 'visualSlots' && typeof diagnostic.path[1] === 'string'
      ? { ...diagnostic, path: ['genome', 'genes', diagnostic.path[1], layer, ...diagnostic.path.slice(2)] }
      : diagnostic
  ))
}

export function generateMonster(request: GenerationRequest, catalog: Catalog): GenerationResult {
  const diagnostics: Diagnostic[] = [...validateCatalogStructure(catalog)]
  const theme = catalog.themes.find(item => item.id === request.themeId)
  if (theme === undefined) {
    diagnostics.push(error('THEME_NOT_FOUND', ['themeId'], `Theme ${request.themeId} is not present in the catalog.`))
  }

  const layers = {} as VisualGenomeLayers
  for (const layer of GENOME_LAYERS) {
    const hidden = layer !== 'P'
    const generatedLayer = generateVisualLayer({
      seed: genomeLayerSeed(request.seed, layer),
      themeId: request.themeId,
      ...(request.slotRolls === undefined ? {} : { slotRolls: request.slotRolls }),
      ...(hidden || request.lockedSelections === undefined ? {} : { lockedSelections: request.lockedSelections }),
    }, catalog)
    layers[layer] = generatedLayer.visualSlots
    diagnostics.push(...mapLayerDiagnostics(generatedLayer.diagnostics, layer))
  }
  const completeVisualSlots = layers.P
  const genome = genomeFromVisualLayers(layers)
  const rigId = completeVisualSlots.bodyFrame.rigId
  const compositionPlan = planComposition(request.seed, request.themeId, rigId, catalog)
  const slotRolls = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
    slotId,
    request.slotRolls?.[slotId] ?? 0,
  ])) as Record<VisualSlotId, number>
  const modifiers = applyModifiers(request.mode, catalog, {
    mutation: createRng([request.seed, request.themeId, 'mutation-roll']),
    aberration: createRng([request.seed, request.themeId, 'aberration-roll']),
  })
  if (request.mode === 'mutation' && modifiers.mutation === null) {
    diagnostics.push(error('MODIFIER_NOT_FOUND', ['mutation'], 'No weighted mutation is available in the catalog.'))
  }
  if (request.mode === 'aberration' && modifiers.aberrations.length === 0) {
    diagnostics.push(error('MODIFIER_NOT_FOUND', ['aberrations'], 'No weighted aberration is available in the catalog.'))
  }
  if (request.mode === 'aberration' && modifiers.aberrations[0]?.id !== undefined) {
    const selected = catalog.modifiers.find(modifier => modifier.id === modifiers.aberrations[0]?.id)
    if (selected?.requiresMutation && modifiers.mutation === null) {
      diagnostics.push(error('MODIFIER_NOT_FOUND', ['mutation'], 'The selected aberration requires a weighted mutation.'))
    }
  }
  const spec = {
    schemaVersion: '0.1.0',
    catalogVersion: catalog.version,
    rendererVersion: rendererVersionForCatalog(catalog),
    seed: request.seed,
    themeId: request.themeId,
    palette: theme?.palette ?? { primary: '#000000', secondary: '#000000', accent: '#000000' },
    slotRolls,
    visualSlots: completeVisualSlots,
    genome,
    semanticTraits: projectSemanticTraits(completeVisualSlots, request.seed, catalog),
    mutation: modifiers.mutation,
    aberrations: modifiers.aberrations,
  }
  diagnostics.push(...validateCompositionSelections(spec, catalog, compositionPlan))
  diagnostics.push(...validateStructuralSelections(spec, catalog))
  return {
    spec,
    diagnostics,
    blocked: diagnostics.some(item => item.severity === 'error'),
    affectedSlots: [...generationOrderForCatalog(catalog)],
  }
}
