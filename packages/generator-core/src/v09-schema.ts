import { z } from 'zod'
import type {
  ContentResourceRef,
  MonsterSpecV09,
  ReleaseManifestV09,
  SealedTraitArtifactV1,
  V09TraitSlotId,
} from './v09-contracts.js'
import { V09_TRAIT_SLOT_IDS } from './v09-contracts.js'
import type { Diagnostic, ParseResult } from './contracts.js'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest.')
const ContentResourceIdSchema = z.string().regex(
  /^sha256:[a-f0-9]{64}$/,
  'Expected a sha256 content resource ID, not a path or URL.',
)
const NonBlankStringSchema = z.string().min(1).refine(value => value.trim().length > 0, {
  message: 'Expected a non-blank string.',
})
const RollSchema = z.number().int().finite().min(0)
const RaritySchema = z.enum(['common', 'rare', 'legendary'])

const PngResourceRefSchema = z.strictObject({
  resourceId: ContentResourceIdSchema,
  sha256: Sha256Schema,
  mediaType: z.literal('image/png'),
  width: z.literal(2048),
  height: z.literal(2048),
})

const JsonResourceRefSchema = z.strictObject({
  resourceId: ContentResourceIdSchema,
  sha256: Sha256Schema,
  mediaType: z.enum(['application/qmonster-material-v1+json', 'application/qmonster-manifest-v1+json']),
})

const ContentResourceRefSchema = z.discriminatedUnion('mediaType', [PngResourceRefSchema, JsonResourceRefSchema])

const V09TraitSelectionSchema = z.strictObject({
  traitId: NonBlankStringSchema,
  rarity: RaritySchema,
  roll: RollSchema,
})

const SkeletonSelectionSchema = z.strictObject({
  class: z.enum(['base', 'legendary']),
  candidateId: NonBlankStringSchema,
  roll: RollSchema,
})

const VisualSlotsShape = Object.fromEntries(
  V09_TRAIT_SLOT_IDS.map(slotId => [slotId, V09TraitSelectionSchema]),
) as Record<V09TraitSlotId, typeof V09TraitSelectionSchema>

const MonsterSpecV09Schema = z.strictObject({
  schemaVersion: z.literal('0.4.0'),
  catalogVersion: z.literal('0.9.0'),
  generatorVersion: z.literal('0.9.0'),
  seed: z.string().min(1).max(512),
  speciesRigId: z.literal('feline-sit-v2'),
  skeletonFamilyId: NonBlankStringSchema,
  assemblyTemplateId: NonBlankStringSchema,
  skeletonSelection: SkeletonSelectionSchema,
  visualSlots: z.strictObject(VisualSlotsShape),
})

const SealedTraitBaseShape = {
  schemaVersion: z.literal('qmonster-sealed-trait-v1'),
  traitId: NonBlankStringSchema,
  rarity: RaritySchema,
  skeletonFamilyId: NonBlankStringSchema,
  assemblyTemplateId: NonBlankStringSchema,
  assemblyTemplateSha256: Sha256Schema,
  neutralMasterSha256: Sha256Schema,
  authoringInputs: z.array(ContentResourceRefSchema).min(1),
  fullContextPreview: PngResourceRefSchema,
  sealerVersion: NonBlankStringSchema,
}

