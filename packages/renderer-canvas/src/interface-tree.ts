import {
  generationOrderForCatalog,
  isAttachmentPartComposition,
  validateStructuralSelections,
  type Catalog,
  type ConnectorProfile,
  type Diagnostic,
  type MonsterSpec,
  type Point2D,
  type StructuralSlotId,
  type StructuralVariantDefinition,
  type VisualPartDefinition,
  type VisualSlotId,
} from '@qmonster/generator-core'
import { solveConnector } from './connector-solver.js'
import type {
  InterfaceRenderResult,
  Placement,
  ResolvedBridge,
  ResolvedRenderNode,
  WorldRect,
} from './types.js'

const ROOT: Point2D = { x: 1024, y: 1024 }
const STRUCTURAL_CHILDREN: readonly StructuralSlotId[] = [
  'headShape', 'arms', 'legs', 'tail', 'extraAppendage',
]

function selectedPart(spec: MonsterSpec, catalog: Catalog, slotId: VisualSlotId) {
  const selection = spec.visualSlots[slotId]
  return catalog.parts.find(part => part.id === selection.partId && part.slotId === slotId)
}

function variantFor(part: VisualPartDefinition, spec: MonsterSpec): StructuralVariantDefinition | undefined {
  if (part.composition?.mode !== 'interface') return undefined
  const rigId = spec.visualSlots[part.slotId].rigId
  const variant = part.composition.variantsByRig[rigId]
  return variant?.rigId === rigId ? variant : undefined
}

function worldPoint(placement: Placement, local: Point2D): Point2D {
  const x = local.x * placement.scaleX
  const y = local.y * placement.scaleY
  const radians = (placement.rotationDegrees ?? 0) * Math.PI / 180
  return {
    x: placement.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: placement.y + x * Math.sin(radians) + y * Math.cos(radians),
  }
}

function nodePlacement(socket: Point2D, node: ResolvedRenderNode['node']): Placement {
  const scaleX = node.transform.mirrorX ? -node.transform.scale : node.transform.scale
  return {
    x: socket.x - node.origin.x * scaleX,
    y: socket.y - node.origin.y * node.transform.scale,
    scaleX,
    scaleY: node.transform.scale,
  }
}

function worldConnector(profile: ConnectorProfile, placement: Placement): ConnectorProfile {
  const radians = (placement.rotationDegrees ?? 0) * Math.PI / 180
  const rotate = (point: Point2D): Point2D => ({
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  })
  return {
    ...profile,
    origin: worldPoint(placement, profile.origin),
    tangent: rotate({
      x: profile.tangent.x * Math.sign(placement.scaleX),
      y: profile.tangent.y,
    }),
    outwardNormal: rotate({
      x: profile.outwardNormal.x * Math.sign(placement.scaleX),
      y: profile.outwardNormal.y,
    }),
    width: profile.width * Math.abs(placement.scaleX),
    depth: profile.depth * Math.abs(placement.scaleY),
  }
}

function diagnostic(code: string, slotId: VisualSlotId, message: string): Diagnostic {
  return { severity: 'error', code, path: ['visualSlots', slotId], message }
}

function childNodeForConnector(
  variant: StructuralVariantDefinition,
  connector: ConnectorProfile,
) {
  return variant.renderNodes.find(node => node.connectorId === connector.id)
}

function hasOneNodePerPlug(variant: StructuralVariantDefinition): boolean {
  const plugIds = variant.connectors.filter(item => item.role === 'plug').map(item => item.id)
  const nodeIds = variant.renderNodes.map(node => node.connectorId)
  return plugIds.length === nodeIds.length
    && nodeIds.every((id): id is string => id !== undefined)
    && new Set(nodeIds).size === nodeIds.length
    && plugIds.every(id => nodeIds.includes(id))
}

