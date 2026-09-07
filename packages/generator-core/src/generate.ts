import { buildCandidates, checkPartCompatibility } from './candidates.js'
import { validateStructuralSelections } from './connector-compatibility.js'
import { validateCatalogStructure } from './catalog-validation.js'
import {
  GENOME_LAYERS,
  VISUAL_SLOT_IDS,
  isLocalVisualSlot,
  type Catalog,
  type Diagnostic,
  type GenomeLayer,
  type GenerationRequest,
  type GenerationResult,
  type MonsterSpec,
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
import { planSpecialFeature, resolveArchetype } from './archetype-plan.js'
import { applyAnatomyBundle, selectAnatomyBundle } from './anatomy-bundle-generation.js'
import { validateAnatomyBundleSpec } from './anatomy-bundle.js'
import {
  compositionAllowanceForSlot,
  planComposition,
  rendererVersionForCatalog,
  strongFeatureCountForSelections,
  strongNonFacialFeatureCountForSelections,
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

function blockedGenerationResult(
  request: GenerationRequest,
  catalog: Catalog,
  diagnostics: Diagnostic[],
): GenerationResult {
  const rigId = defaultRig(catalog)
  const visualSlots = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
    slotId,
    { partId: `missing_${slotId}`, rigId },
  ])) as Record<VisualSlotId, VisualSelection>
  const theme = catalog.themes.find(item => item.id === request.themeId)
  return {
    spec: {
      schemaVersion: catalog.version === '0.6.0' ? '0.2.0' : '0.1.0',
      catalogVersion: catalog.version,
      rendererVersion: rendererVersionForCatalog(catalog),
      seed: request.seed,
      themeId: request.themeId,
      palette: theme?.palette ?? { primary: '#000000', secondary: '#000000', accent: '#000000' },
      slotRolls: Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
        slotId,
        request.slotRolls?.[slotId] ?? 0,
      ])) as Record<VisualSlotId, number>,
      visualSlots,
      semanticTraits: projectSemanticTraits(visualSlots, request.seed, catalog),
      mutation: null,
      aberrations: [],
      ...(catalog.version === '0.6.0' && request.archetypeId !== undefined ? { archetypeId: request.archetypeId } : {}),
    },
    diagnostics,
    blocked: true,
    affectedSlots: [...generationOrderForCatalog(catalog)],
  }
}

type VisualLayerRequest = Pick<GenerationRequest, 'seed' | 'themeId' | 'mode' | 'archetypeId' | 'slotRolls' | 'lockedSelections'>

function lockedBodyRig(request: VisualLayerRequest, catalog: Catalog): RigId | undefined {
  const lockedBodyId = request.lockedSelections?.bodyFrame
  if (lockedBodyId === undefined) return undefined
  const lockedBody = catalog.parts.find(part => part.slotId === 'bodyFrame' && part.id === lockedBodyId)
  return lockedBody?.compatibleRigs.find(rigId => catalog.rigs.some(rig => rig.id === rigId))
}

function selectionFor(part: VisualPartDefinition, rigId: RigId): VisualSelection {
  return { partId: part.id, rigId }
}

function supportsLockedFelineSelection(
  request: VisualLayerRequest,
  catalog: Catalog,
  slotId: VisualSlotId,
  part: VisualPartDefinition,
): boolean {
  if (catalog.version !== '0.6.0') return true
  const archetype = resolveArchetype(request, catalog)
  if (archetype === null || part.archetypeIds?.includes(archetype.id) !== true) return false
  const plan = planSpecialFeature(request.seed, request.themeId, request.mode ?? 'normal', archetype, catalog)
  return plan.slotId === slotId ? part.featureTier === 'special' : part.featureTier !== 'special'
}

