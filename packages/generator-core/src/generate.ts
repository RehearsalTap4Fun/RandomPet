import { buildCandidates, checkPartCompatibility } from './candidates.js'
import { validateCatalogStructure } from './catalog-validation.js'
import {
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type GenerationRequest,
  type GenerationResult,
  type RigId,
  type VisualPartDefinition,
  type VisualSelection,
  type VisualSlotId,
} from './contracts.js'
import { createRng, slotSeedParts } from './prng.js'
import { projectSemanticTraits } from './projection.js'

export const GENERATION_ORDER: readonly VisualSlotId[] = [
  'bodyFrame', 'colorScheme', 'surfaceMaterial', 'pattern',
  'headShape', 'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
  'eyes', 'mouthShape', 'oralDetail', 'effect',
]

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function defaultRig(catalog: Catalog): RigId {
  return catalog.rigs[0]?.id ?? 'blob'
}

function selectionFor(part: VisualPartDefinition, rigId: RigId): VisualSelection {
  return { partId: part.id, rigId }
}

export function resolveSlot(
  request: GenerationRequest,
  catalog: Catalog,
  slotId: VisualSlotId,
  rigId: RigId,
  visualSlots: Partial<Record<VisualSlotId, VisualSelection>>,
  diagnostics: Diagnostic[],
): VisualSelection {
  const lockedPartId = request.lockedSelections?.[slotId]
  if (lockedPartId !== undefined) {
    const lockedPart = catalog.parts.find(part => part.slotId === slotId && part.id === lockedPartId)
    if (lockedPart === undefined) {
      diagnostics.push(error('LOCK_NOT_FOUND', ['visualSlots', slotId], `Locked part ${lockedPartId} does not exist in ${slotId}.`))
      return { partId: lockedPartId, rigId }
    }
    if (!checkPartCompatibility(lockedPart, rigId, catalog, visualSlots)) {
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
  })
  if (result.part === null) {
    diagnostics.push(error('NO_COMPATIBLE_CANDIDATE', ['visualSlots', slotId], `No compatible weighted candidate exists for ${slotId}.`))
    return { partId: `missing_${slotId}`, rigId }
  }
  return selectionFor(result.part, rigId)
}

export function generateMonster(request: GenerationRequest, catalog: Catalog): GenerationResult {
  const diagnostics: Diagnostic[] = [...validateCatalogStructure(catalog)]
  const theme = catalog.themes.find(item => item.id === request.themeId)
  if (theme === undefined) {
    diagnostics.push(error('THEME_NOT_FOUND', ['themeId'], `Theme ${request.themeId} is not present in the catalog.`))
  }
  if (request.mode !== 'normal') {
    diagnostics.push(error('GENERATION_MODE_NOT_IMPLEMENTED', ['mode'], `${request.mode} generation is not implemented yet.`))
  }

  let rigId = defaultRig(catalog)
  const lockedBody = request.lockedSelections?.bodyFrame === undefined
    ? undefined
    : catalog.parts.find(part => part.slotId === 'bodyFrame' && part.id === request.lockedSelections?.bodyFrame)
  rigId = lockedBody?.compatibleRigs[0] ?? rigId
  const visualSlots: Partial<Record<VisualSlotId, VisualSelection>> = {}
  for (const slotId of GENERATION_ORDER) {
    visualSlots[slotId] = resolveSlot(request, catalog, slotId, rigId, visualSlots, diagnostics)
  }
  const completeVisualSlots = visualSlots as Record<VisualSlotId, VisualSelection>
  const slotRolls = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
    slotId,
    request.slotRolls?.[slotId] ?? 0,
  ])) as Record<VisualSlotId, number>
  const spec = {
    schemaVersion: '0.1.0',
    catalogVersion: catalog.version,
    rendererVersion: '0.1.0',
    seed: request.seed,
    themeId: request.themeId,
    palette: theme?.palette ?? { primary: '#000000', secondary: '#000000', accent: '#000000' },
    slotRolls,
    visualSlots: completeVisualSlots,
    semanticTraits: projectSemanticTraits(completeVisualSlots, request.seed, catalog),
    mutation: null,
    aberrations: [],
  }
  return { spec, diagnostics, blocked: diagnostics.some(item => item.severity === 'error') }
}
