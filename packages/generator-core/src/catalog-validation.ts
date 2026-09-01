import {
  COMPOSITION_PARENT_BY_SLOT,
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  isStructuralSlot,
  isAttachmentPartComposition,
  type Catalog,
  type ConnectorClass,
  type Diagnostic,
  type MaterialFamily,
  type RigId,
  type VisualSlotId,
} from './contracts.js'

const OPTIONAL_SLOTS = new Set<VisualSlotId>(['headAppendage', 'tail', 'extraAppendage', 'effect'])
const MANDATORY_SLOTS = VISUAL_SLOT_IDS.filter(slotId => !OPTIONAL_SLOTS.has(slotId))
const REQUIRED_THEME_IDS = new Set(['deep-sea', 'fungal', 'shadow'])
const REQUIRED_RIG_IDS = new Set(['blob', 'biped', 'floating'])
const REQUIRED_PROVIDER_SOCKETS: Partial<Record<VisualSlotId, readonly string[]>> = {
  bodyFrame: ['head', 'headAlternate', 'armLeft', 'armRight', 'legLeft', 'legRight', 'tail', 'wingLeft', 'wingRight', 'overlay', 'effect'],
  headShape: ['eyes', 'mouth', 'headAppendage'],
  mouthShape: ['oralDetail'],
}
const REQUIRED_CONNECTORS: Partial<Record<VisualSlotId, ReadonlyArray<{
  id: string
  role: 'receiver' | 'plug'
  connectorClass: ConnectorClass
}>>> = {
  bodyFrame: [
    { id: 'neck', role: 'receiver', connectorClass: 'neck' },
    { id: 'shoulderLeft', role: 'receiver', connectorClass: 'shoulder' },
    { id: 'shoulderRight', role: 'receiver', connectorClass: 'shoulder' },
    { id: 'hipLeft', role: 'receiver', connectorClass: 'hip' },
    { id: 'hipRight', role: 'receiver', connectorClass: 'hip' },
    { id: 'tailRoot', role: 'receiver', connectorClass: 'tail' },
    { id: 'extraLeft', role: 'receiver', connectorClass: 'extra' },
    { id: 'extraRight', role: 'receiver', connectorClass: 'extra' },
  ],
  headShape: [{ id: 'neck', role: 'plug', connectorClass: 'neck' }],
  arms: [
    { id: 'shoulderLeft', role: 'plug', connectorClass: 'shoulder' },
    { id: 'shoulderRight', role: 'plug', connectorClass: 'shoulder' },
  ],
  legs: [
    { id: 'hipLeft', role: 'plug', connectorClass: 'hip' },
    { id: 'hipRight', role: 'plug', connectorClass: 'hip' },
  ],
  tail: [{ id: 'tailRoot', role: 'plug', connectorClass: 'tail' }],
  extraAppendage: [
    { id: 'extraLeft', role: 'plug', connectorClass: 'extra' },
    { id: 'extraRight', role: 'plug', connectorClass: 'extra' },
  ],
}

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function reportDuplicateIds(
  values: ReadonlyArray<{ id: string }>,
  scope: string,
  diagnostics: Diagnostic[],
): Set<string> {
  const ids = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (ids.has(value.id)) {
      diagnostics.push(error('CATALOG_ID_DUPLICATE', [scope, String(index), 'id'], `Duplicate ${scope} ID: ${value.id}`))
    }
    ids.add(value.id)
  }
  return ids
}

function reportMissingFixedIds(
  ids: Set<string>,
  requiredIds: Set<string>,
  kind: 'THEME' | 'RIG',
  diagnostics: Diagnostic[],
): void {
  for (const id of requiredIds) {
    if (!ids.has(id)) diagnostics.push(error(`CATALOG_${kind}_UNCOVERED`, [kind.toLowerCase()], `Missing required ${kind.toLowerCase()}: ${id}`))
  }
}

function hasCycle(dependencies: Catalog['dependencies']): boolean {
  const visiting = new Set<VisualSlotId>()
  const visited = new Set<VisualSlotId>()
  const visit = (slotId: VisualSlotId): boolean => {
    if (visiting.has(slotId)) return true
    if (visited.has(slotId)) return false
    visiting.add(slotId)
    for (const next of dependencies[slotId] ?? []) {
      if (visit(next)) return true
    }
    visiting.delete(slotId)
    visited.add(slotId)
    return false
  }
  return VISUAL_SLOT_IDS.some(visit)
}