export function resolveSlot(
  request: VisualLayerRequest,
  catalog: Catalog,
  slotId: VisualSlotId,
  rigId: RigId,
  visualSlots: Partial<Record<VisualSlotId, VisualSelection>>,
  diagnostics: Diagnostic[],
  composition?: CompositionAllowance,
  allowedPartIds?: readonly string[],
): VisualSelection {
  const lockedPartId = request.lockedSelections?.[slotId]
  if (lockedPartId !== undefined) {
    const lockedPart = catalog.parts.find(part => part.slotId === slotId && part.id === lockedPartId)
    if (lockedPart === undefined) {
      diagnostics.push(error('LOCK_NOT_FOUND', ['visualSlots', slotId], `Locked part ${lockedPartId} does not exist in ${slotId}.`))
      return { partId: lockedPartId, rigId }
    }
    if (
      !checkPartCompatibility(lockedPart, rigId, catalog, visualSlots, request.themeId)
      || (allowedPartIds !== undefined && !allowedPartIds.includes(lockedPart.id))
      || !supportsLockedFelineSelection(request, catalog, slotId, lockedPart)
    ) {
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
    ...(request.archetypeId === undefined ? {} : { archetypeId: request.archetypeId }),
    ...(allowedPartIds === undefined ? {} : { allowedPartIds }),
    specialFeature: (() => {
      const archetype = resolveArchetype(request, catalog)
      const specialPlan = planSpecialFeature(request.seed, request.themeId, request.mode ?? 'normal', archetype, catalog)
      return { required: specialPlan.slotId === slotId, forbidden: specialPlan.slotId !== slotId }
    })(),
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

function generateAnatomyBundleVisualLayer(
  request: VisualLayerRequest,
  catalog: Catalog,
  diagnostics: Diagnostic[],
  selectedBundle = selectAnatomyBundle(request as GenerationRequest, catalog),
): { visualSlots: Record<VisualSlotId, VisualSelection>; anatomyBundleId: string | undefined } {
  const bundle = selectedBundle
  if (bundle === null) {
    diagnostics.push(error('ANATOMY_BUNDLE_UNAVAILABLE', ['anatomyBundleId'], 'No anatomy bundle is available for this request.'))
    return { visualSlots: {} as Record<VisualSlotId, VisualSelection>, anatomyBundleId: undefined }
  }
  const visualSlots: Partial<Record<VisualSlotId, VisualSelection>> = {
    ...Object.fromEntries(Object.entries(bundle.derivedSlots).map(([slotId, partId]) => [
      slotId,
      { partId, rigId: bundle.rigId },
    ])),
  }
  for (const slotId of generationOrderForCatalog(catalog)) {
    if (slotId in bundle.derivedSlots) continue
    if (!isLocalVisualSlot(slotId)) continue
    visualSlots[slotId] = resolveSlot(
      request,
      catalog,
      slotId,
      bundle.rigId,
      visualSlots,
      diagnostics,
      undefined,
      bundle.allowedTraitPools[slotId],
    )
  }
  return {
    visualSlots: visualSlots as Record<VisualSlotId, VisualSelection>,
    anatomyBundleId: bundle.id,
  }
}

function unresolvedLockedSelections(
  request: VisualLayerRequest,
  visualSlots: Partial<Record<VisualSlotId, VisualSelection>>,
): Partial<Record<VisualSlotId, { partId: string }>> {
  return Object.fromEntries(VISUAL_SLOT_IDS.flatMap(slotId => {
    const partId = request.lockedSelections?.[slotId]
    return partId !== undefined && visualSlots[slotId] === undefined ? [[slotId, { partId }]] : []
  })) as Partial<Record<VisualSlotId, { partId: string }>>
}

export interface GeneratedVisualLayer {
  visualSlots: Record<VisualSlotId, VisualSelection>
  diagnostics: Diagnostic[]
  rigId: RigId
}

export function generateVisualLayer(
  request: Pick<GenerationRequest, 'seed' | 'themeId' | 'mode' | 'archetypeId' | 'slotRolls' | 'lockedSelections'>,
  catalog: Catalog,
): GeneratedVisualLayer {
  const diagnostics: Diagnostic[] = []
  const selectedRig = lockedBodyRig(request, catalog) ?? selectRigId({ ...request, mode: request.mode ?? 'normal' }, catalog)
  const rigId = selectedRig ?? defaultRig(catalog)
  if (selectedRig === null) {
    diagnostics.push(error('NO_COMPATIBLE_RIG', ['visualSlots', 'bodyFrame'], 'No legal bodyFrame rig is available in the catalog.'))
  }
  const compositionPlan = planComposition(request.seed, request.themeId, rigId, catalog)
  const visualSlots: Partial<Record<VisualSlotId, VisualSelection>> = {}
  for (const slotId of generationOrderForCatalog(catalog)) {
    const unresolvedLocks = unresolvedLockedSelections(request, visualSlots)
    const strongFeaturesUsed = strongFeatureCountForSelections(visualSlots, catalog)
      + strongFeatureCountForSelections(unresolvedLocks, catalog)
    const strongNonFacialFeaturesUsed = strongNonFacialFeatureCountForSelections(visualSlots, catalog)
      + strongNonFacialFeatureCountForSelections(unresolvedLocks, catalog)
    visualSlots[slotId] = resolveSlot(
      request,
      catalog,
      slotId,
      rigId,
      visualSlots,
      diagnostics,
      compositionAllowanceForSlot(
        slotId,
        compositionPlan,
        strongFeaturesUsed,
        strongNonFacialFeaturesUsed,
      ),
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
  const archetype = resolveArchetype(request, catalog)
  if (catalog.version === '0.6.0' && archetype === null) {
    diagnostics.push(error('ARCHETYPE_UNSUPPORTED', ['archetypeId'], `Archetype ${request.archetypeId ?? 'missing'} is not supported by catalog ${catalog.version}.`))
  }
  const theme = catalog.themes.find(item => item.id === request.themeId)
  if (theme === undefined) {
    diagnostics.push(error('THEME_NOT_FOUND', ['themeId'], `Theme ${request.themeId} is not present in the catalog.`))
  }

  const anatomyBundle = catalog.version === '0.6.0' && archetype !== null
    ? selectAnatomyBundle(request, catalog)
    : null
  if (catalog.version === '0.6.0' && archetype !== null && anatomyBundle === null) {
    diagnostics.push(error('ANATOMY_BUNDLE_UNAVAILABLE', ['anatomyBundleId'], 'No anatomy bundle is available for this request.'))
  }
  if (catalog.version === '0.6.0' && diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return blockedGenerationResult(request, catalog, diagnostics)
  }

  const layers = {} as VisualGenomeLayers
  let anatomyBundleId: string | undefined
  if (catalog.version === '0.6.0' && archetype !== null) {
    for (const layer of GENOME_LAYERS) {
      const hidden = layer !== 'P'
      const generatedLayer = generateAnatomyBundleVisualLayer({
        seed: genomeLayerSeed(request.seed, layer),
        themeId: request.themeId,
        mode: hidden ? 'normal' : request.mode,
        archetypeId: archetype.id,
        ...(request.slotRolls === undefined ? {} : { slotRolls: request.slotRolls }),
        ...(hidden || request.lockedSelections === undefined ? {} : { lockedSelections: request.lockedSelections }),
      }, catalog, diagnostics, anatomyBundle)
      layers[layer] = generatedLayer.visualSlots
      if (!hidden) anatomyBundleId = generatedLayer.anatomyBundleId
    }
  } else {
    for (const layer of GENOME_LAYERS) {
      const hidden = layer !== 'P'
      const generatedLayer = generateVisualLayer({
        seed: genomeLayerSeed(request.seed, layer),
        themeId: request.themeId,
        mode: hidden ? 'normal' : request.mode,
        ...(request.archetypeId === undefined ? {} : { archetypeId: request.archetypeId }),
        ...(request.slotRolls === undefined ? {} : { slotRolls: request.slotRolls }),
        ...(hidden || request.lockedSelections === undefined ? {} : { lockedSelections: request.lockedSelections }),
      }, catalog)
      layers[layer] = generatedLayer.visualSlots
      diagnostics.push(...mapLayerDiagnostics(generatedLayer.diagnostics, layer))
    }
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
  let spec: MonsterSpec = {
    schemaVersion: catalog.version === '0.6.0' ? '0.2.0' : '0.1.0',
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
    ...(catalog.version === '0.6.0' && request.archetypeId !== undefined ? { archetypeId: request.archetypeId } : {}),
    ...(anatomyBundleId === undefined ? {} : { anatomyBundleId }),
  }
  if (anatomyBundleId !== undefined) {
    const bundle = catalog.anatomyBundles?.find(candidate => candidate.id === anatomyBundleId)
    if (bundle !== undefined) spec = applyAnatomyBundle(spec, bundle)
  }
  diagnostics.push(...validateCompositionSelections(spec, catalog, compositionPlan))
  diagnostics.push(...validateStructuralSelections(spec, catalog))
  if (catalog.version === '0.6.0') diagnostics.push(...validateAnatomyBundleSpec(spec, catalog))
  return {
    spec,
    diagnostics,
    blocked: diagnostics.some(item => item.severity === 'error'),
    affectedSlots: [...generationOrderForCatalog(catalog)],
  }
}
