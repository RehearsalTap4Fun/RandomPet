import type {
  AnimalArchetypeId,
  Diagnostic,
  MonsterSpecV09,
  MonsterSpec,
  Rarity,
  ThemeId,
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
    | 'speciesRigId'
    | 'visualSlots'
    | 'genome'
  > & { collectionRarity: Rarity }
}

export interface IncubatorGenerationRequestV09 {
  seed: string
  themeId: ThemeId
  speciesRigId: 'feline-sit-v2'
}

export interface IncubatorCreatureRecordV09 {
  seed: string
  visualExtension: Pick<
    MonsterSpecV09,
    | 'schemaVersion'
    | 'catalogVersion'
    | 'generatorVersion'
    | 'speciesRigId'
    | 'skeletonFamilyId'
    | 'assemblyTemplateId'
    | 'skeletonSelection'
    | 'visualSlots'
  > & { releaseManifestSha256: string }
}