function isUnitVector(vector: { x: number; y: number }): boolean {
  const length = Math.hypot(vector.x, vector.y)
  return Math.abs(length - 1) < 0.0001
}

function isCanonicalResourcePath(path: string, extension: '.png' | '.webp'): boolean {
  const suffix = extension === '.png' ? 'png' : 'webp'
  return new RegExp(`^assets/v0\\.3\\.0/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\\.${suffix}$`, 'u').test(path)
}

function hasCanonicalHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash)
}

function requiredConnectorProfiles(catalog: Catalog, part: Catalog['parts'][number], rigId: RigId): ReadonlyArray<{
  id: string
  role: 'receiver' | 'plug'
  connectorClass: ConnectorClass
}> {
  if (part.slotId !== 'bodyFrame') return REQUIRED_CONNECTORS[part.slotId] ?? []
  const required = new Map<string, { id: string; role: 'receiver'; connectorClass: ConnectorClass }>()
  for (const child of catalog.parts) {
    if (child.slotId === 'bodyFrame' || !isStructuralSlot(child.slotId) || child.composition?.isNone || !child.compatibleRigs.includes(rigId)) continue
    const composition = child.composition
    if (composition?.mode !== 'interface') continue
    const variant = composition.variantsByRig[rigId]
    if (variant === undefined) continue
    for (const connector of variant.connectors) {
      if (connector.role !== 'plug') continue
      required.set(`${connector.id}:${connector.connectorClass}`, { id: connector.id, role: 'receiver', connectorClass: connector.connectorClass })
    }
  }
  return [...required.values()]
}

