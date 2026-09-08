import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  isAttachmentPartComposition,
  type ApprovedTransform,
  type AnimalArchetypeDefinition,
  type Catalog,
  type Diagnostic,
  type ModifierApplication,
  type ModifierDefinition,
  type ModifierOverrides,
  type MonsterSpec,
  type Palette,
  type SemanticSlotId,
  type SupportedSpecVersions,
  type VisualPartDefinition,
  type VisualSlotId,
} from './contracts.js'
import {
  planComposition,
  rendererVersionForCatalog,
  validateCompositionSelections,
} from './composition.js'
import { validateStructuralSelections } from './connector-compatibility.js'
import { validateMonsterGenome } from './genome-validation.js'
import { resolveAnatomyBundle, validateAnatomyBundleSpec } from './anatomy-bundle.js'
import { resolveSpeciesRig } from './species-rig.js'

export const CURRENT_SPEC_VERSIONS: SupportedSpecVersions = {
  schemaVersion: '0.1.0',
  rendererVersion: '0.1.0',
}

const IDENTITY_TRANSFORM: ApprovedTransform = { scale: 1, mirrorX: false }

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function samePalette(left: Palette | undefined, right: Palette | undefined): boolean {
  return left === right || (
    left !== undefined
    && right !== undefined
    && left.primary === right.primary
    && left.secondary === right.secondary
    && left.accent === right.accent
  )
}

function sameOverrides(left: ModifierOverrides, right: ModifierOverrides): boolean {
  return samePalette(left.palette, right.palette)
    && left.duplicateLayerGroup === right.duplicateLayerGroup
    && left.relocateSlot === right.relocateSlot
    && left.socket === right.socket
}

function sameTransform(left: ApprovedTransform, right: ApprovedTransform): boolean {
  return left.scale === right.scale && left.mirrorX === right.mirrorX
}

function isApprovedTransform(
  transform: ApprovedTransform | undefined,
  part: VisualPartDefinition,
): boolean {
  if (part.composition?.mode === 'species-rig') {
    return sameTransform(transform ?? IDENTITY_TRANSFORM, IDENTITY_TRANSFORM)
  }
  if (part.composition !== undefined) return transform === undefined
  const candidate = transform ?? IDENTITY_TRANSFORM
  const presets = part.approvedTransforms ?? []
  return presets.length === 0
    ? sameTransform(candidate, IDENTITY_TRANSFORM)
    : presets.some(preset => sameTransform(candidate, preset))
}

function hasRequiredBehaviorSocket(overrides: ModifierOverrides): boolean {
  const behavioral = overrides.duplicateLayerGroup !== undefined
    || overrides.relocateSlot !== undefined
  return !behavioral || (overrides.socket !== undefined && overrides.socket.length > 0)
}

function validateSemanticTrait(
  traitId: string,
  semanticSlotId: SemanticSlotId,
  path: string[],
  catalog: Catalog,
  diagnostics: Diagnostic[],
): void {
  const definition = catalog.semanticTraits.find(candidate => candidate.id === traitId)
  if (definition === undefined) {
    diagnostics.push(error(
      'SPEC_SEMANTIC_TRAIT_MISSING',
      path,
      `Catalog ${catalog.version} has no semantic trait ${traitId} for ${semanticSlotId}.`,
    ))
    return
  }
  if (definition.semanticSlotId !== semanticSlotId) {
    diagnostics.push(error(
      'SPEC_SEMANTIC_TRAIT_SLOT_MISMATCH',
      path,
      `Semantic trait ${traitId} belongs to ${definition.semanticSlotId}, not ${semanticSlotId}.`,
    ))
  }
}

