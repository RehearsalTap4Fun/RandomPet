import { checkPartCompatibility } from './candidates.js'
import {
  connectorExclusions,
  type StructuralPartSelection,
  validateStructuralSelections,
} from './connector-compatibility.js'
import {
  GENOME_LAYERS,
  STRUCTURAL_SLOT_IDS,
  VISUAL_SLOT_IDS,
  isStructuralSlot,
  type GenomeLayer,
} from './contracts.js'
import { generateVisualLayer, generationOrderForCatalog, resolveSlot } from './generate.js'
import type {
  Catalog,
  Diagnostic,
  GenerationRequest,
  GenerationResult,
  MonsterSpec,
  StructuralSlotId,
  VisualSelection,
  VisualSlotId,
} from './contracts.js'
import {
  genomeFromVisualLayers,
  genomeLayerSeed,
  syncDominantGenes,
  type VisualGenomeLayers,
} from './genome.js'
import { materializeGenomeLayer, validateMonsterGenome } from './genome-validation.js'
import { projectSemanticTraits } from './projection.js'
import { descendantsOf, evaluatePartSelection } from './selection.js'
import { selectRigId } from './rig-selection.js'
import {
  compositionAllowanceForSlot,
  planComposition,
  strongFeatureCountForSelections,
  validateCompositionSelections,
} from './composition.js'

export type SlotLocks = Partial<Record<VisualSlotId, boolean>>

export interface RerollSlotRequest {
  spec: MonsterSpec
  slotId: VisualSlotId
  locks: SlotLocks
  catalog: Catalog
}

export interface SelectVisualPartRequest extends RerollSlotRequest {
  partId: string
}

function isInterfaceCatalog(catalog: Catalog): boolean {
  return catalog.version === '0.3.0'
}

function selectedStructuralParts(spec: MonsterSpec, catalog: Catalog) {
  const selected = new Map<StructuralSlotId, StructuralPartSelection>()
  for (const slotId of STRUCTURAL_SLOT_IDS) {
    const selection = spec.visualSlots[slotId]
    const part = catalog.parts.find(candidate => candidate.id === selection.partId && candidate.slotId === slotId)
    if (part !== undefined) selected.set(slotId, { part, rigId: selection.rigId })
  }
  return selected
}

function result(
  spec: MonsterSpec,
  diagnostics: Diagnostic[],
  affectedSlots: VisualSlotId[],
): GenerationResult {
  return { spec, diagnostics, blocked: diagnostics.some(item => item.severity === 'error'), affectedSlots }
}

function orderedAffectedSlots(origin: VisualSlotId, catalog: Catalog): VisualSlotId[] {
  const affected = descendantsOf(origin, catalog)
  if (isInterfaceCatalog(catalog)) {
    for (const slotId of affected) {
      if (slotId !== origin && isStructuralSlot(slotId)) affected.delete(slotId)
    }
  }
  affected.add(origin)
  return generationOrderForCatalog(catalog).filter(slotId => affected.has(slotId))
}

function cloneSpec(spec: MonsterSpec): MonsterSpec {
  return structuredClone(spec)
}

function generationContext(
  spec: MonsterSpec,
  affected: Set<VisualSlotId>,
  slotId: VisualSlotId,
  catalog: Catalog,
): Partial<Record<VisualSlotId, VisualSelection>> {
  const generationOrder = generationOrderForCatalog(catalog)
  const currentIndex = generationOrder.indexOf(slotId)
  return Object.fromEntries(Object.entries(spec.visualSlots).filter(([candidateSlotId]) => {
    const candidate = candidateSlotId as VisualSlotId
    return !affected.has(candidate) || generationOrder.indexOf(candidate) < currentIndex
  })) as Partial<Record<VisualSlotId, VisualSelection>>
}