const SealedTraitArtifactV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...SealedTraitBaseShape,
    kind: z.literal('surface'),
    slotId: z.enum(['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface']),
    runtimeResources: z.strictObject({ materialOperation: JsonResourceRefSchema }),
  }),
  z.strictObject({
    ...SealedTraitBaseShape,
    kind: z.literal('eyePair'),
    slotId: z.literal('eyes'),
    runtimeResources: z.strictObject({ underlay: PngResourceRefSchema, content: PngResourceRefSchema }),
  }),
  z.strictObject({
    ...SealedTraitBaseShape,
    kind: z.literal('mouth'),
    slotId: z.literal('mouthShape'),
    oralSocketClass: NonBlankStringSchema,
    runtimeResources: z.strictObject({ mouthBack: PngResourceRefSchema, mouthFront: PngResourceRefSchema }),
  }),
  z.strictObject({
    ...SealedTraitBaseShape,
    kind: z.literal('oralDetail'),
    slotId: z.literal('oralDetail'),
    runtimeResources: z.strictObject({ oralProjection: PngResourceRefSchema }),
  }),
  z.strictObject({
    ...SealedTraitBaseShape,
    kind: z.literal('attachment'),
    slotId: z.enum(['headAppendage', 'extraAppendage']),
    interfaceId: NonBlankStringSchema,
    shapeClass: z.enum(['ear-horn-small', 'ear-ornament', 'mane-small', 'collar']),
    runtimeResources: z.strictObject({ attachmentBehind: PngResourceRefSchema, attachmentFront: PngResourceRefSchema.optional() }),
  }),
  z.strictObject({
    ...SealedTraitBaseShape,
    kind: z.literal('targetedEffect'),
    slotId: z.literal('effect'),
    targetId: NonBlankStringSchema,
    runtimeResources: z.strictObject({ effectLayer: PngResourceRefSchema }),
  }),
  z.strictObject({
    ...SealedTraitBaseShape,
    kind: z.literal('ambientEffect'),
    slotId: z.literal('effect'),
    zoneId: z.enum(['background', 'foreground']),
    runtimeResources: z.strictObject({ effectLayer: PngResourceRefSchema }),
  }),
])

const ReleaseManifestV09Schema = z.strictObject({
  schemaVersion: z.literal('qmonster-release-v1'),
  versionTuple: z.strictObject({
    schemaVersion: z.literal('0.4.0'),
    catalogVersion: z.literal('0.9.0'),
    generatorVersion: z.literal('0.9.0'),
  }),
  speciesRig: JsonResourceRefSchema,
  skeletonPool: JsonResourceRefSchema,
  skeletonFamilies: z.array(JsonResourceRefSchema).min(1),
  assemblyTemplates: z.array(JsonResourceRefSchema).min(1),
  approvals: z.array(JsonResourceRefSchema),
  traitApprovals: z.array(JsonResourceRefSchema),
  traitInventory: JsonResourceRefSchema,
  sealedTraits: z.array(JsonResourceRefSchema),
  compositionGraph: JsonResourceRefSchema,
  rendererBuildSha256: Sha256Schema,
})

function toDiagnostic(issue: z.core.$ZodIssue, defaultCode: string): Diagnostic {
  const path = issue.path.map(String)
  const code = ['schemaVersion', 'catalogVersion', 'generatorVersion'].includes(path[0] ?? '')
    || (path[0] === 'versionTuple' && ['schemaVersion', 'catalogVersion', 'generatorVersion'].includes(path[1] ?? ''))
    ? 'VERSION_TUPLE_MISMATCH'
    : defaultCode
  return { severity: 'error', code, path, message: issue.message }
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, defaultCode: string): ParseResult<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, diagnostics: parsed.error.issues.map(issue => toDiagnostic(issue, defaultCode)) }
  return { ok: true, value: parsed.data }
}

export function parseMonsterSpecV09(input: unknown): ParseResult<MonsterSpecV09> {
  return parseWithSchema(MonsterSpecV09Schema, input, 'SPEC_SCHEMA_INVALID') as ParseResult<MonsterSpecV09>
}

export function parseSealedTraitArtifactV1(input: unknown): ParseResult<SealedTraitArtifactV1> {
  return parseWithSchema(SealedTraitArtifactV1Schema, input, 'TRAIT_SCHEMA_INVALID') as ParseResult<SealedTraitArtifactV1>
}

export function parseReleaseManifestV09(input: unknown): ParseResult<ReleaseManifestV09> {
  return parseWithSchema(ReleaseManifestV09Schema, input, 'RELEASE_MANIFEST_SCHEMA_INVALID') as ParseResult<ReleaseManifestV09>
}

export type { ContentResourceRef }
