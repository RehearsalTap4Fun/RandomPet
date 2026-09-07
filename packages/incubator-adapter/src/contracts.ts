import type {
  AnimalArchetypeId,
  Diagnostic,
  MonsterSpec,
  Rarity,
} from '@qmonster/generator-core'

export type AdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: Diagnostic[] }

export interface IncubatorEggInput {
  id: string
  theme: 'deep_sea' | 'fungal' | 'shadow'
  seed: string | number
  risk: number
  mutationBonus: number
  archetype?: AnimalArchetypeId
}

export interface IncubatorCreatureRecord {
  theme: IncubatorEggInput['theme']
  seed: string
  traits: string[]
  mutation: string | null
  aberrations: string[]
  palette: [string, string, string]
  visualExtension: Pick<
    MonsterSpec,
    | 'schemaVersion'
    | 'catalogVersion'
    | 'rendererVersion'
    | 'archetypeId'
    | 'anatomyBundleId'
    | 'visualSlots'
    | 'genome'
  > & { collectionRarity: Rarity }
}