function compositionAllowanceForReplacement(
  spec: MonsterSpec,
  slotId: VisualSlotId,
  catalog: Catalog,
) {
  const otherSelections = Object.fromEntries(VISUAL_SLOT_IDS.filter(candidate => candidate !== slotId).map(candidate => [
    candidate,
    spec.visualSlots[candidate],
  ])) as Partial<Record<VisualSlotId, VisualSelection>>
  const plan = planComposition(spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, catalog)
  return compositionAllowanceForSlot(slotId, plan, strongFeatureCountForSelections(otherSelections, catalog))
}

function regenerateDescendants(
  spec: MonsterSpec,
  origin: VisualSlotId,
  locks: SlotLocks,
  catalog: Catalog,
  diagnostics: Diagnostic[],
): void {
  const descendants = descendantsOf(origin, catalog)
  if (isInterfaceCatalog(catalog)) {
    for (const slotId of descendants) {
      if (slotId !== origin && isStructuralSlot(slotId)) descendants.delete(slotId)
    }
  }
  const affected = new Set<VisualSlotId>([origin, ...descendants])
  const generationRequest: GenerationRequest = {
    seed: spec.seed,
    themeId: spec.themeId,
    mode: 'normal',
    slotRolls: spec.slotRolls,
  }
  for (const slotId of generationOrderForCatalog(catalog)) {
    if (!descendants.has(slotId)) continue
    if (locks[slotId]) continue
    spec.visualSlots[slotId] = resolveSlot(
      generationRequest,
      catalog,
      slotId,
      spec.visualSlots.bodyFrame.rigId,
      generationContext(spec, affected, slotId, catalog),
      diagnostics,
      compositionAllowanceForReplacement(spec, slotId, catalog),
    )
  }
  for (const slotId of descendants) {
    if (!locks[slotId]) continue
    const selectedPartId = spec.visualSlots[slotId].partId
    spec.visualSlots[slotId] = {
      partId: selectedPartId,
      rigId: spec.visualSlots.bodyFrame.rigId,
    }
    const part = catalog.parts.find(item => item.id === selectedPartId && item.slotId === slotId)
    if (part === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'LOCK_NOT_FOUND',
        path: ['visualSlots', slotId],
        message: `Locked part ${selectedPartId} no longer exists.`,
      })
    } else if (!checkPartCompatibility(part, spec.visualSlots.bodyFrame.rigId, catalog, spec.visualSlots, spec.themeId)) {
      diagnostics.push({
        severity: 'error',
        code: 'LOCK_INCOMPATIBLE',
        path: ['visualSlots', slotId],
        message: `Locked part ${part.id} is incompatible with the changed selection.`,
      })
    }
  }
}

function rerollPhenotypeSlot(request: RerollSlotRequest): GenerationResult {
  const spec = cloneSpec(request.spec)
  const diagnostics: Diagnostic[] = []
  if (request.locks[request.slotId]) {
    diagnostics.push({ severity: 'error', code: 'SLOT_LOCKED', path: ['visualSlots', request.slotId], message: `${request.slotId} is locked.` })
    return result(spec, diagnostics, [request.slotId])
  }
  spec.slotRolls[request.slotId] += 1
  const generationRequest: GenerationRequest = {
    seed: spec.seed,
    themeId: spec.themeId,
    mode: 'normal',
    slotRolls: spec.slotRolls,
  }
  const affectedSlots = orderedAffectedSlots(request.slotId, request.catalog)
  const affected = new Set(affectedSlots)
  if (request.slotId === 'bodyFrame') {
    const rigId = selectRigId(generationRequest, request.catalog)
    if (rigId === null) {
      diagnostics.push({
        severity: 'error',
        code: 'NO_COMPATIBLE_RIG',
        path: ['visualSlots', 'bodyFrame'],
        message: 'No legal bodyFrame rig is available in the catalog.',
      })
    } else {
      spec.visualSlots.bodyFrame.rigId = rigId
    }
  }
  spec.visualSlots[request.slotId] = resolveSlot(
    generationRequest,
    request.catalog,
    request.slotId,
    spec.visualSlots.bodyFrame.rigId,
    generationContext(spec, affected, request.slotId, request.catalog),
    diagnostics,
    compositionAllowanceForReplacement(spec, request.slotId, request.catalog),
  )
  regenerateDescendants(spec, request.slotId, request.locks, request.catalog, diagnostics)
  spec.semanticTraits = projectSemanticTraits(spec.visualSlots, spec.seed, request.catalog)
  diagnostics.push(...validateCompositionSelections(
    spec,
    request.catalog,
    planComposition(spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, request.catalog),
  ))
  diagnostics.push(...validateStructuralSelections(spec, request.catalog))
  if (isInterfaceCatalog(request.catalog) && diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    const rolledBackSpec = cloneSpec(request.spec)
    rolledBackSpec.slotRolls[request.slotId] = spec.slotRolls[request.slotId]
    return result(rolledBackSpec, diagnostics, affectedSlots)
  }
  return result(spec, diagnostics, affectedSlots)
}

