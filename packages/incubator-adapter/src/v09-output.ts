import {
  V09_TRAIT_SLOT_IDS,
  V09_VERSION_TUPLE,
  parseMonsterSpecV09,
  parseReleaseManifestV09,
  parseSealedTraitArtifactV1,
  type AssemblyTemplateV1,
  type Diagnostic,
  type JsonResourceRef,
  type MonsterSpecV09,
  type ResolvedV09Catalog,
  type SealedMouthTraitArtifactV1,
  type SealedTraitArtifactV1,
  type SkeletonFamilyV1,
  type ThemeId,
  type V09TraitSlotId,
} from '@qmonster/generator-core'
import type {
  AdapterResult,
  IncubatorCreatureRecordV09,
  IncubatorGenerationRequestV09,
} from './contracts.js'
import { parseIncubatorEggInput } from './schema.js'

const V09_TUPLE_KEYS = ['catalogVersion', 'generatorVersion', 'schemaVersion'] as const
const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const
const SHA256_ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const

const themeMap: Record<'deep_sea' | 'fungal' | 'shadow', ThemeId> = {
  deep_sea: 'deep-sea',
  fungal: 'fungal',
  shadow: 'shadow',
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string': return JSON.stringify(value)
    case 'boolean': return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Canonical JSON does not allow non-finite numbers.')
      return JSON.stringify(value)
    case 'object': break
    default: throw new Error(`Canonical JSON does not allow ${typeof value} values.`)
  }
  if (ancestors.has(value)) throw new Error('Canonical JSON does not allow cycles.')
  ancestors.add(value)
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error('Canonical JSON does not allow symbol keys.')
    if (Array.isArray(value)) {
      const members: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new Error('Canonical JSON does not allow sparse arrays.')
        members.push(canonicalize(value[index], ancestors))
      }
      return `[${members.join(',')}]`
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Canonical JSON only allows ordinary objects.')
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key], ancestors)}`
    )).join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

/** Browser-portable synchronous SHA-256 for the adapter's canonical JSON boundary. */
function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value)
  const byteLength = Math.ceil((input.length + 9) / 64) * 64
  const padded = new Uint8Array(byteLength)
  padded.set(input)
  padded[input.length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = input.length * 8
  view.setUint32(byteLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(byteLength - 4, bitLength >>> 0, false)
  const hash: number[] = [...SHA256_INITIAL]
  const words = new Uint32Array(64)
  for (let offset = 0; offset < byteLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!
      const right = words[index - 2]!
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3)
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10)
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number]
    for (let index = 0; index < 64; index += 1) {
      const upperE = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const first = (h + upperE + choice + SHA256_ROUND[index]! + words[index]!) >>> 0
      const upperA = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const second = (upperA + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + first) >>> 0
      d = c
      c = b
      b = a
      a = (first + second) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < hash.length; index += 1) hash[index] = (hash[index]! + next[index]!) >>> 0
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('')
}

function canonicalJsonSha256(value: unknown): string {
  return sha256Hex(canonicalize(value, new WeakSet()))
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

interface VerifiedV09Snapshot {
  manifest: ResolvedV09Catalog['releaseManifest']
  skeletonPool: ResolvedV09Catalog['skeletonPool']
  skeletonFamilies: ResolvedV09Catalog['skeletonFamilies']
  skeletonFamilyHashes: string[]
  assemblyTemplates: ResolvedV09Catalog['assemblyTemplates']
  assemblyTemplateHashes: string[]
  sealedTraits: ResolvedV09Catalog['sealedTraits']
  sealedTraitHashes: string[]
  compositionGraph: ResolvedV09Catalog['compositionGraph']
}

function refHasIdentity(ref: JsonResourceRef, sha256: string): boolean {
  return ref.sha256 === sha256
    && ref.resourceId === `sha256:${sha256}`
    && ref.mediaType === 'application/qmonster-manifest-v1+json'
}

function bodyHash(
  body: unknown,
  path: string[],
  diagnostics: Diagnostic[],
): string | undefined {
  try {
    return canonicalJsonSha256(body)
  } catch {
    diagnostics.push(diagnostic(
      'RESOURCE_HASH_MISMATCH',
      path,
      'A resolved release body is not valid canonical JSON.',
    ))
    return undefined
  }
}

function verifyBodyRef(
  body: unknown,
  ref: JsonResourceRef,
  path: string[],
  diagnostics: Diagnostic[],
): string | undefined {
  const hash = bodyHash(body, path, diagnostics)
  if (hash !== undefined && !refHasIdentity(ref, hash)) {
    diagnostics.push(diagnostic(
      'RESOURCE_HASH_MISMATCH',
      path,
      `Resolved body ${hash} does not match manifest ref ${ref.sha256}.`,
    ))
  }
  return hash
}

function verifyBodySequence(
  bodies: readonly unknown[],
  refs: readonly JsonResourceRef[],
  path: string[],
  diagnostics: Diagnostic[],
): string[] {
  if (bodies.length !== refs.length) {
    diagnostics.push(diagnostic(
      'RESOURCE_HASH_MISMATCH',
      path,
      `Resolved body count ${bodies.length} does not match manifest ref count ${refs.length}.`,
    ))
  }
  const hashes: string[] = []
  const bodyIdentities = new Set<string>()
  const refIdentities = new Set<string>()
  for (let index = 0; index < Math.min(bodies.length, refs.length); index += 1) {
    const ref = refs[index]!
    const hash = verifyBodyRef(bodies[index], ref, [...path, String(index)], diagnostics)
    if (hash !== undefined) {
      hashes[index] = hash
      if (bodyIdentities.has(hash)) {
        diagnostics.push(diagnostic(
          'RESOURCE_HASH_MISMATCH',
          [...path, String(index)],
          `Resolved body identity ${hash} is duplicated.`,
        ))
      }
      bodyIdentities.add(hash)
    }
    if (refIdentities.has(ref.resourceId)) {
      diagnostics.push(diagnostic(
        'RESOURCE_HASH_MISMATCH',
        [...path, String(index)],
        `Manifest resource identity ${ref.resourceId} is duplicated.`,
      ))
    }
    refIdentities.add(ref.resourceId)
  }
  return hashes
}

function verifyOpaqueRef(ref: JsonResourceRef, path: string[], diagnostics: Diagnostic[]): void {
  if (!refHasIdentity(ref, ref.sha256)) {
    diagnostics.push(diagnostic(
      'RESOURCE_HASH_MISMATCH',
      path,
      `Manifest ref ${ref.resourceId} is not self-consistent with ${ref.sha256}.`,
    ))
  }
}

function verifyResolvedSnapshot(
  catalog: ResolvedV09Catalog,
): { diagnostics: Diagnostic[]; snapshot?: VerifiedV09Snapshot } {
  if (!hasExactV09Tuple(catalog.releaseManifest?.versionTuple)) {
    return { diagnostics: [diagnostic(
      'VERSION_TUPLE_MISMATCH',
      ['releaseManifest', 'versionTuple'],
      'The resolved release must use the exact 0.4.0/0.9.0/0.9.0 schema/catalog/generator tuple.',
    )] }
  }

  const parsedManifest = parseReleaseManifestV09(catalog.releaseManifest)
  if (!parsedManifest.ok) {
    return { diagnostics: parsedManifest.diagnostics.map(value => ({
      ...value,
      path: ['releaseManifest', ...value.path],
    })) }
  }

  if (catalog.speciesRig === null
    || typeof catalog.speciesRig !== 'object'
    || catalog.skeletonPool === null
    || typeof catalog.skeletonPool !== 'object'
    || !Array.isArray(catalog.skeletonFamilies)
    || !Array.isArray(catalog.assemblyTemplates)
    || !Array.isArray(catalog.sealedTraits)
    || catalog.compositionGraph === null
    || typeof catalog.compositionGraph !== 'object') {
    return { diagnostics: [diagnostic(
      'RESOURCE_HASH_MISMATCH',
      ['resolvedCatalog'],
      'The resolved release is missing one or more manifest-addressed bodies.',
    )] }
  }

  const diagnostics: Diagnostic[] = []
  const manifestHash = bodyHash(catalog.releaseManifest, ['releaseManifest'], diagnostics)
  if (manifestHash === undefined || manifestHash !== catalog.releaseManifestSha256) {
    diagnostics.push(diagnostic(
      'RELEASE_MANIFEST_HASH_MISMATCH',
      ['releaseManifestSha256'],
      `Resolved release manifest identity ${catalog.releaseManifestSha256} does not match its canonical body.`,
    ))
  }

  const manifest = parsedManifest.value
  verifyOpaqueRef(manifest.speciesRig, ['releaseManifest', 'speciesRig'], diagnostics)
  if (!sameResourceIdentity(catalog.speciesRig, manifest.speciesRig)) {
    diagnostics.push(diagnostic(
      'RESOURCE_HASH_MISMATCH',
      ['speciesRig'],
      'The resolved species rig ref does not exactly match the release manifest.',
    ))
  }
  verifyBodyRef(catalog.skeletonPool, manifest.skeletonPool, ['skeletonPool'], diagnostics)
  const skeletonFamilyHashes = verifyBodySequence(
    catalog.skeletonFamilies,
    manifest.skeletonFamilies,
    ['skeletonFamilies'],
    diagnostics,
  )
  const assemblyTemplateHashes = verifyBodySequence(
    catalog.assemblyTemplates,
    manifest.assemblyTemplates,
    ['assemblyTemplates'],
    diagnostics,
  )
  const sealedTraitHashes = verifyBodySequence(
    catalog.sealedTraits,
    manifest.sealedTraits,
    ['sealedTraits'],
    diagnostics,
  )
  verifyBodyRef(catalog.compositionGraph, manifest.compositionGraph, ['compositionGraph'], diagnostics)

  manifest.approvals.forEach((ref, index) => verifyOpaqueRef(ref, ['releaseManifest', 'approvals', String(index)], diagnostics))
  manifest.traitApprovals.forEach((ref, index) => verifyOpaqueRef(ref, ['releaseManifest', 'traitApprovals', String(index)], diagnostics))
  verifyOpaqueRef(manifest.traitInventory, ['releaseManifest', 'traitInventory'], diagnostics)

  if (diagnostics.some(value => value.severity === 'error')) return { diagnostics }
  return {
    diagnostics,
    snapshot: {
      manifest,
      skeletonPool: catalog.skeletonPool,
      skeletonFamilies: catalog.skeletonFamilies,
      skeletonFamilyHashes,
      assemblyTemplates: catalog.assemblyTemplates,
      assemblyTemplateHashes,
      sealedTraits: catalog.sealedTraits,
      sealedTraitHashes,
      compositionGraph: catalog.compositionGraph,
    },
  }
}

function selectedTrait(
  spec: MonsterSpecV09,
  snapshot: VerifiedV09Snapshot,
  slotId: V09TraitSlotId,
): SealedTraitArtifactV1 | undefined {
  const selection = spec.visualSlots[slotId]
  const matches = snapshot.sealedTraits.filter(trait => (
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
  const verified = verifyResolvedSnapshot(catalog)
  if (verified.snapshot === undefined) return verified.diagnostics
  const snapshot = verified.snapshot
  const diagnostics: Diagnostic[] = [...verified.diagnostics]

  const candidates = snapshot.skeletonPool.candidates.filter(candidate => (
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

  const familyIndexes = snapshot.skeletonFamilies
    .map((family, index) => ({ family, index }))
    .filter(({ family }) => (
    family.skeletonFamilyId === spec.skeletonFamilyId
    && family.skeletonClass === spec.skeletonSelection.class
    && family.speciesRigId === spec.speciesRigId
    && family.assemblyTemplateId === spec.assemblyTemplateId
  ))
  if (familyIndexes.length !== 1) {
    diagnostics.push(diagnostic(
      'SKELETON_PROJECTION_MISSING',
      ['skeletonFamilyId'],
      `Skeleton ${spec.skeletonFamilyId} is not sealed for ${spec.speciesRigId}/${spec.assemblyTemplateId}.`,
    ))
  }

  const templateIndexes = snapshot.assemblyTemplates
    .map((template, index) => ({ template, index }))
    .filter(({ template }) => (
    template.assemblyTemplateId === spec.assemblyTemplateId
    && template.skeletonFamilyId === spec.skeletonFamilyId
  ))
  if (templateIndexes.length !== 1) {
    diagnostics.push(diagnostic(
      'ASSEMBLY_TEMPLATE_UNAPPROVED',
      ['assemblyTemplateId'],
      `Assembly template ${spec.assemblyTemplateId} is not resolved for skeleton ${spec.skeletonFamilyId}.`,
    ))
  }

  const familyEntry = familyIndexes[0]
  const templateEntry = templateIndexes[0]
  if (familyEntry !== undefined && templateEntry !== undefined) {
    const family = familyEntry.family
    const template = templateEntry.template
    if (template.neutralMasterSha256 !== family.neutralMaster.sha256
      || snapshot.assemblyTemplateHashes[templateEntry.index] === undefined
      || snapshot.skeletonFamilyHashes[familyEntry.index] === undefined) {
      diagnostics.push(diagnostic(
        'ASSEMBLY_TEMPLATE_HASH_MISMATCH',
        ['assemblyTemplateId'],
        `Assembly template ${template.assemblyTemplateId} does not bind the selected family's neutral master.`,
      ))
    }
  }

  const traits = new Map<V09TraitSlotId, SealedTraitArtifactV1>()
  for (const slotId of V09_TRAIT_SLOT_IDS) {
    const selection = spec.visualSlots[slotId]
    if (slotId === 'oralDetail' && selection.traitId === 'oral-none') continue
    const trait = selectedTrait(spec, snapshot, slotId)
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
    if (templateEntry !== undefined && familyEntry !== undefined
      && (parsedTrait.value.assemblyTemplateSha256 !== snapshot.assemblyTemplateHashes[templateEntry.index]
        || parsedTrait.value.neutralMasterSha256 !== familyEntry.family.neutralMaster.sha256)) {
      diagnostics.push(diagnostic(
        'ASSEMBLY_TEMPLATE_HASH_MISMATCH',
        ['visualSlots', slotId],
        `Trait ${parsedTrait.value.traitId} does not bind the selected canonical template and neutral master.`,
      ))
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
