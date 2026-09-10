import {
  V09_TRAIT_SLOT_IDS,
  V09_VERSION_TUPLE,
  parseMonsterSpecV09,
  parseReleaseManifestV09,
  parseSealedTraitArtifactV1,
  type Diagnostic,
  type MonsterSpecV09,
  type ResolvedV09Catalog,
  type SealedMouthTraitArtifactV1,
  type SealedTraitArtifactV1,
  type ThemeId,
  type V09TraitSlotId,
} from '@qmonster/generator-core'
import type {
  AdapterResult,
  IncubatorCreatureRecordV09,
  IncubatorGenerationRequestV09,
} from './contracts.js'
import { parseIncubatorEggInput } from './schema.js'

const SHA256 = /^[a-f0-9]{64}$/
const V09_TUPLE_KEYS = ['catalogVersion', 'generatorVersion', 'schemaVersion'] as const

const themeMap: Record<'deep_sea' | 'fungal' | 'shadow', ThemeId> = {
  deep_sea: 'deep-sea',
  fungal: 'fungal',
  shadow: 'shadow',
}

function diagnostic(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function invalidSpecDiagnostic(value: Diagnostic): Diagnostic {
  return value.code === 'VERSION_TUPLE_MISMATCH'
    ? value
    : { ...value, code: 'ADAPTER_SPEC_INVALID' }
}

function hasExactV09Tuple(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const tuple = value as Record<string, unknown>
  return Object.keys(tuple).sort().join(',') === V09_TUPLE_KEYS.join(',')
    && tuple.schemaVersion === V09_VERSION_TUPLE.schemaVersion
    && tuple.catalogVersion === V09_VERSION_TUPLE.catalogVersion
    && tuple.generatorVersion === V09_VERSION_TUPLE.generatorVersion
}

function sameResourceIdentity(
  left: ResolvedV09Catalog['speciesRig'],
  right: ResolvedV09Catalog['speciesRig'],
): boolean {
  return left.resourceId === right.resourceId
    && left.sha256 === right.sha256
    && left.mediaType === right.mediaType
}

function selectedTrait(
  spec: MonsterSpecV09,
  catalog: ResolvedV09Catalog,
  slotId: V09TraitSlotId,
): SealedTraitArtifactV1 | undefined {
  const selection = spec.visualSlots[slotId]
  const matches = catalog.sealedTraits.filter(trait => (
    trait.slotId === slotId
    && trait.traitId === selection.traitId
    && trait.rarity === selection.rarity
    && trait.skeletonFamilyId === spec.skeletonFamilyId
    && trait.assemblyTemplateId === spec.assemblyTemplateId
  ))
  return matches.length === 1 ? matches[0] : undefined
}

function validateCatalogSelection(
  spec: MonsterSpecV09,
  catalog: ResolvedV09Catalog,
): Diagnostic[] {
  if (!hasExactV09Tuple(catalog.releaseManifest?.versionTuple)) {
    return [diagnostic(
      'VERSION_TUPLE_MISMATCH',
      ['releaseManifest', 'versionTuple'],
      'The resolved release must use the exact 0.4.0/0.9.0/0.9.0 schema/catalog/generator tuple.',
    )]
  }

  const parsedManifest = parseReleaseManifestV09(catalog.releaseManifest)
  if (!parsedManifest.ok) {
    return parsedManifest.diagnostics.map(value => ({
      ...value,
      path: ['releaseManifest', ...value.path],
    }))
  }

  const diagnostics: Diagnostic[] = []
  if (!SHA256.test(catalog.releaseManifestSha256)) {
    diagnostics.push(diagnostic(
      'RELEASE_MANIFEST_HASH_MISMATCH',
      ['releaseManifestSha256'],
      'The resolved release manifest identity must be a lowercase SHA-256 digest.',
    ))
  }
  if (!sameResourceIdentity(catalog.speciesRig, parsedManifest.value.speciesRig)) {
    diagnostics.push(diagnostic(
      'RESOURCE_HASH_MISMATCH',
      ['speciesRigId'],
      'The resolved species rig resource does not match the release manifest.',
    ))
  }

  const candidates = catalog.skeletonPool.candidates.filter(candidate => (
    candidate.skeletonFamilyId === spec.skeletonSelection.candidateId
    && candidate.skeletonFamilyId === spec.skeletonFamilyId
    && candidate.skeletonClass === spec.skeletonSelection.class
  ))
  if (candidates.length !== 1) {
    diagnostics.push(diagnostic(
      'SKELETON_PROJECTION_MISSING',
      ['skeletonSelection'],
      `Skeleton selection ${spec.skeletonSelection.candidateId} is not the selected release family/class.`,
    ))
  }

  const families = catalog.skeletonFamilies.filter(family => (
    family.skeletonFamilyId === spec.skeletonFamilyId
    && family.skeletonClass === spec.skeletonSelection.class
    && family.speciesRigId === spec.speciesRigId
    && family.assemblyTemplateId === spec.assemblyTemplateId
  ))
  if (families.length !== 1) {
    diagnostics.push(diagnostic(
      'SKELETON_PROJECTION_MISSING',
      ['skeletonFamilyId'],
      `Skeleton ${spec.skeletonFamilyId} is not sealed for ${spec.speciesRigId}/${spec.assemblyTemplateId}.`,
    ))
  }

  const templates = catalog.assemblyTemplates.filter(template => (
    template.assemblyTemplateId === spec.assemblyTemplateId
    && template.skeletonFamilyId === spec.skeletonFamilyId
  ))
  if (templates.length !== 1) {
    diagnostics.push(diagnostic(
      'ASSEMBLY_TEMPLATE_UNAPPROVED',
      ['assemblyTemplateId'],
      `Assembly template ${spec.assemblyTemplateId} is not resolved for skeleton ${spec.skeletonFamilyId}.`,
    ))
  }

  const traits = new Map<V09TraitSlotId, SealedTraitArtifactV1>()
  for (const slotId of V09_TRAIT_SLOT_IDS) {
    const selection = spec.visualSlots[slotId]
    if (slotId === 'oralDetail' && selection.traitId === 'oral-none') continue
    const trait = selectedTrait(spec, catalog, slotId)
    if (trait === undefined) {
      diagnostics.push(diagnostic(
        'TRAIT_SLOT_INCOMPATIBLE',
        ['visualSlots', slotId],
        `Trait ${selection.traitId}/${selection.rarity} is not uniquely sealed for ${spec.skeletonFamilyId}/${spec.assemblyTemplateId}.`,
      ))
      continue
    }
    const parsedTrait = parseSealedTraitArtifactV1(trait)
    if (!parsedTrait.ok) {
      diagnostics.push(...parsedTrait.diagnostics.map(value => ({
        ...value,
        path: ['visualSlots', slotId, ...value.path],
      })))
      continue
    }
    traits.set(slotId, parsedTrait.value)
  }

  const mouth = traits.get('mouthShape') as SealedMouthTraitArtifactV1 | undefined
  const oral = spec.visualSlots.oralDetail
  if (oral.traitId === 'oral-none') {
    if (oral.rarity !== 'common' || mouth?.kind !== 'mouth' || mouth.oralSocketClass !== 'closed') {
      diagnostics.push(diagnostic(
        'ORAL_SOCKET_INCOMPATIBLE',
        ['visualSlots', 'oralDetail'],
        'oral-none is valid only as the common derived selection for a closed mouth.',
      ))
    }
  } else {
    const oralTrait = traits.get('oralDetail')
    if (mouth?.kind !== 'mouth' || oralTrait?.kind !== 'oralDetail'
      || !Object.hasOwn(oralTrait.runtimeResources.oralProjections, mouth.oralSocketClass)) {
      diagnostics.push(diagnostic(
        'ORAL_SOCKET_INCOMPATIBLE',
        ['visualSlots', 'oralDetail'],
        `Oral trait ${oral.traitId} has no projection for the selected mouth socket.`,
      ))
    }
  }

  return diagnostics
}

function copyVisualSlots(spec: MonsterSpecV09): MonsterSpecV09['visualSlots'] {
  return Object.fromEntries(V09_TRAIT_SLOT_IDS.map(slotId => [
    slotId,
    { ...spec.visualSlots[slotId] },
  ])) as MonsterSpecV09['visualSlots']
}

export function toV09GenerationRequest(
  input: unknown,
): AdapterResult<IncubatorGenerationRequestV09> {
  const parsed = parseIncubatorEggInput(input)
  if (!parsed.ok) return parsed
  if (parsed.value.archetype !== undefined && parsed.value.archetype !== 'feline') {
    return {
      ok: false,
      diagnostics: [diagnostic(
        'ADAPTER_ARCHETYPE_UNSUPPORTED',
        ['archetype'],
        `Archetype ${parsed.value.archetype} is not supported by the v0.9 incubator adapter.`,
      )],
    }
  }
  return {
    ok: true,
    value: {
      seed: parsed.value.seed,
      themeId: themeMap[parsed.value.theme],
      speciesRigId: 'feline-sit-v2',
    },
  }
}

export function toIncubatorRecordV09(
  input: unknown,
  catalog: ResolvedV09Catalog,
): AdapterResult<IncubatorCreatureRecordV09> {
  const parsed = parseMonsterSpecV09(input)
  if (!parsed.ok) {
    return { ok: false, diagnostics: parsed.diagnostics.map(invalidSpecDiagnostic) }
  }

  const spec = parsed.value
  const diagnostics = validateCatalogSelection(spec, catalog)
  if (diagnostics.some(value => value.severity === 'error')) {
    return { ok: false, diagnostics }
  }

  return {
    ok: true,
    value: {
      seed: spec.seed,
      visualExtension: {
        schemaVersion: spec.schemaVersion,
        catalogVersion: spec.catalogVersion,
        generatorVersion: spec.generatorVersion,
        releaseManifestSha256: catalog.releaseManifestSha256,
        speciesRigId: spec.speciesRigId,
        skeletonFamilyId: spec.skeletonFamilyId,
        assemblyTemplateId: spec.assemblyTemplateId,
        skeletonSelection: { ...spec.skeletonSelection },
        visualSlots: copyVisualSlots(spec),
      },
    },
  }
}
