import {
  LOCAL_VISUAL_SLOT_IDS,
  PART_RARITY_WEIGHTS,
  RARITY_WEIGHTS,
  STRUCTURAL_SLOT_IDS,
  type AnatomyBundleDefinition,
  type AnimalArchetypeId,
  type Catalog,
  type LocalVisualSlotId,
  type ModifierDefinition,
  type Rarity,
  type StructuralSlotId,
  type VisualPartDefinition,
  type VisualSlotId,
} from '@qmonster/generator-core'

export const RARITY_ORDER = ['N', 'R', 'L'] as const satisfies readonly Rarity[]

const RARITY_LABEL: Record<Rarity, string> = {
  N: '普通',
  R: '稀有',
  L: '传说',
}

const SLOT_LABEL: Record<VisualSlotId, string> = {
  bodyFrame: '躯干骨架',
  headShape: '头部轮廓',
  arms: '前肢',
  legs: '后肢',
  tail: '尾巴',
  extraAppendage: '额外肢体',
  eyes: '眼睛',
  mouthShape: '嘴型',
  oralDetail: '口腔细节',
  headAppendage: '头部附属物',
  surfaceMaterial: '表面材质',
  pattern: '纹理',
  colorScheme: '配色',
  effect: '特效',
}

export interface RarityCounts extends Record<Rarity, number> {}

export interface ReportCategoryRow {
  id: 'wholeAppearance' | VisualSlotId | 'mutation'
  label: string
  scope: 'wholeAppearance' | 'structural' | 'local' | 'catalogWide'
  counts: RarityCounts
}

export interface ReportTraitGroup {
  slotId: VisualSlotId
  label: string
  values: readonly string[]
  parts: readonly ReportTrait[]
}

export interface ReportTrait {
  id: string
  displayName: string
  rarity: Rarity
  ownerRegionId: string | null
  expressionKind: string | null
}

export interface ReportBundle {
  id: string
  label: string
  rarity: Rarity
  poseId: string
  structuralAssetPath: string
  structuralTraits: readonly ReportTraitGroup[]
  localTraits: readonly ReportTraitGroup[]
}

export interface ArchetypeReport {
  id: AnimalArchetypeId
  label: string
  bundleCounts: RarityCounts
  categoryRows: readonly ReportCategoryRow[]
  bundles: readonly ReportBundle[]
}

export interface CatalogReportModel {
  catalog: Catalog
  catalogVersion: string
  tierWeights: Record<Rarity, number>
  tierWeightUnit: '%' | '份'
  archetypes: readonly ArchetypeReport[]
  defaultArchetypeId: AnimalArchetypeId | null
}

export function rarityLabel(rarity: Rarity): string {
  return RARITY_LABEL[rarity]
}

export function createCatalogReportModel(catalog: Catalog): CatalogReportModel {
  const partsById = new Map(catalog.parts.map(part => [part.id, part]))
  const archetypeLabelById = new Map((catalog.archetypes ?? []).map(item => [item.id, item.displayName]))
  const bundlesByArchetype = new Map<AnimalArchetypeId, AnatomyBundleDefinition[]>()

  for (const bundle of catalog.anatomyBundles ?? []) {
    const bundles = bundlesByArchetype.get(bundle.archetypeId) ?? []
    bundles.push(bundle)
    bundlesByArchetype.set(bundle.archetypeId, bundles)
  }

  const archetypes = [...bundlesByArchetype.entries()].map(([id, bundles]) => (
    createArchetypeReport(id, archetypeLabelById.get(id) ?? id, bundles, partsById, catalog.modifiers)
  ))

  return {
    catalog,
    catalogVersion: catalog.version,
    tierWeights: { ...(catalog.version === '0.8.0' ? PART_RARITY_WEIGHTS : RARITY_WEIGHTS) },
    tierWeightUnit: catalog.version === '0.8.0' ? '份' : '%',
    archetypes,
    defaultArchetypeId: archetypes.some(item => item.id === 'feline') ? 'feline' : archetypes[0]?.id ?? null,
  }
}

