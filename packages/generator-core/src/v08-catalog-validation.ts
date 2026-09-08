import {
  INDEPENDENT_PART_POOL_COUNTS,
  STRUCTURAL_SLOT_IDS,
  V08_BLEND_MODES,
  VISUAL_SLOT_IDS,
  type Diagnostic,
  type Rarity,
  type ResourceRef,
  type V08ExpressionKind,
  type V08RegionId,
  type V08SpeciesRigCatalog,
  type VisualSlotId,
} from './contracts.js'

interface V08SlotOwnerPolicy {
  expressionKind: V08ExpressionKind
  ownerRegionId: V08RegionId
  blendModes: readonly (typeof V08_BLEND_MODES[number])[]
}

export const V08_FELINE_LAYER_ORDER: readonly VisualSlotId[] = [
  'colorScheme', 'surfaceMaterial', 'pattern', 'bodyFrame', 'tail', 'arms',
  'legs', 'headShape', 'eyes', 'mouthShape', 'oralDetail', 'headAppendage',
  'extraAppendage', 'effect',
]

export const V08_SLOT_OWNER_POLICY: Record<VisualSlotId, V08SlotOwnerPolicy> = {
  bodyFrame: { expressionKind: 'body-clipped', ownerRegionId: 'bodySurface', blendModes: ['source-over', 'soft-light'] },
  headShape: { expressionKind: 'head-clipped', ownerRegionId: 'headSurface', blendModes: ['source-over', 'soft-light'] },
  arms: { expressionKind: 'anchor-clipped', ownerRegionId: 'frontPawDetail', blendModes: ['source-over'] },
  legs: { expressionKind: 'anchor-clipped', ownerRegionId: 'hindPawDetail', blendModes: ['source-over'] },
  tail: { expressionKind: 'body-clipped', ownerRegionId: 'tailSurface', blendModes: ['source-over', 'multiply'] },
  extraAppendage: { expressionKind: 'anchor-clipped', ownerRegionId: 'mutationBack', blendModes: ['source-over'] },
  eyes: { expressionKind: 'face-clipped', ownerRegionId: 'eyesRegion', blendModes: ['source-over'] },
  mouthShape: { expressionKind: 'face-clipped', ownerRegionId: 'mouthRegion', blendModes: ['source-over'] },
  oralDetail: { expressionKind: 'face-clipped', ownerRegionId: 'oralRegion', blendModes: ['source-over'] },
  headAppendage: { expressionKind: 'anchor-clipped', ownerRegionId: 'headAccessory', blendModes: ['source-over'] },
  surfaceMaterial: { expressionKind: 'body-clipped', ownerRegionId: 'bodySurface', blendModes: ['soft-light', 'source-over'] },
  pattern: { expressionKind: 'body-clipped', ownerRegionId: 'bodySurface', blendModes: ['multiply', 'source-over'] },
  colorScheme: { expressionKind: 'body-clipped', ownerRegionId: 'bodySurface', blendModes: ['color', 'source-over'] },
  effect: { expressionKind: 'protected-effect', ownerRegionId: 'effectField', blendModes: ['screen', 'source-over'] },
}