function selectPhenotypePart(request: SelectVisualPartRequest): GenerationResult {
  const spec = cloneSpec(request.spec)
  const diagnostics: Diagnostic[] = []
  const part = request.catalog.parts.find(item => item.slotId === request.slotId && item.id === request.partId)
  const evaluation = part === undefined ? null : evaluatePartSelection(part, spec, request.catalog)
  const connectorFailures = part !== undefined && evaluation !== null && evaluation.rigId !== null
    ? connectorExclusions(request.catalog, part, evaluation.rigId, selectedStructuralParts(spec, request.catalog))
    : []
  if (part === undefined || evaluation === null || !evaluation.selectable || evaluation.rigId === null) {
    for (const failure of connectorFailures) {
      diagnostics.push({
        severity: 'error',
        code: failure.result.code,
        path: ['visualSlots', failure.slotId],
        message: failure.result.message,
      })
    }
    if (diagnostics.length > 0) return result(spec, diagnostics, [request.slotId])
    diagnostics.push({
      severity: 'error',
      code: part === undefined ? 'PART_NOT_FOUND' : 'PART_INCOMPATIBLE',
      path: ['visualSlots', request.slotId],
      message: `Part ${request.partId} cannot be selected for ${request.slotId}.`,
    })
    return result(spec, diagnostics, [request.slotId])
  }
  const selection: VisualSelection = { partId: part.id, rigId: evaluation.rigId }
  spec.visualSlots[request.slotId] = selection
  regenerateDescendants(spec, request.slotId, request.locks, request.catalog, diagnostics)
  spec.semanticTraits = projectSemanticTraits(spec.visualSlots, spec.seed, request.catalog)
  diagnostics.push(...validateCompositionSelections(
    spec,
    request.catalog,
    planComposition(spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, request.catalog),
  ))
  diagnostics.push(...validateStructuralSelections(spec, request.catalog))
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return result(cloneSpec(request.spec), diagnostics, orderedAffectedSlots(request.slotId, request.catalog))
  }
  return result(spec, diagnostics, orderedAffectedSlots(request.slotId, request.catalog))
}

function mapHiddenDiagnostics(
  diagnostics: readonly Diagnostic[],
  layer: Exclude<GenomeLayer, 'P'>,
): Diagnostic[] {
  return diagnostics.map(diagnostic => (
    diagnostic.path[0] === 'visualSlots' && typeof diagnostic.path[1] === 'string'
      ? {
          ...diagnostic,
          path: ['genome', 'genes', diagnostic.path[1], layer, ...diagnostic.path.slice(2)],
        }
      : diagnostic
  ))
}

function rollbackReroll(
  request: RerollSlotRequest,
  slotRoll: number,
  diagnostics: Diagnostic[],
  affectedSlots: VisualSlotId[],
): GenerationResult {
  const rolledBackSpec = cloneSpec(request.spec)
  rolledBackSpec.slotRolls[request.slotId] = slotRoll
  return result(rolledBackSpec, diagnostics, affectedSlots)
}

