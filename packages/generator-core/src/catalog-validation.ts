import {
  COMPOSITION_PARENT_BY_SLOT,
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
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
          candidate.composition?.geometryByRig[rigId]?.sockets[node.socket!] === undefined
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

  if (hasCycle(catalog.dependencies)) {
    diagnostics.push(error('CATALOG_DEPENDENCY_CYCLE', ['dependencies'], 'Catalog slot dependencies must be acyclic.'))
  }
  return diagnostics
}
