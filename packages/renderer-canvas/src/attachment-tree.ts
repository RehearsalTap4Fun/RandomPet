import {
  COMPOSITION_PARENT_BY_SLOT,
  generationOrderForCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type Point2D,
  type Rect,
  type VisualPartDefinition,
  type VisualSlotId,
} from '@qmonster/generator-core'
import type {
  AttachmentTreeResult,
  Placement,
  ResolvedRenderNode,
  WorldRect,
} from './types.js'

const ROOT_POINT: Point2D = { x: 1024, y: 1024 }

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function worldPoint(parent: Placement, local: Point2D): Point2D {
  return {
    x: parent.x + local.x * parent.scaleX,
    y: parent.y + local.y * parent.scaleY,
  }
}

function childPlacement(socket: Point2D, node: ResolvedRenderNode['node']): Placement {
  const scaleX = node.transform.mirrorX ? -node.transform.scale : node.transform.scale
  return {
    x: socket.x - node.origin.x * scaleX,
    y: socket.y - node.origin.y * node.transform.scale,
    scaleX,
    scaleY: node.transform.scale,
  }
}

function worldRect(placement: Placement, local: Rect): WorldRect {
  const first = worldPoint(placement, { x: local.x, y: local.y })
  const second = worldPoint(placement, {
    x: local.x + local.width,
    y: local.y + local.height,
  })
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  }
}

function selectedPart(
  slotId: VisualSlotId,
  spec: MonsterSpec,
  catalog: Catalog,
): VisualPartDefinition | undefined {
  return catalog.parts.find(part => (
    part.slotId === slotId && part.id === spec.visualSlots[slotId].partId
  ))
}

function translated(rect: WorldRect, delta: Point2D): WorldRect {
  return { ...rect, x: rect.x + delta.x, y: rect.y + delta.y }
}

function bodySocketDelta(
  spec: MonsterSpec,
  catalog: Catalog,
  bodyNode: ResolvedRenderNode,
): Point2D | null {
  const body = selectedPart('bodyFrame', spec, catalog)
  const rigId = spec.visualSlots.bodyFrame.rigId
  const geometry = body?.composition?.geometryByRig[rigId]
  const head = geometry?.sockets.head
  const alternate = geometry?.sockets.headAlternate
  if (head === undefined || alternate === undefined) return null
  const headWorld = worldPoint(bodyNode.placement, head)
  const alternateWorld = worldPoint(bodyNode.placement, alternate)
  return { x: alternateWorld.x - headWorld.x, y: alternateWorld.y - headWorld.y }
}

export function resolveAttachmentTree(spec: MonsterSpec, catalog: Catalog): AttachmentTreeResult {
  const nodes: ResolvedRenderNode[] = []
  const diagnostics: Diagnostic[] = []
  const faceSafeZones: WorldRect[] = []
  const parentChainBySlot: Partial<Record<VisualSlotId, VisualSlotId[]>> = {}
  const providers = new Map<VisualSlotId, ResolvedRenderNode[]>()
  let sequence = 0

  for (const slotId of generationOrderForCatalog(catalog)) {
    const part = selectedPart(slotId, spec, catalog)
    const composition = part?.composition
    if (part === undefined || composition === undefined || composition.isNone) continue
    const rigId = spec.visualSlots[slotId].rigId

    for (const node of composition.renderNodes) {
      if (!node.compatibleRigs.includes(rigId)) continue
      let socket = ROOT_POINT
      if (node.parentSlot !== null) {
        const parentNodes = providers.get(node.parentSlot) ?? []
        if (parentNodes.length !== 1) {
          diagnostics.push(error(
            'COMPOSITION_PROVIDER_AMBIGUOUS',
            ['visualSlots', slotId],
            `Slot ${node.parentSlot} must resolve to exactly one socket-providing node.`,
          ))
          continue
        }
        const parent = parentNodes[0]!
        const parentRigId = spec.visualSlots[node.parentSlot].rigId
        const localSocket = parent.part.composition?.geometryByRig[parentRigId]
          ?.sockets[node.socket ?? '']
        if (localSocket === undefined) {
          diagnostics.push(error(
            'COMPOSITION_SOCKET_MISSING',
            ['visualSlots', slotId],
            `Selected ${node.parentSlot} part has no ${node.socket ?? '(null)'} socket for ${rigId}.`,
          ))
          continue
        }
        socket = worldPoint(parent.placement, localSocket)
      }

      const resolved: ResolvedRenderNode = {
        key: node.id,
        slotId,
        part,
        node,
        placement: childPlacement(socket, node),
        sequence,
      }
      sequence += 1
      nodes.push(resolved)
      const slotNodes = providers.get(slotId) ?? []
      slotNodes.push(resolved)
      providers.set(slotId, slotNodes)
    }

    const parentSlot = COMPOSITION_PARENT_BY_SLOT[slotId]
    parentChainBySlot[slotId] = parentSlot === null
      ? [slotId]
      : [...(parentChainBySlot[parentSlot] ?? [parentSlot]), slotId]
  }

  const head = selectedPart('headShape', spec, catalog)
  const headRigId = spec.visualSlots.headShape.rigId
  const localFace = head?.composition?.geometryByRig[headRigId]?.faceSafeZone
  for (const headNode of providers.get('headShape') ?? []) {
    if (localFace !== undefined) faceSafeZones.push(worldRect(headNode.placement, localFace))
  }

  const bodyNode = providers.get('bodyFrame')?.[0]
  const alternateDelta = bodyNode === undefined ? null : bodySocketDelta(spec, catalog, bodyNode)
  if (spec.mutation?.id === 'mutation_double_head' && alternateDelta !== null) {
    const subtreeSlots = new Set<VisualSlotId>([
      'headShape', 'eyes', 'mouthShape', 'oralDetail', 'headAppendage',
    ])
    const originals = nodes.filter(node => subtreeSlots.has(node.slotId))
    for (const original of originals) {
      nodes.push({
        ...original,
        key: `${original.key}:double-head`,
        placement: {
          ...original.placement,
          x: original.placement.x + alternateDelta.x,
          y: original.placement.y + alternateDelta.y,
        },
        sequence,
      })
      sequence += 1
    }
    if (faceSafeZones[0] !== undefined) {
      faceSafeZones.push(translated(faceSafeZones[0], alternateDelta))
    }
  }

  if (
    spec.aberrations.some(item => item.id === 'aberration_misplaced_eye')
    && alternateDelta !== null
  ) {
    for (const node of nodes) {
      if (node.slotId !== 'eyes') continue
      node.placement = {
        ...node.placement,
        x: node.placement.x + alternateDelta.x,
        y: node.placement.y + alternateDelta.y,
      }
    }
    if (faceSafeZones[0] !== undefined) {
      faceSafeZones.push(translated(faceSafeZones[0], alternateDelta))
    }
  }

  return { nodes, faceSafeZones, parentChainBySlot, diagnostics }
}
