import type { Catalog, MonsterSpec, Rarity } from './contracts.js'

const RARITY_RANK: Record<Rarity, number> = { N: 0, R: 1, L: 2 }

export function deriveCollectionRarity(spec: MonsterSpec, catalog: Catalog): Rarity {
  const partById = new Map(catalog.parts.map(part => [part.id, part]))
  const modifierById = new Map(catalog.modifiers.map(modifier => [modifier.id, modifier]))
  const contributors: Array<Rarity | undefined> = [
    catalog.anatomyBundles?.find(bundle => bundle.id === spec.anatomyBundleId)?.rarity,
    ...Object.values(spec.visualSlots).map(selection => partById.get(selection.partId)?.rarity),
    spec.mutation === null ? undefined : modifierById.get(spec.mutation.id)?.rarity,
    ...spec.aberrations.map(application => modifierById.get(application.id)?.rarity),
  ]

  return contributors.reduce<Rarity>((highest, rarity) => (
    rarity !== undefined && RARITY_RANK[rarity] > RARITY_RANK[highest] ? rarity : highest
  ), 'N')
}