function issue(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validResource(resource: ResourceRef | undefined, version: string): boolean {
  if (resource === undefined) return false
  const root = `assets/v${version}/`
  return resource.assetPath.startsWith(root)
    && resource.pngPath.startsWith(root)
    && resource.assetPath.endsWith('.webp')
    && resource.pngPath.endsWith('.png')
    && /^[a-f0-9]{64}$/iu.test(resource.assetSha256)
    && /^[a-f0-9]{64}$/iu.test(resource.pngSha256)
}

export function validateV08SpeciesRigCatalog(catalog: V08SpeciesRigCatalog): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const structuralSlots = new Set<VisualSlotId>(STRUCTURAL_SLOT_IDS)
  const rigIds = new Set<string>()
  const rigById = new Map<string, V08SpeciesRigCatalog['speciesRigs'][number]>()
  const partsById = new Map(catalog.parts.map(part => [part.id, part]))

  if ((catalog.speciesRigs ?? []).length === 0) {
    diagnostics.push(issue('V08_SPECIES_RIG_MISSING', ['speciesRigs'], 'Catalog 0.8.0 requires a species rig.'))
  }
  if ((catalog.anatomyBundles ?? []).length === 0) {
    diagnostics.push(issue('V08_ANATOMY_BUNDLE_MISSING', ['anatomyBundles'], 'Catalog 0.8.0 requires an anatomy bundle.'))
  }

  if (catalog.transitionBridges !== undefined) {
    diagnostics.push(issue(
      'V08_TRANSITION_BRIDGE_FORBIDDEN',
      ['transitionBridges'],
      'Catalog 0.8.0 cannot contain transition bridges.',
    ))
  }

  for (const [rigIndex, speciesRig] of (catalog.speciesRigs ?? []).entries()) {
    const path = ['speciesRigs', String(rigIndex)]
    if (rigIds.has(speciesRig.id)) {
      diagnostics.push(issue('V08_SPECIES_RIG_ID_DUPLICATE', path.concat('id'), `Duplicate species rig ${speciesRig.id}.`))
    }
    rigIds.add(speciesRig.id)
    rigById.set(speciesRig.id, speciesRig)
    if (
      speciesRig.id !== 'feline-sit-v1'
      || speciesRig.archetypeId !== 'feline'
      || speciesRig.rigId !== 'feline-sit'
      || speciesRig.poseId !== 'sit'
    ) {
      diagnostics.push(issue('V08_SPECIES_RIG_IDENTITY_INVALID', path, 'The first v0.8 release requires feline-sit-v1.'))
    }
    if (!sameArray(speciesRig.layerOrder, V08_FELINE_LAYER_ORDER)) {
      diagnostics.push(issue('V08_LAYER_ORDER_INVALID', path.concat('layerOrder'), 'The feline layer order is immutable.'))
    }
    for (const slotId of VISUAL_SLOT_IDS) {
      if (speciesRig.allowedSlotExpressions[slotId] !== V08_SLOT_OWNER_POLICY[slotId].expressionKind) {
        diagnostics.push(issue(
          'V08_ALLOWED_EXPRESSION_INVALID',
          path.concat('allowedSlotExpressions', slotId),
          `Slot ${slotId} has an invalid allowed expression.`,
        ))
      }
    }
    for (const [regionId, resource] of Object.entries(speciesRig.regions)) {
      if (!validResource(resource, '0.8.0')) {
        diagnostics.push(issue('V08_REGION_RESOURCE_INVALID', path.concat('regions', regionId), `Region ${regionId} has an invalid v0.8 resource.`))
      }
    }
  }

  for (const [partIndex, part] of catalog.parts.entries()) {
    const path = ['parts', String(partIndex)]
    const composition = part.composition
    if (composition?.mode !== 'species-rig') {
      diagnostics.push(issue(
        structuralSlots.has(part.slotId)
          ? 'V08_STRUCTURAL_PART_TOPOLOGY_FORBIDDEN'
          : 'V08_PART_COMPOSITION_INVALID',
        path.concat('composition', 'mode'),
        `Part ${part.id} must use species-rig composition.`,
      ))
      continue
    }
    const speciesRig = rigById.get(composition.speciesRigId)
    const policy = V08_SLOT_OWNER_POLICY[part.slotId]
    if (speciesRig === undefined) {
      diagnostics.push(issue('V08_PART_SPECIES_RIG_MISSING', path.concat('composition', 'speciesRigId'), `Part ${part.id} references an unknown species rig.`))
    } else {
      if (composition.rigVersion !== speciesRig.rigVersion) {
        diagnostics.push(issue('V08_PART_RIG_VERSION_MISMATCH', path.concat('composition', 'rigVersion'), `Part ${part.id} has a mismatched rig version.`))
      }
      if (composition.sourceMasterSha256 !== speciesRig.sourceMasterSha256) {
        diagnostics.push(issue('V08_PART_MASTER_MISMATCH', path.concat('composition', 'sourceMasterSha256'), `Part ${part.id} has a mismatched master hash.`))
      }
    }
    if (composition.ownerRegionId !== policy.ownerRegionId) {
      diagnostics.push(issue('V08_PART_OWNER_REGION_INVALID', path.concat('composition', 'ownerRegionId'), `Part ${part.id} is outside its slot owner region.`))
    }
    if (composition.expressionKind !== policy.expressionKind) {
      diagnostics.push(issue('V08_PART_EXPRESSION_INVALID', path.concat('composition', 'expressionKind'), `Part ${part.id} uses an invalid expression kind.`))
    }
    if (!policy.blendModes.includes(composition.blendMode)) {
      diagnostics.push(issue('V08_PART_BLEND_MODE_INVALID', path.concat('composition', 'blendMode'), `Part ${part.id} uses an invalid blend mode.`))
    }
    if (
      (part.approvedTransforms?.length ?? 0) !== 1
      || part.approvedTransforms?.[0]?.scale !== 1
      || part.approvedTransforms[0]?.mirrorX !== false
    ) {
      diagnostics.push(issue('V08_PART_TRANSFORM_INVALID', path.concat('approvedTransforms'), `Part ${part.id} must declare only the identity transform.`))
    }
    if (
      part.compatibleRigs.length !== 1
      || part.compatibleRigs[0] !== 'feline-sit'
    ) {
      diagnostics.push(issue('V08_PART_RIG_MISMATCH', path.concat('compatibleRigs'), `Part ${part.id} must support only feline-sit.`))
    }
    if (part.archetypeIds?.length !== 1 || part.archetypeIds[0] !== 'feline') {
      diagnostics.push(issue('V08_PART_ARCHETYPE_MISMATCH', path.concat('archetypeIds'), `Part ${part.id} must support only feline.`))
    }
    if (!validResource({
      assetPath: part.assetPath,
      assetSha256: part.assetSha256 ?? '',
      pngPath: part.pngPath ?? '',
      pngSha256: part.pngSha256 ?? '',
    }, '0.8.0')) {
      diagnostics.push(issue('V08_PART_RESOURCE_INVALID', path.concat('assetPath'), `Part ${part.id} has an invalid v0.8 resource.`))
    }
  }

  const bundleIds = new Set<string>()
  for (const [bundleIndex, bundle] of (catalog.anatomyBundles ?? []).entries()) {
    const path = ['anatomyBundles', String(bundleIndex)]
    if (bundleIds.has(bundle.id)) {
      diagnostics.push(issue('V08_ANATOMY_BUNDLE_ID_DUPLICATE', path.concat('id'), `Duplicate anatomy bundle ${bundle.id}.`))
    }
    bundleIds.add(bundle.id)
    const speciesRig = rigById.get(bundle.speciesRigId)
    if (
      speciesRig === undefined
      || bundle.id !== 'feline-sit-canonical-v1'
      || bundle.archetypeId !== speciesRig.archetypeId
      || bundle.rigId !== speciesRig.rigId
      || bundle.poseId !== speciesRig.poseId
    ) {
      diagnostics.push(issue('V08_ANATOMY_BUNDLE_IDENTITY_MISMATCH', path, `Bundle ${bundle.id} does not match its species rig.`))
    }
    if (speciesRig !== undefined && bundle.sourceMasterSha256 !== speciesRig.sourceMasterSha256) {
      diagnostics.push(issue('V08_ANATOMY_BUNDLE_MASTER_MISMATCH', path.concat('sourceMasterSha256'), `Bundle ${bundle.id} has a mismatched master hash.`))
    }
    for (const [resourceId, resource] of Object.entries({
      structural: bundle.structural,
      alpha: bundle.alpha,
      clip: bundle.clip,
    })) {
      if (!validResource(resource, '0.8.0')) {
        diagnostics.push(issue('V08_ANATOMY_BUNDLE_RESOURCE_INVALID', path.concat(resourceId), `Bundle ${bundle.id} has an invalid ${resourceId} resource.`))
      }
    }
    for (const slotId of VISUAL_SLOT_IDS) {
      const poolPath = path.concat('partPools', slotId)
      const pool = bundle.partPools?.[slotId] ?? []
      const rarityCounts: Record<Rarity, number> = { N: 0, R: 0, L: 0 }
      const seenPartIds = new Set<string>()
      for (const partId of pool) {
        if (seenPartIds.has(partId)) {
          diagnostics.push(issue('V08_PART_POOL_DUPLICATE', poolPath, `Pool ${slotId} repeats part ${partId}.`))
        }
        seenPartIds.add(partId)
        const part = partsById.get(partId)
        if (part === undefined || part.slotId !== slotId) {
          diagnostics.push(issue('V08_PART_POOL_REFERENCE_INVALID', poolPath, `Pool ${slotId} references invalid part ${partId}.`))
          continue
        }
        rarityCounts[part.rarity] += 1
      }
      if ((['N', 'R', 'L'] as const).some(rarity => rarityCounts[rarity] !== INDEPENDENT_PART_POOL_COUNTS[rarity])) {
        diagnostics.push(issue(
          'V08_PART_POOL_RARITY_COUNT_INVALID',
          poolPath,
          `Pool ${slotId} requires exactly 8 N, 4 R, and 1 L traits.`,
        ))
      }
    }
  }

  return diagnostics
}