function validateInterfaceStructure(catalog: Catalog, diagnostics: Diagnostic[]): void {
  if (catalog.version !== '0.3.0' && catalog.version !== '0.4.0') return
  const bridges = catalog.transitionBridges ?? []
  reportDuplicateIds(bridges, 'transitionBridges', diagnostics)
  for (const [partIndex, part] of catalog.parts.entries()) {
    if (!isStructuralSlot(part.slotId) || part.composition?.isNone) continue
    const composition = part.composition
    const path = ['parts', String(partIndex), 'composition']
    if (composition?.mode !== 'interface') {
      diagnostics.push(error(
        'CONNECTOR_INTERFACE_MODE_REQUIRED',
        path,
        `Structural part ${part.id} must use interface composition mode in catalog ${catalog.version}.`,
      ))
      continue
    }
    const variantRigIds = Array.from(new Set([
      ...part.compatibleRigs,
      ...Object.keys(composition.variantsByRig),
    ])) as RigId[]
    for (const rigId of variantRigIds) {
      const variant = composition.variantsByRig[rigId]
      const variantPath = path.concat('variantsByRig', rigId)
      if (variant === undefined || variant.rigId !== rigId) {
        diagnostics.push(error(
          'CONNECTOR_VARIANT_MISSING',
          variantPath,
          `Structural part ${part.id} requires an exact ${rigId} variant.`,
        ))
        continue
      }
      for (const [nodeIndex, node] of variant.renderNodes.entries()) {
        if (node.compatibleRigs.length !== 1 || node.compatibleRigs[0] !== rigId) {
          diagnostics.push(error(
            'CONNECTOR_RENDER_NODE_UNIVERSAL',
            variantPath.concat('renderNodes', String(nodeIndex), 'compatibleRigs'),
            `Structural node ${node.id} must target only its exact ${rigId} rig.`,
          ))
        }
      }
      const requiredConnectors = requiredConnectorProfiles(catalog, part, rigId)
      for (const expected of requiredConnectors) {
        const matching = variant.connectors.filter(connector => connector.id === expected.id)
        if (
          matching.length !== 1
          || matching[0]!.role !== expected.role
          || matching[0]!.connectorClass !== expected.connectorClass
        ) {
          diagnostics.push(error(
            'CONNECTOR_PROFILE_INVALID',
            variantPath.concat('connectors'),
            `Structural variant ${part.id}/${rigId} requires one ${expected.role} ${expected.id} connector.`,
          ))
        }
      }
      for (const [connectorIndex, connector] of variant.connectors.entries()) {
        const connectorPath = variantPath.concat('connectors', String(connectorIndex))
        if (connector.rigId !== rigId) {
          diagnostics.push(error(
            'CONNECTOR_RIG_MISMATCH',
            connectorPath.concat('rigId'),
            `Connector ${connector.id} must match its containing ${rigId} variant.`,
          ))
        }
        if (
          !isUnitVector(connector.tangent)
          || !isUnitVector(connector.outwardNormal)
          || connector.width <= 0
          || connector.depth <= 0
        ) {
          diagnostics.push(error(
            'CONNECTOR_PROFILE_INVALID',
            connectorPath,
            `Connector ${connector.id} requires normalized tangent and normal vectors with positive dimensions.`,
          ))
        }
        const connectorResources = [
          [connector.contourMaskPath, connector.contourMaskSha256],
          [connector.foregroundMaskPath, connector.foregroundMaskSha256],
          [connector.backgroundMaskPath, connector.backgroundMaskSha256],
        ] as const
        if (connectorResources.some(([resourcePath, hash]) => (
          !isCanonicalResourcePath(resourcePath, '.png') || !hasCanonicalHash(hash)
        ))) {
          diagnostics.push(error(
            'CONNECTOR_RESOURCE_INVALID',
            connectorPath,
            `Connector ${connector.id} must declare canonical mask paths and SHA-256 hashes.`,
          ))
        }
        const hasBridge = bridges.some(bridge => (
          bridge.rigId === rigId
          && bridge.connectorClass === connector.connectorClass
          && bridge.materialFamilies.includes(variant.materialFamily as MaterialFamily)
        ))
        if (!hasBridge) {
          diagnostics.push(error(
            'CONNECTOR_BRIDGE_MISSING',
            connectorPath,
            `Connector ${connector.id} requires a matching ${rigId} ${connector.connectorClass} bridge.`,
          ))
        }
      }
    }
  }
  for (const [bridgeIndex, bridge] of bridges.entries()) {
    const bridgePath = ['transitionBridges', String(bridgeIndex)]
    const resources: ReadonlyArray<[string, string, '.png' | '.webp']> = [
      [bridge.neutralAssetPath, bridge.neutralAssetSha256, '.webp'],
      [bridge.neutralPngPath, bridge.neutralPngSha256, '.png'],
      [bridge.frontMaskPath, bridge.frontMaskSha256, '.png'],
      [bridge.backMaskPath, bridge.backMaskSha256, '.png'],
    ]
    if (resources.some(([resourcePath, hash, extension]) => (
      !isCanonicalResourcePath(resourcePath, extension) || !hasCanonicalHash(hash)
    ))) {
      diagnostics.push(error(
        'CONNECTOR_BRIDGE_RESOURCE_INVALID',
        bridgePath,
        `Bridge ${bridge.id} must declare canonical resource paths and SHA-256 hashes.`,
      ))
    }
  }
}