function createArchetypeReport(
  id: AnimalArchetypeId,
  label: string,
  bundles: readonly AnatomyBundleDefinition[],
  partsById: ReadonlyMap<string, VisualPartDefinition>,
  modifiers: readonly ModifierDefinition[],
): ArchetypeReport {
  const reachablePartIds = new Set<string>()
  for (const bundle of bundles) {
    const independentPools = (bundle as AnatomyBundleDefinition & { partPools?: Partial<Record<VisualSlotId, string[]>> }).partPools
    if (independentPools !== undefined) {
      for (const partIds of Object.values(independentPools)) {
        for (const partId of partIds ?? []) reachablePartIds.add(partId)
      }
      continue
    }
    for (const partId of Object.values(bundle.derivedSlots ?? {})) reachablePartIds.add(partId)
    for (const partIds of Object.values(bundle.allowedTraitPools ?? {})) {
      for (const partId of partIds) reachablePartIds.add(partId)
    }
  }

  const reachableParts = [...reachablePartIds]
    .map(partId => partsById.get(partId))
    .filter((part): part is VisualPartDefinition => part !== undefined)

  return {
    id,
    label,
    bundleCounts: countByRarity(bundles),
    categoryRows: createCategoryRows(bundles, reachableParts, modifiers),
    bundles: bundles.map(bundle => projectBundle(bundle, partsById)),
  }
}

function createCategoryRows(
  bundles: readonly AnatomyBundleDefinition[],
  reachableParts: readonly VisualPartDefinition[],
  modifiers: readonly ModifierDefinition[],
): ReportCategoryRow[] {
  const structuralRows = STRUCTURAL_SLOT_IDS.map(slotId => categoryRow(slotId, 'structural', reachableParts))
  const localRows = LOCAL_VISUAL_SLOT_IDS.map(slotId => categoryRow(slotId, 'local', reachableParts))

  return [
    { id: 'wholeAppearance', label: '完整外形', scope: 'wholeAppearance', counts: countByRarity(bundles) },
    ...structuralRows,
    ...localRows,
    { id: 'mutation', label: '全局变异', scope: 'catalogWide', counts: countByRarity(modifiers) },
  ]
}

function categoryRow(
  slotId: StructuralSlotId | LocalVisualSlotId,
  scope: 'structural' | 'local',
  parts: readonly VisualPartDefinition[],
): ReportCategoryRow {
  return {
    id: slotId,
    label: SLOT_LABEL[slotId],
    scope,
    counts: countByRarity(parts.filter(part => part.slotId === slotId)),
  }
}

function projectBundle(
  bundle: AnatomyBundleDefinition,
  partsById: ReadonlyMap<string, VisualPartDefinition>,
): ReportBundle {
  const independentPools = (bundle as AnatomyBundleDefinition & { partPools?: Record<VisualSlotId, string[]> }).partPools
  return {
    id: bundle.id,
    label: bundle.id,
    rarity: bundle.rarity,
    poseId: bundle.poseId,
    structuralAssetPath: bundle.structural.pngPath,
    structuralTraits: STRUCTURAL_SLOT_IDS.map(slotId => traitGroup(
      slotId,
      independentPools?.[slotId] ?? [bundle.derivedSlots[slotId]],
      partsById,
    )),
    localTraits: LOCAL_VISUAL_SLOT_IDS.map(slotId => traitGroup(
      slotId,
      independentPools?.[slotId] ?? bundle.allowedTraitPools[slotId],
      partsById,
    )),
  }
}

function traitGroup(
  slotId: StructuralSlotId | LocalVisualSlotId,
  partIds: readonly string[],
  partsById: ReadonlyMap<string, VisualPartDefinition>,
): ReportTraitGroup {
  return {
    slotId,
    label: SLOT_LABEL[slotId],
    values: partIds.map(partId => labelForPart(partsById.get(partId), partId)),
    parts: partIds.map(partId => {
      const part = partsById.get(partId)
      const composition = part?.composition?.mode === 'species-rig' ? part.composition : undefined
      return {
        id: partId,
        displayName: labelForPart(part, partId),
        rarity: part?.rarity ?? 'N',
        ownerRegionId: composition?.ownerRegionId ?? null,
        expressionKind: composition?.expressionKind ?? null,
      }
    }),
  }
}

function labelForPart(part: VisualPartDefinition | undefined, fallbackId: string): string {
  return part?.displayName?.trim() || fallbackId
}

function countByRarity(items: ReadonlyArray<{ rarity?: Rarity }>): RarityCounts {
  const counts: RarityCounts = { N: 0, R: 0, L: 0 }
  for (const item of items) counts[item.rarity ?? 'N'] += 1
  return counts
}