function validateModifier(
  application: ModifierApplication,
  kind: ModifierDefinition['kind'],
  path: string[],
  catalog: Catalog,
  spec: MonsterSpec,
  selectedParts: ReadonlyMap<VisualSlotId, VisualPartDefinition>,
  diagnostics: Diagnostic[],
): void {
  const definition = catalog.modifiers.find(candidate => (
    candidate.id === application.id && candidate.kind === kind
  ))
  if (
    definition === undefined
    || (catalog.version === '0.6.0' && (
      definition.requiresMutation
      || definition.overrides.duplicateLayerGroup !== undefined
      || definition.overrides.relocateSlot !== undefined
    ))
    || !sameOverrides(application.overrides, definition.overrides)
    || !hasRequiredBehaviorSocket(application.overrides)
    || !hasRequiredBehaviorSocket(definition.overrides)
  ) {
    diagnostics.push(error(
      'SPEC_MODIFIER_INVALID',
      path,
      `Modifier ${application.id} is unknown or its overrides do not match catalog ${catalog.version}.`,
    ))
    return
  }

  const destinationSocket = definition.overrides.socket
  if (destinationSocket === undefined) return
  if (catalog.compositionPolicy !== undefined) {
    const bodySelection = spec.visualSlots.bodyFrame
    const bodyPart = selectedParts.get('bodyFrame')
    const bodyComposition = bodyPart?.composition
    const interfaceRig = (catalog.version === '0.4.0' || catalog.version === '0.5.0') && bodyComposition?.mode === 'interface'
      ? catalog.rigs.find(rig => rig.id === bodySelection.rigId)
      : undefined
    const interfaceSocketAvailable = interfaceRig !== undefined
      && interfaceRig.sockets.head !== undefined
      && interfaceRig.sockets[destinationSocket] !== undefined
    const attachmentSocketAvailable = isAttachmentPartComposition(bodyComposition)
      && bodyComposition.geometryByRig[bodySelection.rigId]?.sockets[destinationSocket] !== undefined
    if (!interfaceSocketAvailable && !attachmentSocketAvailable) {
      diagnostics.push(error(
        'SPEC_SOCKET_MISSING',
        path.concat('overrides', 'socket'),
        interfaceRig === undefined
          ? `Body part ${bodyPart?.id ?? bodySelection.partId} has no ${destinationSocket} composition socket.`
          : `Rig ${interfaceRig.id} requires both head and ${destinationSocket} sockets for modifier ${application.id}.`,
      ))
    }
    return
  }
  for (const [slotId, part] of selectedParts) {
    const appliesToPart = (
      definition.overrides.duplicateLayerGroup === 'head'
      && part.layer === 'head'
    ) || (
      definition.overrides.relocateSlot === 'eyes'
      && slotId === 'eyes'
    )
    if (!appliesToPart) continue
    const rig = catalog.rigs.find(candidate => candidate.id === spec.visualSlots[slotId].rigId)
    if (rig !== undefined && rig.sockets[destinationSocket] === undefined) {
      diagnostics.push(error(
        'SPEC_SOCKET_MISSING',
        path.concat('overrides', 'socket'),
        `Rig ${rig.id} has no ${destinationSocket} socket for modifier ${application.id}.`,
      ))
    }
  }
}

function validateFelineSpec(
  spec: MonsterSpec,
  catalog: Catalog,
  selectedParts: ReadonlyMap<VisualSlotId, VisualPartDefinition>,
  diagnostics: Diagnostic[],
  usesAnatomyBundle: boolean,
): AnimalArchetypeDefinition | null {
  if (catalog.version !== '0.6.0') return null
  const archetype = catalog.archetypes?.find(candidate => candidate.id === spec.archetypeId) ?? null
  if (archetype === null) {
    diagnostics.push(error(
      'SPEC_ARCHETYPE_INVALID',
      ['archetypeId'],
      `Archetype ${spec.archetypeId ?? 'missing'} is not supported by catalog ${catalog.version}.`,
    ))
    return null
  }
  for (const slotId of VISUAL_SLOT_IDS) {
    const part = selectedParts.get(slotId)
    const selection = spec.visualSlots[slotId]
    if (part !== undefined && part.archetypeIds?.includes(archetype.id) !== true) {
      diagnostics.push(error(
        'SPEC_ARCHETYPE_PART_MISMATCH',
        ['visualSlots', slotId, 'partId'],
        `Part ${part.id} is not compatible with archetype ${archetype.id}.`,
      ))
    }
    if (!archetype.rigIds.includes(selection.rigId)) {
      diagnostics.push(error(
        'SPEC_ARCHETYPE_INVALID',
        ['visualSlots', slotId, 'rigId'],
        `Rig ${selection.rigId} is not legal for archetype ${archetype.id}.`,
      ))
    }
  }
  if (!usesAnatomyBundle) {
    const integratedSentinels: Partial<Record<VisualSlotId, string>> = {
      arms: 'arms_feline_integrated',
      legs: 'legs_feline_integrated',
      extraAppendage: 'extra_feline_none',
    }
    for (const [slotId, partId] of Object.entries(integratedSentinels) as [VisualSlotId, string][]) {
      if (spec.visualSlots[slotId].partId === partId) continue
      diagnostics.push(error(
        'SPEC_INTEGRATED_SLOT_INVALID',
        ['visualSlots', slotId, 'partId'],
        `Archetype ${archetype.id} requires integrated sentinel ${partId} for ${slotId}.`,
      ))
    }
    const tail = selectedParts.get('tail')
    if (tail === undefined || tail.composition?.isNone === true) {
      diagnostics.push(error(
        'SPEC_ARCHETYPE_INVALID',
        ['visualSlots', 'tail', 'partId'],
        `Archetype ${archetype.id} requires one visible tail.`,
      ))
    }
  }
  const specialCount = [...selectedParts.values()].filter(part => part.featureTier === 'special').length
  const expectedSpecialCount = archetype.specialFeatureSlots.length === 0
    ? 0
    : (spec.mutation === null && spec.aberrations.length === 0 ? 0 : 1)
  if (specialCount !== expectedSpecialCount) {
    diagnostics.push(error(
      'SPEC_SPECIAL_FEATURE_COUNT_INVALID',
      ['visualSlots'],
      `Archetype ${archetype.id} requires ${expectedSpecialCount} special feature selection(s), received ${specialCount}.`,
    ))
  }
  return archetype
}

