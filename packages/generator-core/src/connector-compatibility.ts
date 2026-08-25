import {
  type Catalog,
  type ConnectorProfile,
  type Diagnostic,
  type MonsterSpec,
  type RigId,
  type StructuralSlotId,
  type VisualPartDefinition,
} from './contracts.js'

export type ConnectorPairResult =
  | { ok: true; bridgeId: string; widthRatio: number; depthRatio: number; rotationDegrees: number }
  | {
    ok: false
    code: 'CONNECTOR_VARIANT_MISSING' | 'CONNECTOR_PROFILE_INVALID' | 'CONNECTOR_WARP_EXCEEDED' | 'CONNECTOR_BRIDGE_MISSING'
    message: string
  }

const CONNECTOR_IDS_BY_CHILD_SLOT: Partial<Record<StructuralSlotId, readonly string[]>> = {
  headShape: ['neck'],
  arms: ['shoulderLeft', 'shoulderRight'],
  legs: ['hipLeft', 'hipRight'],
  tail: ['tailRoot'],
  extraAppendage: ['extraLeft', 'extraRight'],
}

const STRUCTURAL_CHILD_SLOTS = Object.keys(CONNECTOR_IDS_BY_CHILD_SLOT) as StructuralSlotId[]

function isInterfaceCatalog(catalog: Catalog): boolean {
  return catalog.version === '0.3.0'
}

function exactVariant(part: VisualPartDefinition | undefined, rigId: RigId) {
  if (part?.composition?.mode !== 'interface') return undefined
  const variant = part.composition.variantsByRig[rigId]
  return variant?.rigId === rigId ? variant : undefined
}

function rotationDegrees(receiver: ConnectorProfile, plug: ConnectorProfile): number {
  const dot = receiver.tangent.x * plug.tangent.x + receiver.tangent.y * plug.tangent.y
  const cross = receiver.tangent.x * plug.tangent.y - receiver.tangent.y * plug.tangent.x
  return Math.atan2(cross, dot) * (180 / Math.PI)
}

function within(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max
}

export function evaluateConnectorPair(
  catalog: Catalog,
  receiverPartId: string,
  plugPartId: string,
  rigId: RigId,
  connectorId: string,
): ConnectorPairResult {
  const receiverPart = catalog.parts.find(part => part.id === receiverPartId)
  const plugPart = catalog.parts.find(part => part.id === plugPartId)
  const receiverVariant = exactVariant(receiverPart, rigId)
  const plugVariant = exactVariant(plugPart, rigId)
  if (receiverVariant === undefined || plugVariant === undefined) {
    return {
      ok: false,
      code: 'CONNECTOR_VARIANT_MISSING',
      message: `Parts ${receiverPartId} and ${plugPartId} require exact ${rigId} interface variants.`,
    }
  }
  const receivers = receiverVariant.connectors.filter(connector => (
    connector.id === connectorId && connector.role === 'receiver' && connector.rigId === rigId
  ))
  const plugs = plugVariant.connectors.filter(connector => (
    connector.id === connectorId && connector.role === 'plug' && connector.rigId === rigId
  ))
  const receiver = receivers[0]
  const plug = plugs[0]
  if (
    receivers.length !== 1
    || plugs.length !== 1
    || receiver === undefined
    || plug === undefined
    || receiver.connectorClass !== plug.connectorClass
  ) {
    return {
      ok: false,
      code: 'CONNECTOR_PROFILE_INVALID',
      message: `Parts ${receiverPartId} and ${plugPartId} require complementary ${connectorId} connector profiles.`,
    }
  }

  const widthRatio = plug.width / receiver.width
  const depthRatio = plug.depth / receiver.depth
  const rotation = rotationDegrees(receiver, plug)
  if (
    !within(widthRatio, receiver.warpLimits.widthRatio)
    || !within(widthRatio, plug.warpLimits.widthRatio)
    || !within(depthRatio, receiver.warpLimits.depthRatio)
    || !within(depthRatio, plug.warpLimits.depthRatio)
    || !within(rotation, receiver.warpLimits.rotationDegrees)
    || !within(rotation, plug.warpLimits.rotationDegrees)
  ) {
    return {
      ok: false,
      code: 'CONNECTOR_WARP_EXCEEDED',
      message: `Parts ${receiverPartId} and ${plugPartId} at ${connectorId} measure widthRatio=${widthRatio}, depthRatio=${depthRatio}, rotationDegrees=${rotation}.`,
    }
  }
  const bridge = catalog.transitionBridges?.find(candidate => (
    candidate.rigId === rigId
    && candidate.connectorClass === receiver.connectorClass
    && candidate.materialFamilies.includes(receiverVariant.materialFamily)
    && candidate.materialFamilies.includes(plugVariant.materialFamily)
  ))
  if (bridge === undefined) {
    return {
      ok: false,
      code: 'CONNECTOR_BRIDGE_MISSING',
      message: `Parts ${receiverPartId} and ${plugPartId} require one ${rigId} ${receiver.connectorClass} bridge supporting ${receiverVariant.materialFamily} and ${plugVariant.materialFamily}.`,
    }
  }
  return {
    ok: true,
    bridgeId: bridge.id,
    widthRatio,
    depthRatio,
    rotationDegrees: rotation,
  }
}

