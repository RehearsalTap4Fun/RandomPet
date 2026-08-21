import {
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type ModifierApplication,
  type ModifierDefinition,
  type ModifierOverrides,
  type MonsterSpec,
  type Palette,
  type RenderLayer,
  type RigDefinition,
} from '@qmonster/generator-core'
import type { ExpandedRenderLayers, RenderLayerInstance } from './types.js'

export const RENDER_LAYER_ORDER = [
  'groundShadow', 'rearAppendage', 'body', 'surface', 'pattern',
  'frontAppendage', 'head', 'faceAndHeadwear', 'foregroundEffect',
] as const satisfies readonly RenderLayer[]

const layerRank = new Map<RenderLayer, number>(
  RENDER_LAYER_ORDER.map((layer, index) => [layer, index]),
)

function diagnostic(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function samePalette(left: Palette | undefined, right: Palette | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.primary === right.primary
    && left.secondary === right.secondary
    && left.accent === right.accent
}

function sameOverrides(left: ModifierOverrides, right: ModifierOverrides): boolean {
  return samePalette(left.palette, right.palette)
    && left.duplicateLayerGroup === right.duplicateLayerGroup
    && left.relocateSlot === right.relocateSlot
    && left.socket === right.socket
}

function hasRequiredBehaviorSocket(overrides: ModifierOverrides): boolean {
  const isBehavioral = overrides.duplicateLayerGroup !== undefined
    || overrides.relocateSlot !== undefined
  return !isBehavioral || (overrides.socket !== undefined && overrides.socket.length > 0)
}

function matchingModifier(
  application: ModifierApplication,
  expectedKind: ModifierDefinition['kind'],
  catalog: Catalog,
  path: string[],
  diagnostics: Diagnostic[],
): ModifierDefinition | null {
  const definition = catalog.modifiers.find(candidate => (
    candidate.id === application.id && candidate.kind === expectedKind
  ))
  if (
    definition === undefined
    || !sameOverrides(application.overrides, definition.overrides)
    || !hasRequiredBehaviorSocket(application.overrides)
    || !hasRequiredBehaviorSocket(definition.overrides)
  ) {
    diagnostics.push(diagnostic(
      'RENDER_MODIFIER_INVALID',
      path,
      `Modifier ${application.id} is unknown or its overrides do not match catalog ${catalog.version}.`,
    ))
    return null
  }
  return definition
}

function hasSocket(rig: RigDefinition, socketName: string): boolean {
  return rig.sockets[socketName] !== undefined
}

function requireSocket(
  instance: RenderLayerInstance,
  socketName: string,
  path: string[],
  diagnostics: Diagnostic[],
): boolean {
  if (hasSocket(instance.rig, socketName)) return true
  diagnostics.push(diagnostic(
    'RENDER_SOCKET_MISSING',
    path,
    `Rig ${instance.rig.id} has no ${socketName} socket for ${instance.part.id}.`,
  ))
  return false
}

function applyModifier(
  layers: RenderLayerInstance[],
  definition: ModifierDefinition,
  path: string[],
  diagnostics: Diagnostic[],
): void {
  const { overrides } = definition
  if (overrides.duplicateLayerGroup === 'head' && overrides.socket !== undefined) {
    const originals = layers.filter(instance => instance.part.layer === 'head')
    for (const original of originals) {
      if (!requireSocket(original, overrides.socket, path.concat('overrides', 'socket'), diagnostics)) continue
      layers.push({ ...original, socketName: overrides.socket, sequence: layers.length })
    }
  }

  if (overrides.relocateSlot === 'eyes' && overrides.socket !== undefined) {
    for (let index = 0; index < layers.length; index += 1) {
      const instance = layers[index]
      if (instance?.slotId !== 'eyes') continue
      if (!requireSocket(instance, overrides.socket, path.concat('overrides', 'socket'), diagnostics)) continue
      layers[index] = { ...instance, socketName: overrides.socket }
    }
  }
}

function createBaseLayers(
  spec: MonsterSpec,
  catalog: Catalog,
  diagnostics: Diagnostic[],
): RenderLayerInstance[] {
  const layers: RenderLayerInstance[] = []
  for (const slotId of VISUAL_SLOT_IDS) {
    const selection = spec.visualSlots[slotId]
    const part = catalog.parts.find(candidate => (
      candidate.id === selection.partId && candidate.slotId === slotId
    ))
    if (part === undefined) {
      diagnostics.push(diagnostic(
        'RENDER_PART_MISSING',
        ['visualSlots', slotId, 'partId'],
        `Catalog ${catalog.version} has no ${slotId} part ${selection.partId}.`,
      ))
      continue
    }
    const rig = catalog.rigs.find(candidate => candidate.id === selection.rigId)
    if (rig === undefined) {
      diagnostics.push(diagnostic(
        'RENDER_RIG_MISSING',
        ['visualSlots', slotId, 'rigId'],
        `Catalog ${catalog.version} has no rig ${selection.rigId}.`,
      ))
      continue
    }
    layers.push({
      slotId,
      part,
      rig,
      socketName: part.socket,
      transform: selection.transform ?? { scale: 1, mirrorX: false },
      sequence: layers.length,
    })
  }
  return layers
}

export function expandRenderLayers(spec: MonsterSpec, catalog: Catalog): ExpandedRenderLayers {
  const diagnostics: Diagnostic[] = []
  const layers = createBaseLayers(spec, catalog, diagnostics)
  let palette: Palette = { ...spec.palette }

  if (spec.catalogVersion !== catalog.version) {
    diagnostics.push(diagnostic(
      'RENDER_CATALOG_VERSION_MISMATCH',
      ['catalogVersion'],
      `MonsterSpec requires catalog ${spec.catalogVersion}, received ${catalog.version}.`,
    ))
  } else {
    const applications: Array<{
      application: ModifierApplication
      kind: ModifierDefinition['kind']
      path: string[]
    }> = []
    if (spec.mutation !== null) {
      applications.push({ application: spec.mutation, kind: 'mutation', path: ['mutation'] })
    }
    spec.aberrations.forEach((application, index) => {
      applications.push({ application, kind: 'aberration', path: ['aberrations', String(index)] })
    })

    for (const entry of applications) {
      const definition = matchingModifier(
        entry.application, entry.kind, catalog, entry.path, diagnostics,
      )
      if (definition === null) continue
      if (definition.overrides.palette !== undefined) {
        palette = { ...definition.overrides.palette }
      }
      applyModifier(layers, definition, entry.path, diagnostics)
    }
  }

  layers.sort((left, right) => (
    layerRank.get(left.part.layer)! - layerRank.get(right.part.layer)!
      || left.sequence - right.sequence
  ))
  return { layers, palette, diagnostics }
}