function usesExactV06AnatomyBundle(spec: MonsterSpec, catalog: Catalog): boolean {
  const bundle = resolveAnatomyBundle(spec, catalog)
  return catalog.version === '0.6.0'
    && spec.schemaVersion === '0.2.0'
    && spec.catalogVersion === '0.6.0'
    && spec.rendererVersion === '0.6.0'
    && spec.archetypeId === 'feline'
    && bundle?.archetypeId === spec.archetypeId
}

function validateFelineModifierState(spec: MonsterSpec, catalog: Catalog, diagnostics: Diagnostic[]): void {
  if (catalog.version !== '0.6.0') return
  if (spec.mutation !== null && spec.aberrations.length > 0) {
    diagnostics.push(error(
      'SPEC_MODIFIER_STATE_INVALID',
      ['aberrations'],
      'Catalog 0.6.0 does not permit mutation and aberration modifiers together.',
    ))
  }
  if (spec.aberrations.length > 1) {
    diagnostics.push(error(
      'SPEC_MODIFIER_STATE_INVALID',
      ['aberrations'],
      'Catalog 0.6.0 permits at most one aberration modifier.',
    ))
  }
}

export function validateMonsterSpecAgainstCatalog(
  spec: MonsterSpec,
  catalog: Catalog,
  versions: SupportedSpecVersions = CURRENT_SPEC_VERSIONS,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const expectedSchemaVersion = catalog.version === '0.8.0'
    ? '0.3.0'
    : catalog.version === '0.6.0' ? '0.2.0' : versions.schemaVersion
  if (spec.schemaVersion !== expectedSchemaVersion) {
    diagnostics.push(error(
      'SPEC_SCHEMA_VERSION_UNSUPPORTED',
      ['schemaVersion'],
      `MonsterSpec schema version ${spec.schemaVersion} is unsupported; expected ${expectedSchemaVersion}.`,
    ))
  }
  let expectedRenderer: MonsterSpec['rendererVersion']
  try {
    expectedRenderer = rendererVersionForCatalog(catalog)
  } catch {
    diagnostics.push(error(
      'SPEC_CATALOG_VERSION_UNSUPPORTED',
      ['catalogVersion'],
      `Catalog version ${catalog.version} is not installed or supported.`,
    ))
    return diagnostics
  }
  if (spec.rendererVersion !== expectedRenderer) {
    diagnostics.push(error(
      'SPEC_RENDERER_VERSION_UNSUPPORTED',
      ['rendererVersion'],
      `Catalog ${catalog.version} requires renderer ${expectedRenderer}.`,
    ))
  }
  if (spec.catalogVersion !== catalog.version) {
    diagnostics.push(error(
      'SPEC_CATALOG_VERSION_MISMATCH',
      ['catalogVersion'],
      `MonsterSpec requires catalog ${spec.catalogVersion}, received ${catalog.version}.`,
    ))
  }

  const selectedParts = new Map<typeof VISUAL_SLOT_IDS[number], VisualPartDefinition>()
  for (const [slotIndex, slotId] of VISUAL_SLOT_IDS.entries()) {
    const selection = spec.visualSlots[slotId]
    const part = catalog.parts.find(candidate => candidate.id === selection.partId)
    if (part === undefined) {
      diagnostics.push(error(
        'SPEC_PART_MISSING',
        ['visualSlots', slotId, 'partId'],
        `Catalog ${catalog.version} has no part ${selection.partId} for ${slotId}.`,
      ))
      continue
    }
    if (part.slotId !== slotId) {
      diagnostics.push(error(
        'SPEC_PART_SLOT_MISMATCH',
        ['visualSlots', slotId, 'partId'],
        `Part ${part.id} belongs to ${part.slotId}, not ${slotId}.`,
      ))
      continue
    }
    selectedParts.set(slotId, part)

    const rig = catalog.rigs.find(candidate => candidate.id === selection.rigId)
    if (rig === undefined) {
      diagnostics.push(error(
        'SPEC_RIG_MISSING',
        ['visualSlots', slotId, 'rigId'],
        `Catalog ${catalog.version} has no rig ${selection.rigId}.`,
      ))
    } else {
      if (!part.compatibleRigs.includes(rig.id)) {
        diagnostics.push(error(
          'SPEC_RIG_INCOMPATIBLE',
          ['visualSlots', slotId, 'rigId'],
          `Part ${part.id} is not compatible with rig ${rig.id}.`,
        ))
      }
      if (
        catalog.compositionPolicy === undefined
        && part.socket !== null
        && rig.sockets[part.socket] === undefined
      ) {
        diagnostics.push(error(
          'SPEC_SOCKET_MISSING',
          ['visualSlots', slotId, 'rigId'],
          `Rig ${rig.id} has no ${part.socket} socket for ${part.id}.`,
        ))
      }
    }
    if (slotId === 'colorScheme' && !part.themeIds.includes(spec.themeId)) {
      diagnostics.push(error(
        'SPEC_THEME_INCOMPATIBLE',
        ['visualSlots', slotId, 'partId'],
        `Color scheme ${part.id} is not compatible with theme ${spec.themeId}.`,
      ))
    }
    if (!isApprovedTransform(selection.transform, part)) {
      diagnostics.push(error(
        'SPEC_TRANSFORM_INVALID',
        ['visualSlots', slotId, 'transform'],
        `Transform for ${part.id} is not approved by catalog ${catalog.version}.`,
      ))
    }
    for (const otherSlotId of VISUAL_SLOT_IDS.slice(0, slotIndex)) {
      const otherPart = selectedParts.get(otherSlotId)
      if (
        otherPart !== undefined
        && (part.excludes.includes(otherPart.id) || otherPart.excludes.includes(part.id))
      ) {
        diagnostics.push(error(
          'SPEC_PART_EXCLUDED',
          ['visualSlots', slotId, 'partId'],
          `Parts ${part.id} and ${otherPart.id} cannot be selected together.`,
        ))
      }
    }
  }

  const anatomyBundleRoute = usesExactV06AnatomyBundle(spec, catalog)
  validateFelineSpec(spec, catalog, selectedParts, diagnostics, anatomyBundleRoute)
  if (spec.anatomyBundleId !== undefined) diagnostics.push(...validateAnatomyBundleSpec(spec, catalog))
  if (catalog.version === '0.8.0' && resolveSpeciesRig(spec, catalog) === null) {
    diagnostics.push(error(
      'SPEC_SPECIES_RIG_MISMATCH',
      ['speciesRigId'],
      `Species rig ${spec.speciesRigId ?? 'missing'} does not match the selected anatomy bundle and archetype.`,
    ))
  }
  validateFelineModifierState(spec, catalog, diagnostics)

  for (const semanticSlotId of SEMANTIC_SLOT_IDS) {
    const selection = spec.semanticTraits[semanticSlotId]
    validateSemanticTrait(
      selection.primaryTraitId,
      semanticSlotId,
      ['semanticTraits', semanticSlotId, 'primaryTraitId'],
      catalog,
      diagnostics,
    )
    selection.detailTraitIds.forEach((traitId, index) => {
      validateSemanticTrait(
        traitId,
        semanticSlotId,
        ['semanticTraits', semanticSlotId, 'detailTraitIds', String(index)],
        catalog,
        diagnostics,
      )
    })
  }

  if (spec.mutation !== null) {
    validateModifier(spec.mutation, 'mutation', ['mutation'], catalog, spec, selectedParts, diagnostics)
  }
  spec.aberrations.forEach((application, index) => {
    validateModifier(
      application,
      'aberration',
      ['aberrations', String(index)],
      catalog,
      spec,
      selectedParts,
      diagnostics,
    )
  })
  diagnostics.push(...validateCompositionSelections(
    spec,
    catalog,
    planComposition(spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, catalog),
  ))
  diagnostics.push(...validateStructuralSelections(spec, catalog))
  diagnostics.push(...validateMonsterGenome(spec, catalog))
  return diagnostics
}