function lockedSelectionsForFullRebuild(
  request: RerollSlotRequest,
): Partial<Record<VisualSlotId, string>> {
  return Object.fromEntries(VISUAL_SLOT_IDS.flatMap(slotId => (
    slotId !== request.slotId && request.locks[slotId]
      ? [[slotId, request.spec.visualSlots[slotId].partId]]
      : []
  ))) as Partial<Record<VisualSlotId, string>>
}

function rerollGenomeBodyFrame(request: RerollSlotRequest): GenerationResult {
  if (request.locks.bodyFrame) return rerollPhenotypeSlot(request)

  const slotRolls = { ...request.spec.slotRolls }
  slotRolls.bodyFrame += 1
  const layers = {} as VisualGenomeLayers
  const diagnostics: Diagnostic[] = []
  for (const layer of GENOME_LAYERS) {
    const hidden = layer !== 'P'
    const generated = generateVisualLayer({
      seed: genomeLayerSeed(request.spec.seed, layer),
      themeId: request.spec.themeId,
      slotRolls,
      ...(hidden ? {} : { lockedSelections: lockedSelectionsForFullRebuild(request) }),
    }, request.catalog)
    layers[layer] = generated.visualSlots
    diagnostics.push(...(hidden
      ? mapHiddenDiagnostics(generated.diagnostics, layer)
      : generated.diagnostics))
  }

  const affectedSlots = [...generationOrderForCatalog(request.catalog)]
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return rollbackReroll(request, slotRolls.bodyFrame, diagnostics, affectedSlots)
  }

  const spec = cloneSpec(request.spec)
  spec.slotRolls = slotRolls
  spec.visualSlots = layers.P
  spec.genome = genomeFromVisualLayers(layers)
  spec.semanticTraits = projectSemanticTraits(spec.visualSlots, spec.seed, request.catalog)
  diagnostics.push(...validateCompositionSelections(
    spec,
    request.catalog,
    planComposition(spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, request.catalog),
  ))
  diagnostics.push(...validateStructuralSelections(spec, request.catalog))
  diagnostics.push(...validateMonsterGenome(spec, request.catalog))
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return rollbackReroll(request, slotRolls.bodyFrame, diagnostics, affectedSlots)
  }
  return result(spec, diagnostics, affectedSlots)
}

function hiddenLayerSpec(
  spec: MonsterSpec,
  layer: Exclude<GenomeLayer, 'P'>,
  visualSlots: Record<VisualSlotId, VisualSelection>,
  catalog: Catalog,
): MonsterSpec {
  const temporary = cloneSpec(spec)
  delete temporary.genome
  temporary.seed = genomeLayerSeed(spec.seed, layer)
  temporary.visualSlots = visualSlots
  temporary.semanticTraits = projectSemanticTraits(visualSlots, temporary.seed, catalog)
  return temporary
}