export function connectorExclusionCodes(
  catalog: Catalog,
  candidate: VisualPartDefinition,
  rigId: RigId,
  selectedParts: ReadonlyMap<StructuralSlotId, VisualPartDefinition>,
): string[] {
  if (!isInterfaceCatalog(catalog) || candidate.composition?.isNone) return []
  const results: ConnectorPairResult[] = []
  if (candidate.slotId === 'bodyFrame') {
    for (const slotId of STRUCTURAL_CHILD_SLOTS) {
      const child = selectedParts.get(slotId)
      if (child === undefined || child.composition?.isNone) continue
      for (const connectorId of CONNECTOR_IDS_BY_CHILD_SLOT[slotId] ?? []) {
        results.push(evaluateConnectorPair(catalog, candidate.id, child.id, rigId, connectorId))
      }
    }
  } else if (STRUCTURAL_CHILD_SLOTS.includes(candidate.slotId as StructuralSlotId)) {
    const body = selectedParts.get('bodyFrame')
    if (body !== undefined) {
      for (const connectorId of CONNECTOR_IDS_BY_CHILD_SLOT[candidate.slotId as StructuralSlotId] ?? []) {
        results.push(evaluateConnectorPair(catalog, body.id, candidate.id, rigId, connectorId))
      }
    }
  }
  return results.flatMap(result => result.ok ? [] : [result.code])
}

function error(code: string, slotId: StructuralSlotId, message: string): Diagnostic {
  return { severity: 'error', code, path: ['visualSlots', slotId], message }
}

export function validateStructuralSelections(spec: MonsterSpec, catalog: Catalog): Diagnostic[] {
  if (!isInterfaceCatalog(catalog)) return []
  const bodySelection = spec.visualSlots.bodyFrame
  const body = catalog.parts.find(part => part.id === bodySelection.partId && part.slotId === 'bodyFrame')
  if (body === undefined || body.composition?.isNone) return []

  const diagnostics: Diagnostic[] = []
  for (const slotId of STRUCTURAL_CHILD_SLOTS) {
    const selection = spec.visualSlots[slotId]
    const child = catalog.parts.find(part => part.id === selection.partId && part.slotId === slotId)
    if (child === undefined || child.composition?.isNone) continue
    for (const connectorId of CONNECTOR_IDS_BY_CHILD_SLOT[slotId] ?? []) {
      const result = evaluateConnectorPair(catalog, body.id, child.id, bodySelection.rigId, connectorId)
      if (!result.ok) diagnostics.push(error(result.code, slotId, result.message))
    }
  }
  return diagnostics
}