function validateCompositionStructure(catalog: Catalog, diagnostics: Diagnostic[]): void {
  if (catalog.version !== '0.2.0') return

  const policy = catalog.compositionPolicy
  if (policy === undefined) {
    diagnostics.push(error(
      'COMPOSITION_POLICY_MISSING',
      ['compositionPolicy'],
      'Catalog 0.2.0 requires a composition policy.',
    ))
  }

  const partsBySlot = new Map<VisualSlotId, Catalog['parts']>()
  for (const part of catalog.parts) {
    const parts = partsBySlot.get(part.slotId) ?? []
    parts.push(part)
    partsBySlot.set(part.slotId, parts)
  }

  if (policy !== undefined) {
    const motifSlots = new Set<VisualSlotId>()
    for (const [index, slotId] of policy.motifSlots.entries()) {
      if (motifSlots.has(slotId)) {
        diagnostics.push(error(
          'COMPOSITION_MOTIF_SLOT_DUPLICATE',
          ['compositionPolicy', 'motifSlots', String(index)],
          `Composition motif slot ${slotId} appears more than once.`,
        ))
      }
      motifSlots.add(slotId)
    }
  }

  const nodeIds = new Set<string>()
  for (const [partIndex, part] of catalog.parts.entries()) {
    const path = ['parts', String(partIndex)]
    const composition = part.composition
    if (composition === undefined) {
      diagnostics.push(error(
        'COMPOSITION_PART_METADATA_MISSING',
        path.concat('composition'),
        `Composition catalog part ${part.id} is missing composition metadata.`,
      ))
      continue
    }
    if (composition.mode === 'interface') {
      diagnostics.push(error(
        'COMPOSITION_INTERFACE_MODE_FORBIDDEN',
        path.concat('composition', 'mode'),
        `Composition catalog part ${part.id} must use attachment mode in catalog 0.2.0.`,
      ))
      continue
    }
    if ((part.approvedTransforms?.length ?? 0) > 0) {
      diagnostics.push(error(
        'COMPOSITION_APPROVED_TRANSFORM_FORBIDDEN',
        path.concat('approvedTransforms'),
        `Composition part ${part.id} must use render-node transforms only.`,
      ))
    }
    if (composition.isNone) {
      if (composition.renderNodes.length > 0) {
        diagnostics.push(error(
          'COMPOSITION_NONE_HAS_NODES',
          path.concat('composition', 'renderNodes'),
          `Explicit none part ${part.id} must not have visible render nodes.`,
        ))
      }
      continue
    }
    if (composition.renderNodes.length === 0) {
      diagnostics.push(error(
        'COMPOSITION_NODES_MISSING',
        path.concat('composition', 'renderNodes'),
        `Visible composition part ${part.id} must define at least one render node.`,
      ))
    }
    if (
      REQUIRED_PROVIDER_SOCKETS[part.slotId] !== undefined
      && composition.renderNodes.length !== 1
    ) {
      diagnostics.push(error(
        'COMPOSITION_PROVIDER_AMBIGUOUS',
        path.concat('composition', 'renderNodes'),
        `Socket-providing part ${part.id} must define exactly one render node.`,
      ))
    }

    const expectedParentSlot = COMPOSITION_PARENT_BY_SLOT[part.slotId]
    for (const [nodeIndex, node] of composition.renderNodes.entries()) {
      const nodePath = path.concat('composition', 'renderNodes', String(nodeIndex))
      if (nodeIds.has(node.id)) {
        diagnostics.push(error(
          'COMPOSITION_NODE_ID_DUPLICATE',
          nodePath.concat('id'),
          `Composition node ID ${node.id} is duplicated.`,
        ))
      }
      nodeIds.add(node.id)

      if (node.parentSlot !== expectedParentSlot) {
        diagnostics.push(error(
          'COMPOSITION_PARENT_SLOT_INVALID',
          nodePath.concat('parentSlot'),
          `Node ${node.id} must target ${expectedParentSlot ?? 'the composition root'}.`,
        ))
        continue
      }
      if (expectedParentSlot === null) continue
      if (node.socket === null) {
        diagnostics.push(error(
          'COMPOSITION_SOCKET_MISSING',
          nodePath.concat('socket'),
          `Visible node ${node.id} requires an explicit parent socket.`,
        ))
        continue
      }

      for (const rigId of node.compatibleRigs) {
        const parentCandidates = (partsBySlot.get(expectedParentSlot) ?? []).filter(candidate => (
          candidate.compatibleRigs.includes(rigId) && !candidate.composition?.isNone
        ))
        if (parentCandidates.length === 0 || parentCandidates.some(candidate => (
          !isAttachmentPartComposition(candidate.composition)
          || candidate.composition.geometryByRig[rigId]?.sockets[node.socket!] === undefined
        ))) {
          diagnostics.push(error(
            'COMPOSITION_SOCKET_MISSING',
            nodePath.concat('socket'),
            `Every ${expectedParentSlot} candidate for ${rigId} must provide socket ${node.socket}.`,
          ))
        }
      }
    }

    for (const rigId of part.compatibleRigs) {
      const geometry = composition.geometryByRig[rigId]
      for (const socket of REQUIRED_PROVIDER_SOCKETS[part.slotId] ?? []) {
        if (geometry?.sockets[socket] === undefined) {
          diagnostics.push(error(
            'COMPOSITION_SOCKET_MISSING',
            path.concat('composition', 'geometryByRig', rigId, 'sockets', socket),
            `Part ${part.id} must provide ${socket} for ${rigId}.`,
          ))
        }
      }
      if (part.slotId === 'headShape' && geometry?.faceSafeZone === undefined) {
        diagnostics.push(error(
          'COMPOSITION_FACE_ZONE_MISSING',
          path.concat('composition', 'geometryByRig', rigId, 'faceSafeZone'),
          `Head part ${part.id} requires a face safe zone for ${rigId}.`,
        ))
      }
    }
  }

  for (const slotId of MANDATORY_SLOTS) {
    for (const themeId of REQUIRED_THEME_IDS) {
      for (const rigId of REQUIRED_RIG_IDS) {
        const hasQuietFallback = (partsBySlot.get(slotId) ?? []).some(part => {
          const composition = part.composition
          return composition?.isNone === false
          && composition.visualIntensity === 'quiet'
          && composition.motifTags.includes(themeId as typeof composition.motifTags[number])
          && part.compatibleRigs.includes(rigId as typeof part.compatibleRigs[number])
        })
        if (!hasQuietFallback) {
          diagnostics.push(error(
            'COMPOSITION_QUIET_FALLBACK_MISSING',
            ['parts', slotId],
            `Mandatory slot ${slotId} has no quiet ${themeId} fallback for ${rigId}.`,
          ))
        }
      }
    }
  }

  for (const slotId of OPTIONAL_SLOTS) {
    if (!(partsBySlot.get(slotId) ?? []).some(part => part.composition?.isNone === true)) {
      diagnostics.push(error(
        'COMPOSITION_OPTIONAL_NONE_MISSING',
        ['parts', slotId],
        `Optional slot ${slotId} requires an explicit composition none candidate.`,
      ))
    }
  }
}