function structuralTree(spec: MonsterSpec, catalog: Catalog): InterfaceRenderResult {
  const diagnostics = validateStructuralSelections(spec, catalog)
  if (diagnostics.some(item => item.severity === 'error')) {
    return { nodes: [], bridges: [], faceSafeZones: [], diagnostics }
  }
  const nodes: ResolvedRenderNode[] = []
  const bridges: ResolvedBridge[] = []
  const faceSafeZones: WorldRect[] = []
  const providers = new Map<VisualSlotId, ResolvedRenderNode[]>()
  let sequence = 0

  const bodyPart = selectedPart(spec, catalog, 'bodyFrame')
  const bodyVariant = bodyPart === undefined ? undefined : variantFor(bodyPart, spec)
  if (bodyPart === undefined || bodyVariant === undefined || bodyVariant.renderNodes.length === 0) {
    diagnostics.push(diagnostic(
      'CONNECTOR_VARIANT_MISSING', 'bodyFrame', 'Selected body requires an exact interface render variant.',
    ))
    return { nodes: [], bridges: [], faceSafeZones: [], diagnostics }
  }
  const bodyNodes = bodyVariant.renderNodes.map(node => ({
    key: node.id,
    slotId: 'bodyFrame' as const,
    part: bodyPart,
    node,
    placement: nodePlacement(ROOT, node),
    sequence: sequence++,
  }))
  nodes.push(...bodyNodes)
  providers.set('bodyFrame', bodyNodes)
  const bodyNode = bodyNodes[0]!

  for (const slotId of STRUCTURAL_CHILDREN) {
    const childPart = selectedPart(spec, catalog, slotId)
    if (childPart?.composition?.isNone) continue
    const childVariant = childPart === undefined ? undefined : variantFor(childPart, spec)
    if (childPart === undefined || childVariant === undefined) {
      diagnostics.push(diagnostic(
        'CONNECTOR_VARIANT_MISSING', slotId, `Selected ${slotId} requires an exact interface variant.`,
      ))
      continue
    }
    if (!hasOneNodePerPlug(childVariant)) {
      diagnostics.push(diagnostic(
        'CONNECTOR_PROFILE_INVALID', slotId,
        `Selected ${slotId} requires one render node for every plug connector ID.`,
      ))
      continue
    }
    const childNodes: ResolvedRenderNode[] = []
    for (const plug of childVariant.connectors.filter(item => item.role === 'plug')) {
      const receiver = bodyVariant.connectors.find(item => (
        item.role === 'receiver' && item.id === plug.id
      ))
      const bridge = receiver === undefined ? undefined : catalog.transitionBridges?.find(item => (
        item.rigId === receiver.rigId
        && item.connectorClass === receiver.connectorClass
        && item.materialFamilies.includes(bodyVariant.materialFamily)
        && item.materialFamilies.includes(childVariant.materialFamily)
      ))
      if (receiver === undefined) {
        diagnostics.push(diagnostic(
          'CONNECTOR_PROFILE_INVALID', slotId, `Selected body has no receiver for ${plug.id}.`,
        ))
        continue
      }
      const node = childNodeForConnector(childVariant, plug)
      if (node === undefined) {
        diagnostics.push(diagnostic(
          'CONNECTOR_VARIANT_MISSING', slotId, `Selected ${slotId} has no render node for ${plug.id}.`,
        ))
        continue
      }
      const receiverWorld = worldConnector(receiver, bodyNode.placement)
      const solved = solveConnector(receiverWorld, plug, bridge, node.transform)
      if (!solved.ok) {
        diagnostics.push(diagnostic(solved.code, slotId, solved.message))
        continue
      }
      const resolvedNode: ResolvedRenderNode = {
        key: node.id,
        slotId,
        part: childPart,
        node,
        placement: solved.childPlacement,
        sequence: sequence++,
      }
      nodes.push(resolvedNode)
      childNodes.push(resolvedNode)
      bridges.push({
        key: `${bodyNode.key}:${resolvedNode.key}:${plug.id}`,
        connectorId: plug.id,
        parentNodeKey: bodyNode.key,
        childNodeKey: resolvedNode.key,
        receiver: receiverWorld,
        plug,
        bridge: bridge!,
        solved,
      })
    }
    providers.set(slotId, childNodes)
    for (const node of childNodes) {
      for (const zone of childVariant.faceSafeZones ?? []) {
        const corners = [
          worldPoint(node.placement, zone),
          worldPoint(node.placement, { x: zone.x + zone.width, y: zone.y }),
          worldPoint(node.placement, { x: zone.x, y: zone.y + zone.height }),
          worldPoint(node.placement, { x: zone.x + zone.width, y: zone.y + zone.height }),
        ]
        const xs = corners.map(point => point.x)
        const ys = corners.map(point => point.y)
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        faceSafeZones.push({
          x: minX, y: minY, width: maxX - minX, height: maxY - minY,
        })
      }
    }
  }
  if (diagnostics.some(item => item.severity === 'error')) {
    return { nodes: [], bridges: [], faceSafeZones: [], diagnostics }
  }

  for (const slotId of generationOrderForCatalog(catalog)) {
    if (slotId === 'bodyFrame' || STRUCTURAL_CHILDREN.includes(slotId as StructuralSlotId)) continue
    const part = selectedPart(spec, catalog, slotId)
    const composition = part?.composition
    if (part === undefined || !isAttachmentPartComposition(composition) || composition.isNone) continue
    const selection = spec.visualSlots[slotId]
    const resolvedForSlot: ResolvedRenderNode[] = []
    for (const node of composition.renderNodes) {
      if (!node.compatibleRigs.includes(selection.rigId)) continue
      const parent = node.parentSlot === null ? undefined : providers.get(node.parentSlot)?.[0]
      let socket = ROOT
      if (parent !== undefined) {
        const parentVariant = variantFor(parent.part, spec)
        const parentComposition = parent.part.composition
        const localSocket = parentVariant?.featureSockets?.[node.socket ?? '']
          ?? (isAttachmentPartComposition(parentComposition)
            ? parentComposition.geometryByRig[spec.visualSlots[parent.slotId].rigId]?.sockets[node.socket ?? '']
            : undefined)
          ?? parent.node.origin
        socket = worldPoint(parent.placement, localSocket)
      }
      const resolved: ResolvedRenderNode = {
        key: node.id,
        slotId,
        part,
        node,
        placement: nodePlacement(socket, node),
        sequence: sequence++,
      }
      nodes.push(resolved)
      resolvedForSlot.push(resolved)
    }
    providers.set(slotId, resolvedForSlot)
  }
  return { nodes, bridges, faceSafeZones, diagnostics }
}

export function resolveInterfaceTree(spec: MonsterSpec, catalog: Catalog): InterfaceRenderResult {
  return structuralTree(spec, catalog)
}
