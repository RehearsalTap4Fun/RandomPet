import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  generateMonster,
  type Catalog,
  type GenerationRequest,
  type MonsterSpec,
  type RigDefinition,
  type VisualPartDefinition,
  type VisualSlotId,
} from '@qmonster/generator-core'

export interface ProductionReviewBundle {
  catalog: Catalog
  spec: MonsterSpec
}

const transparentAsset = '/render-fixtures/assets/transparent.png'

function transparentPart(slotId: VisualSlotId, rigId: RigDefinition['id']): VisualPartDefinition {
  return {
    id: `review_none_${slotId}`,
    slotId,
    rarity: 'N',
    baseWeight: 1,
    themeIds: ['deep-sea', 'fungal', 'shadow'],
    themeWeights: { 'deep-sea': 1, fungal: 1, shadow: 1 },
    compatibleRigs: [rigId],
    assetPath: transparentAsset,
    maskPaths: {},
    origin: { x: 0, y: 0 },
    socket: null,
    layer: slotId === 'effect' ? 'foregroundEffect' : 'pattern',
    semanticTraitId: null,
    semanticPriority: 0,
    excludes: [],
    boosts: {},
  }
}

function buildLegacyReviewBundle(
  production: Catalog,
  rig: RigDefinition,
  target?: VisualPartDefinition,
): ProductionReviewBundle {
  const selectedParts = VISUAL_SLOT_IDS.map(slotId => {
    if (target?.slotId === slotId) return target
    if (slotId !== 'bodyFrame') return transparentPart(slotId, rig.id)
    return {
      ...transparentPart('bodyFrame', rig.id),
      id: `review_locked_${rig.id}`,
      assetPath: `/production-assets/rigs/base_${rig.id}_v1.png`,
      origin: { x: 512, y: 512 },
      layer: 'body' as const,
    }
  })
  const theme = production.themes.find(candidate => target?.themeIds.includes(candidate.id)) ?? production.themes[0]!
  const catalog: Catalog = {
    version: production.version,
    themes: production.themes,
    rigs: [rig],
    parts: selectedParts,
    semanticTraits: production.semanticTraits,
    modifiers: [],
    dependencies: {},
  }
  const semanticTraits = Object.fromEntries(SEMANTIC_SLOT_IDS.map(slotId => {
    const trait = production.semanticTraits.find(candidate => candidate.semanticSlotId === slotId)
    if (trait === undefined) throw new Error(`Production catalog has no semantic trait for ${slotId}`)
    return [slotId, { primaryTraitId: trait.id, detailTraitIds: [] }]
  })) as unknown as MonsterSpec['semanticTraits']
  return {
    catalog,
    spec: {
      schemaVersion: '0.1.0',
      catalogVersion: catalog.version,
      rendererVersion: '0.1.0',
      seed: `review-${rig.id}-${target?.id ?? 'base'}`,
      themeId: theme.id,
      palette: { ...theme.palette },
      slotRolls: Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [slotId, 0])) as MonsterSpec['slotRolls'],
      visualSlots: Object.fromEntries(selectedParts.map(part => [part.slotId, { partId: part.id, rigId: rig.id }])) as MonsterSpec['visualSlots'],
      semanticTraits,
      mutation: null,
      aberrations: [],
    },
  }
}

export function buildProductionReviewBundle(
  production: Catalog,
  rig: RigDefinition,
  target?: VisualPartDefinition,
): ProductionReviewBundle {
  if (production.compositionPolicy === undefined) {
    return buildLegacyReviewBundle(production, rig, target)
  }
  const body = target?.slotId === 'bodyFrame'
    ? target
    : production.parts.find(part => part.slotId === 'bodyFrame' && part.compatibleRigs.includes(rig.id))
  if (body === undefined) throw new Error(`Production catalog has no bodyFrame for ${rig.id}`)
  const theme = production.themes.find(candidate => target?.themeIds.includes(candidate.id)) ?? production.themes[0]
  if (theme === undefined) throw new Error('Production catalog has no review theme')
  const byId = (id: string) => {
    const part = production.parts.find(candidate => candidate.id === id)
    if (part === undefined) throw new Error(`Production catalog has no review part ${id}`)
    return part
  }
  const compatible = (slotId: VisualSlotId) => {
    const part = production.parts.find(candidate => candidate.slotId === slotId && candidate.compatibleRigs.includes(rig.id))
    if (part === undefined) throw new Error(`Production catalog has no ${slotId} review fallback for ${rig.id}`)
    return part
  }
  const colorByTheme = {
    'deep-sea': 'color_deep_sea_coral',
    fungal: 'color_fungal_amber',
    shadow: 'color_shadow_violet',
  } as const
  const baseline = {
    bodyFrame: body,
    headShape: byId('head_round_dome'),
    eyes: byId('eyes_glossy_pair'),
    mouthShape: byId('mouth_soft_pout'),
    oralDetail: byId('oral_single_fang'),
    headAppendage: byId('head_appendage_none'),
    arms: compatible('arms'),
    legs: compatible('legs'),
    tail: byId('tail_none'),
    extraAppendage: byId('extra_appendage_none'),
    surfaceMaterial: byId('surface_short_fur'),
    pattern: compatible('pattern'),
    colorScheme: byId(colorByTheme[theme.id]),
    effect: byId('effect_none'),
  }
  if (target !== undefined) baseline[target.slotId] = target
  const lockedSelections = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
    slotId, baseline[slotId].id,
  ])) as NonNullable<GenerationRequest['lockedSelections']>
  const result = generateMonster({
    seed: `review-${rig.id}-${target?.id ?? 'base'}`,
    themeId: theme.id,
    mode: 'normal',
    lockedSelections,
  }, production)
  const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`Invalid production review composition for ${target?.id ?? 'base'}/${rig.id}: ${JSON.stringify(errors)}`)
  }
  // Review bundles deliberately author phenotype-only combinations after this
  // boundary, so expose them as supported legacy specs rather than inventing
  // hereditary data for those later visual overrides.
  delete result.spec.genome
  return { catalog: production, spec: result.spec }
}