export function validateCatalogStructure(catalog: Catalog): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (catalog.version === '0.1.0' && catalog.compositionPolicy !== undefined) {
    diagnostics.push(error(
      'CATALOG_COMPOSITION_POLICY_FORBIDDEN',
      ['compositionPolicy'],
      'Catalog 0.1.0 does not support composition policy metadata.',
    ))
  }
  const themeIds = reportDuplicateIds(catalog.themes, 'themes', diagnostics)
  const rigIds = reportDuplicateIds(catalog.rigs, 'rigs', diagnostics)
  const partIds = reportDuplicateIds(catalog.parts, 'parts', diagnostics)
  const semanticTraitIds = reportDuplicateIds(catalog.semanticTraits, 'semanticTraits', diagnostics)
  const modifierIds = reportDuplicateIds(catalog.modifiers, 'modifiers', diagnostics)
  reportMissingFixedIds(themeIds, REQUIRED_THEME_IDS, 'THEME', diagnostics)
  reportMissingFixedIds(rigIds, REQUIRED_RIG_IDS, 'RIG', diagnostics)

  const rigs = new Map(catalog.rigs.map(rig => [rig.id, rig]))
  for (const [index, part] of catalog.parts.entries()) {
    const path = ['parts', String(index)]
    for (const [transformIndex, transform] of (part.approvedTransforms ?? []).entries()) {
      if (!Number.isFinite(transform.scale) || transform.scale <= 0) {
        diagnostics.push(error('CATALOG_TRANSFORM_INVALID', path.concat('approvedTransforms', String(transformIndex)), `Part ${part.id} has an invalid approved transform scale.`))
      }
    }
    if (part.compatibleRigs.length === 0) {
      diagnostics.push(error('CATALOG_COMPATIBLE_RIGS_EMPTY', path.concat('compatibleRigs'), `Part ${part.id} must support at least one rig.`))
    }
    for (const themeId of part.themeIds) {
      if (!themeIds.has(themeId)) diagnostics.push(error('CATALOG_DANGLING_THEME', path.concat('themeIds'), `Part ${part.id} references unknown theme ${themeId}.`))
    }
    for (const themeId of Object.keys(part.themeWeights)) {
      if (!themeIds.has(themeId)) diagnostics.push(error('CATALOG_DANGLING_THEME_WEIGHT', path.concat('themeWeights', themeId), `Part ${part.id} weights unknown theme ${themeId}.`))
    }
    for (const rigId of part.compatibleRigs) {
      const rig = rigs.get(rigId)
      if (!rig) {
        diagnostics.push(error('CATALOG_DANGLING_RIG', path.concat('compatibleRigs'), `Part ${part.id} references unknown rig ${rigId}.`))
      } else if (part.socket !== null && rig.sockets[part.socket] === undefined) {
        diagnostics.push(error('CATALOG_SOCKET_MISSING', path.concat('socket'), `Rig ${rigId} has no ${part.socket} socket for part ${part.id}.`))
      }
    }
    if (part.semanticTraitId !== null && !semanticTraitIds.has(part.semanticTraitId)) {
      diagnostics.push(error('CATALOG_DANGLING_SEMANTIC_TRAIT', path.concat('semanticTraitId'), `Part ${part.id} references unknown semantic trait ${part.semanticTraitId}.`))
    }
    for (const excludedPartId of part.excludes) {
      if (!partIds.has(excludedPartId)) diagnostics.push(error('CATALOG_DANGLING_EXCLUDE', path.concat('excludes'), `Part ${part.id} excludes unknown part ${excludedPartId}.`))
    }
    for (const boostedTraitId of Object.keys(part.boosts)) {
      if (!semanticTraitIds.has(boostedTraitId)) diagnostics.push(error('CATALOG_DANGLING_BOOST', path.concat('boosts', boostedTraitId), `Part ${part.id} boosts unknown trait ${boostedTraitId}.`))
    }
  }

  for (const [index, semantic] of catalog.semanticTraits.entries()) {
    const path = ['semanticTraits', String(index)]
    for (const excludedId of semantic.excludes ?? []) {
      if (!semanticTraitIds.has(excludedId) && !partIds.has(excludedId)) diagnostics.push(error('CATALOG_DANGLING_SEMANTIC_EXCLUDE', path.concat('excludes'), `Semantic trait ${semantic.id} excludes unknown semantic trait or part ${excludedId}.`))
    }
    for (const boostedPartId of Object.keys(semantic.boosts ?? {})) {
      if (!partIds.has(boostedPartId)) diagnostics.push(error('CATALOG_DANGLING_SEMANTIC_BOOST', path.concat('boosts', boostedPartId), `Semantic trait ${semantic.id} boosts unknown part ${boostedPartId}.`))
    }
  }

  for (const [index, modifier] of catalog.modifiers.entries()) {
    const path = ['modifiers', String(index)]
    for (const excludedId of modifier.excludes ?? []) {
      if (!modifierIds.has(excludedId)) diagnostics.push(error('CATALOG_DANGLING_MODIFIER_EXCLUDE', path.concat('excludes'), `Modifier ${modifier.id} excludes unknown modifier ${excludedId}.`))
    }
    for (const boostedPartId of Object.keys(modifier.boosts ?? {})) {
      if (!partIds.has(boostedPartId)) diagnostics.push(error('CATALOG_DANGLING_MODIFIER_BOOST', path.concat('boosts', boostedPartId), `Modifier ${modifier.id} boosts unknown part ${boostedPartId}.`))
    }
  }

  for (const slotId of MANDATORY_SLOTS) {
    if (!catalog.parts.some(part => part.slotId === slotId)) {
      diagnostics.push(error('CATALOG_SLOT_UNCOVERED', ['parts'], `Mandatory slot ${slotId} has no candidates.`))
    }
  }
  for (const slotId of OPTIONAL_SLOTS) {
    if (catalog.compositionPolicy === undefined && !catalog.parts.some(part => part.slotId === slotId && part.id.endsWith('_none'))) {
      diagnostics.push(error('CATALOG_OPTIONAL_NONE_MISSING', ['parts'], `Optional slot ${slotId} needs an explicit none candidate.`))
    }
  }

  validateCompositionStructure(catalog, diagnostics)
  validateInterfaceStructure(catalog, diagnostics)

  if (hasCycle(catalog.dependencies)) {
    diagnostics.push(error('CATALOG_DEPENDENCY_CYCLE', ['dependencies'], 'Catalog slot dependencies must be acyclic.'))
  }
  return diagnostics
}