function rerollGenomeSlot(request: RerollSlotRequest): GenerationResult {
  if (request.slotId === 'bodyFrame') return rerollGenomeBodyFrame(request)

  const phenotype = rerollPhenotypeSlot(request)
  if (phenotype.blocked) {
    if (phenotype.spec.slotRolls[request.slotId] === request.spec.slotRolls[request.slotId]) return phenotype
    return rollbackReroll(
      request,
      phenotype.spec.slotRolls[request.slotId],
      phenotype.diagnostics,
      phenotype.affectedSlots,
    )
  }

  const affectedSlots = orderedAffectedSlots(request.slotId, request.catalog)
  const diagnostics = [...phenotype.diagnostics]
  const genome = structuredClone(request.spec.genome!)
  for (const layer of GENOME_LAYERS.slice(1)) {
    const hiddenLayer = layer as Exclude<GenomeLayer, 'P'>
    const materialized = materializeGenomeLayer(request.spec, hiddenLayer, request.catalog)
    if (materialized === null) throw new Error('Expected a genome layer for a genome-aware reroll.')
    if (!materialized.ok) {
      diagnostics.push(...materialized.diagnostics)
      return rollbackReroll(
        request,
        phenotype.spec.slotRolls[request.slotId],
        diagnostics,
        affectedSlots,
      )
    }
    const hiddenResult = rerollPhenotypeSlot({
      ...request,
      spec: hiddenLayerSpec(request.spec, hiddenLayer, materialized.value, request.catalog),
      locks: {},
    })
    diagnostics.push(...mapHiddenDiagnostics(hiddenResult.diagnostics, hiddenLayer))
    if (hiddenResult.blocked) {
      return rollbackReroll(
        request,
        phenotype.spec.slotRolls[request.slotId],
        diagnostics,
        affectedSlots,
      )
    }
    for (const slotId of affectedSlots) {
      genome.genes[slotId][hiddenLayer] = hiddenResult.spec.visualSlots[slotId].partId
    }
  }

  const spec = phenotype.spec
  spec.genome = syncDominantGenes(genome, spec.visualSlots, affectedSlots)
  const genomeDiagnostics = validateMonsterGenome(spec, request.catalog)
  diagnostics.push(...genomeDiagnostics)
  if (genomeDiagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return rollbackReroll(
      request,
      phenotype.spec.slotRolls[request.slotId],
      diagnostics,
      affectedSlots,
    )
  }
  return result(spec, diagnostics, affectedSlots)
}

function selectGenomeBodyFrame(request: SelectVisualPartRequest): GenerationResult {
  const phenotype = selectPhenotypePart(request)
  if (phenotype.blocked) return phenotype

  const layers = { P: phenotype.spec.visualSlots } as VisualGenomeLayers
  const diagnostics = [...phenotype.diagnostics]
  for (const layer of GENOME_LAYERS.slice(1)) {
    const hiddenLayer = layer as Exclude<GenomeLayer, 'P'>
    const generated = generateVisualLayer({
      seed: genomeLayerSeed(request.spec.seed, hiddenLayer),
      themeId: request.spec.themeId,
      slotRolls: request.spec.slotRolls,
    }, request.catalog)
    layers[hiddenLayer] = generated.visualSlots
    diagnostics.push(...mapHiddenDiagnostics(generated.diagnostics, hiddenLayer))
  }
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return result(cloneSpec(request.spec), diagnostics, phenotype.affectedSlots)
  }

  const spec = phenotype.spec
  spec.genome = genomeFromVisualLayers(layers)
  const genomeDiagnostics = validateMonsterGenome(spec, request.catalog)
  diagnostics.push(...genomeDiagnostics)
  if (genomeDiagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return result(cloneSpec(request.spec), diagnostics, phenotype.affectedSlots)
  }
  return result(spec, diagnostics, phenotype.affectedSlots)
}

export function rerollSlot(request: RerollSlotRequest): GenerationResult {
  if (request.spec.genome === undefined) return rerollPhenotypeSlot(request)
  return rerollGenomeSlot(request)
}

export function selectVisualPart(request: SelectVisualPartRequest): GenerationResult {
  if (request.spec.genome === undefined) return selectPhenotypePart(request)
  if (request.slotId === 'bodyFrame') return selectGenomeBodyFrame(request)

  const phenotype = selectPhenotypePart(request)
  if (phenotype.blocked) return phenotype
  const spec = phenotype.spec
  spec.genome = syncDominantGenes(request.spec.genome, spec.visualSlots, phenotype.affectedSlots)
  const diagnostics = [...phenotype.diagnostics, ...validateMonsterGenome(spec, request.catalog)]
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return result(cloneSpec(request.spec), diagnostics, [])
  }
  return result(spec, diagnostics, phenotype.affectedSlots)
}
