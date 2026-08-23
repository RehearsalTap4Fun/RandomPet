import {
  VISUAL_SLOT_IDS,
  type ApprovedTransform,
  type Catalog,
  type Diagnostic,
  type ModifierApplication,
  type ModifierDefinition,
  type ModifierOverrides,
  type MonsterSpec,
  type Palette,
  type SupportedSpecVersions,
  type VisualPartDefinition,
} from './contracts.js'

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

function validateModifier(
  application: ModifierApplication,
  kind: ModifierDefinition['kind'],
  path: string[],
  catalog: Catalog,
  diagnostics: Diagnostic[],
): void {
  const definition = catalog.modifiers.find(candidate => (
    candidate.id === application.id && candidate.kind === kind
  ))
  if (
    definition === undefined
    || !sameOverrides(application.overrides, definition.overrides)
    || !hasRequiredBehaviorSocket(application.overrides)
    || !hasRequiredBehaviorSocket(definition.overrides)
  ) {
    diagnostics.push(error(
      'SPEC_MODIFIER_INVALID',
      path,
      `Modifier ${application.id} is unknown or its overrides do not match catalog ${catalog.version}.`,
    ))
  }
}

export function validateMonsterSpecAgainstCatalog(
  spec: MonsterSpec,
  catalog: Catalog,
  versions: SupportedSpecVersions = CURRENT_SPEC_VERSIONS,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (spec.schemaVersion !== versions.schemaVersion) {
    diagnostics.push(error(
      'SPEC_SCHEMA_VERSION_UNSUPPORTED',
      ['schemaVersion'],
      `MonsterSpec schema version ${spec.schemaVersion} is unsupported; expected ${versions.schemaVersion}.`,
    ))
  }
  if (spec.rendererVersion !== versions.rendererVersion) {
    diagnostics.push(error(
      'SPEC_RENDERER_VERSION_UNSUPPORTED',
      ['rendererVersion'],
      `MonsterSpec renderer version ${spec.rendererVersion} is unsupported; expected ${versions.rendererVersion}.`,
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
      if (part.socket !== null && rig.sockets[part.socket] === undefined) {
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

  if (spec.mutation !== null) {
    validateModifier(spec.mutation, 'mutation', ['mutation'], catalog, diagnostics)
  }
  spec.aberrations.forEach((application, index) => {
    validateModifier(application, 'aberration', ['aberrations', String(index)], catalog, diagnostics)
  })
  return diagnostics
}
