import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  deriveCollectionRarity,
  parseMonsterSpec,
  validateMonsterSpecAgainstCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type ThemeId,
  type VisualSlotId,
  type VisualSelection,
} from '@qmonster/generator-core'
import type { AdapterResult, IncubatorCreatureRecord } from './contracts.js'

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

function copyGenome(spec: MonsterSpec): MonsterSpec['genome'] {
  return spec.genome === undefined ? undefined : structuredClone(spec.genome)
}

function invalidSpecDiagnostic(diagnostic: Diagnostic): Diagnostic {
  return {
    ...diagnostic,
    code: 'ADAPTER_SPEC_INVALID',
  }
}

export function toIncubatorRecord(
  input: unknown,
  catalog: Catalog,
): AdapterResult<IncubatorCreatureRecord> {
  const parsed = parseMonsterSpec(input)
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map(invalidSpecDiagnostic),
    }
  }

  const spec = parsed.value
  const diagnostics = validateMonsterSpecAgainstCatalog(spec, catalog)
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return { ok: false, diagnostics }
  }

  const genome = copyGenome(spec)

  return {
    ok: true,
    value: {
      theme: legacyThemeMap[spec.themeId],
      seed: spec.seed,
      traits: SEMANTIC_SLOT_IDS.map(slotId => spec.semanticTraits[slotId].primaryTraitId),
      mutation: spec.mutation?.id ?? null,
      aberrations: spec.aberrations.map(application => application.id),
      palette: [spec.palette.primary, spec.palette.secondary, spec.palette.accent],
      visualExtension: {
        schemaVersion: spec.schemaVersion,
        catalogVersion: spec.catalogVersion,
        rendererVersion: spec.rendererVersion,
        ...(spec.archetypeId === undefined ? {} : { archetypeId: spec.archetypeId }),
        ...(spec.anatomyBundleId === undefined ? {} : { anatomyBundleId: spec.anatomyBundleId }),
        ...(spec.speciesRigId === undefined ? {} : { speciesRigId: spec.speciesRigId }),
        collectionRarity: deriveCollectionRarity(spec, catalog),
        visualSlots: copyVisualSlots(spec),
        ...(genome === undefined ? {} : { genome }),
      },
    },
  }
}
