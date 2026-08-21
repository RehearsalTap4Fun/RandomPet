import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type MonsterSpec,
  type ThemeId,
  type VisualSlotId,
  type VisualSelection,
} from '@qmonster/generator-core'
import type { IncubatorCreatureRecord } from './contracts.js'

const legacyThemeMap: Record<ThemeId, IncubatorCreatureRecord['theme']> = {
  'deep-sea': 'deep_sea',
  fungal: 'fungal',
  shadow: 'shadow',
}

function copyVisualSlots(spec: MonsterSpec): Record<VisualSlotId, VisualSelection> {
  return Object.fromEntries(VISUAL_SLOT_IDS.map((slotId): [VisualSlotId, VisualSelection] => [
    slotId,
    { ...spec.visualSlots[slotId] },
  ])) as Record<VisualSlotId, VisualSelection>
}

export function toIncubatorRecord(spec: MonsterSpec): IncubatorCreatureRecord {
  return {
    theme: legacyThemeMap[spec.themeId],
    seed: spec.seed,
    traits: SEMANTIC_SLOT_IDS.map(slotId => spec.semanticTraits[slotId].primaryTraitId),
    mutation: spec.mutation?.id ?? null,
    aberrations: spec.aberrations.map(application => application.id),
    palette: [spec.palette.primary, spec.palette.secondary, spec.palette.accent],
    visualExtension: {
      schemaVersion: spec.schemaVersion,
      catalogVersion: spec.catalogVersion,
      visualSlots: copyVisualSlots(spec),
    },
  }
}
