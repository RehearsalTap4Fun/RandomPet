import {
  V08_FELINE_LAYER_ORDER,
  V08_REGION_IDS,
  V08_SLOT_OWNER_POLICY,
  VISUAL_SLOT_IDS,
  parseCatalog,
  validateCatalogStructure,
  type Catalog,
  type Rarity,
  type ResourceRef,
  type V08BlendMode,
  type V08ExpressionKind,
  type V08RegionId,
  type VisualSlotId,
} from '@qmonster/generator-core'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { validateV08ProductionRelease, type V08EvidenceManifest, type V08SourceIndex } from '../packages/asset-catalog/src/v08-production-validation.js'
import v06CatalogDocument from '../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import { validateV08RasterContract } from '../packages/asset-catalog/src/v08-raster-contract.js'
import { prepareV08FelineMaster } from './prepare-v08-feline-assets.js'

const SPECIES_RIG_ID = 'feline-sit-v1'
const RIG_VERSION = '1.0.0'

const CONCEPTS = {
  bodyFrame: {
    N: ['round-belly', 'soft-chest', 'compact-cub', 'pear-shade', 'oval-bib', 'broad-chest', 'tiny-belly', 'long-bib'],
    R: ['cloud-chest', 'velvet-mane', 'lantern-belly', 'heart-haunch'],
    L: ['aurora-ruff'],
  },
  headShape: {
    N: ['round-cheek', 'oval-cheek', 'soft-brow', 'tiny-tuft', 'neat-crown', 'wide-muzzle', 'narrow-bib', 'plush-jowl'],
    R: ['lynx-tuft', 'crescent-cheek', 'velvet-brow', 'folded-ear-fluff'],
    L: ['moon-crown'],
  },
  arms: {
    N: ['plain-mitten', 'cream-cuff', 'tabby-cuff', 'dark-paw', 'pale-paw', 'soft-claw', 'fluffy-wrist', 'tiny-pad'],
    R: ['crystal-cap', 'cloud-cuff', 'heart-pad', 'luminous-claw'],
    L: ['starlight-forepaws'],
  },
  legs: {
    N: ['plain-sock', 'cream-sock', 'tabby-ankle', 'dark-pad', 'pale-pad', 'soft-toe', 'fluffy-ankle', 'round-pad'],
    R: ['plume-ankle', 'crystal-toe', 'hopper-pad', 'pebble-glow'],
    L: ['comet-hindpaws'],
  },
  tail: {
    N: ['solid-tip', 'cream-tip', 'dark-tip', 'two-rings', 'three-rings', 'soft-stripe', 'pale-gradient', 'dark-gradient'],
    R: ['ribbon-bands', 'pompom-mark', 'comet-stripe', 'fern-tip'],
    L: ['aurora-tail'],
  },
  extraAppendage: {
    N: ['tiny-bell', 'back-button', 'soft-ribbon', 'mini-leaf', 'small-bow', 'collar-bead', 'back-star', 'plush-charm'],
    R: ['whisker-fan', 'crystal-ribbon', 'cheek-plume', 'moon-bell'],
    L: ['halo-arc'],
  },
  eyes: {
    N: ['round-black', 'amber', 'blue', 'green', 'violet', 'sleepy', 'curious', 'gentle'],
    R: ['star-pupil', 'mismatched-gem', 'crescent', 'honey-glow'],
    L: ['nebula-iris'],
  },
  mouthShape: {
    N: ['tiny-smile', 'soft-pout', 'open-happy', 'calm-line', 'bean-smile', 'shy-smile', 'curious-o', 'kitten-grin'],
    R: ['fang-smile', 'heart-muzzle', 'ribbon-grin', 'moon-pout'],
    L: ['prism-smile'],
  },
  oralDetail: {
    N: ['tiny-tooth', 'pink-tongue', 'dark-tongue', 'cream-fang', 'soft-gum', 'double-tooth', 'tongue-tip', 'tiny-lip'],
    R: ['gold-fang', 'berry-tongue', 'pearl-tooth', 'glow-whisker-root'],
    L: ['galaxy-tongue'],
  },
  headAppendage: {
    N: ['inner-ear', 'ear-button', 'tiny-clip', 'soft-bow', 'leaf-clip', 'star-pin', 'felt-flower', 'ribbon-knot'],
    R: ['sprout-ear', 'crystal-rim', 'moth-bow', 'moon-clip'],
    L: ['floating-moon-charm'],
  },
  surfaceMaterial: {
    N: ['short-plush', 'long-plush', 'velvet', 'fleece', 'satin-soft', 'wool-soft', 'suede-soft', 'cloud-soft'],
    R: ['crystal-fleece', 'moss-velvet', 'pearl-satin', 'luminous-plush'],
    L: ['opal-coat'],
  },
  pattern: {
    N: ['plain', 'soft-tabby', 'two-tone', 'socks', 'points', 'tiny-spots', 'forehead-mark', 'back-stripe'],
    R: ['constellation', 'heart-dapple', 'leaf-stripe', 'moon-swirl'],
    L: ['aurora-constellation'],
  },
  colorScheme: {
    N: ['cream', 'ginger', 'silver', 'charcoal', 'cocoa', 'white', 'lavender', 'mint'],
    R: ['apricot-cream', 'ink-silver', 'mint-peach', 'lavender-cocoa'],
    L: ['moonstone-spectrum'],
  },
  effect: {
    N: ['none', 'tiny-dust', 'soft-bokeh', 'paw-glow', 'breath-mist', 'floor-spark', 'tail-spark', 'ear-glint'],
    R: ['firefly-drift', 'tiny-hearts', 'moon-motes', 'star-trail'],
    L: ['orbiting-stardust'],
  },
} as const satisfies Record<VisualSlotId, Record<Rarity, readonly string[]>>

export interface V08TraitSourceRecord {
  id: string
  slotId: VisualSlotId
  rarity: Rarity
  displayName: string
  sourcePath: string
  ownerRegionId: V08RegionId
  expressionKind: V08ExpressionKind
  blendMode: V08BlendMode
  opacity: number
  speciesRigId: typeof SPECIES_RIG_ID
  rigVersion: typeof RIG_VERSION
  sourceMasterSha256: string
  prompt: string
  provenance: { method: 'deterministic-canonical-mask'; concept: string }
}

export interface V08TraitInventory {
  schemaVersion: 'qmonster-v08-trait-inventory-v1'
  catalogVersion: '0.8.0'
  speciesRigId: typeof SPECIES_RIG_ID
  rigVersion: typeof RIG_VERSION
  sourceMasterSha256: string
  traits: V08TraitSourceRecord[]
}

export interface V08RuntimeResources {
  sourceMasterSha256: string
  structure: ResourceRef
  regions: Record<V08RegionId, ResourceRef>
  traits: Record<string, ResourceRef>
}

function displayName(slug: string): string {
  return slug.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ')
}

function opacityFor(slotId: VisualSlotId): number {
  if (slotId === 'surfaceMaterial') return 0.48
  if (slotId === 'pattern') return 0.72
  if (slotId === 'colorScheme') return 0.78
  if (slotId === 'effect') return 0.88
  return 1
}

export function buildCompleteV08Inventory(sourceMasterSha256: string): V08TraitInventory {
  const traits: V08TraitSourceRecord[] = []
  for (const slotId of VISUAL_SLOT_IDS) {
    const policy = V08_SLOT_OWNER_POLICY[slotId]
    for (const rarity of ['N', 'R', 'L'] as const) {
      for (const concept of CONCEPTS[slotId][rarity]) {
        const id = `${slotId}_${rarity.toLowerCase()}_${concept}`
        traits.push({
          id,
          slotId,
          rarity,
          displayName: displayName(concept),
          sourcePath: `traits/${slotId}/${id}.png`,
          ownerRegionId: policy.ownerRegionId,
          expressionKind: policy.expressionKind,
          blendMode: policy.blendModes[0],
          opacity: opacityFor(slotId),
          speciesRigId: SPECIES_RIG_ID,
          rigVersion: RIG_VERSION,
          sourceMasterSha256,
          prompt: `${displayName(concept)} variation constrained to ${policy.ownerRegionId}.`,
          provenance: { method: 'deterministic-canonical-mask', concept },
        })
      }
    }
  }
  return {
    schemaVersion: 'qmonster-v08-trait-inventory-v1',
    catalogVersion: '0.8.0',
    speciesRigId: SPECIES_RIG_ID,
    rigVersion: RIG_VERSION,
    sourceMasterSha256,
    traits,
  }
}

export function validateV08SourceInventory(inventory: V08TraitInventory): string[] {
  const diagnostics: string[] = []
  if (
    inventory.schemaVersion !== 'qmonster-v08-trait-inventory-v1'
    || inventory.catalogVersion !== '0.8.0'
    || inventory.speciesRigId !== SPECIES_RIG_ID
    || inventory.rigVersion !== RIG_VERSION
    || !/^[a-f0-9]{64}$/iu.test(inventory.sourceMasterSha256)
  ) diagnostics.push('V08_SOURCE_INVENTORY_HEADER_INVALID')
  const ids = new Set<string>()
  for (const trait of inventory.traits) {
    if (ids.has(trait.id)) diagnostics.push(`V08_SOURCE_INVENTORY_DUPLICATE:${trait.id}`)
    ids.add(trait.id)
    const policy = V08_SLOT_OWNER_POLICY[trait.slotId]
    if (
      trait.speciesRigId !== SPECIES_RIG_ID
      || trait.rigVersion !== RIG_VERSION
      || trait.sourceMasterSha256 !== inventory.sourceMasterSha256
      || trait.ownerRegionId !== policy.ownerRegionId
      || trait.expressionKind !== policy.expressionKind
      || !policy.blendModes.includes(trait.blendMode)
      || trait.sourcePath !== `traits/${trait.slotId}/${trait.id}.png`
    ) diagnostics.push(`V08_SOURCE_TRAIT_CONTRACT_INVALID:${trait.id}`)
  }
  for (const slotId of VISUAL_SLOT_IDS) {
    for (const [rarity, count] of Object.entries({ N: 8, R: 4, L: 1 }) as [Rarity, number][]) {
      if (inventory.traits.filter(trait => trait.slotId === slotId && trait.rarity === rarity).length !== count) {
        diagnostics.push(`V08_SOURCE_INVENTORY_INVALID:${slotId}:${rarity}`)
      }
    }
  }
  if (inventory.traits.length !== 182) diagnostics.push(`V08_SOURCE_INVENTORY_COUNT_INVALID:${inventory.traits.length}`)
  return diagnostics
}

const layerBySlot: Record<VisualSlotId, Catalog['parts'][number]['layer']> = {
  bodyFrame: 'body',
  headShape: 'head',
  eyes: 'faceAndHeadwear',
  mouthShape: 'faceAndHeadwear',
  oralDetail: 'faceAndHeadwear',
  headAppendage: 'faceAndHeadwear',
  arms: 'frontAppendage',
  legs: 'frontAppendage',
  tail: 'rearAppendage',
  extraAppendage: 'frontAppendage',
  surfaceMaterial: 'surface',
  pattern: 'pattern',
  colorScheme: 'surface',
  effect: 'foregroundEffect',
}

export function buildV08CatalogDocument(
  inventory: V08TraitInventory,
  runtime: V08RuntimeResources,
): Catalog {
  const inventoryDiagnostics = validateV08SourceInventory(inventory)
  if (inventoryDiagnostics.length > 0) throw new Error(inventoryDiagnostics.join('\n'))
  if (runtime.sourceMasterSha256 !== inventory.sourceMasterSha256) {
    throw new Error('V08_RUNTIME_MASTER_MISMATCH')
  }
  const base = structuredClone(v06CatalogDocument) as Catalog
  const partPools = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
    slotId,
    inventory.traits.filter(trait => trait.slotId === slotId).map(trait => trait.id),
  ])) as Record<VisualSlotId, string[]>
  const parts: Catalog['parts'] = inventory.traits.map(trait => {
    const resource = runtime.traits[trait.id]
    if (resource === undefined) throw new Error(`V08_RUNTIME_TRAIT_MISSING:${trait.id}`)
    return {
      id: trait.id,
      slotId: trait.slotId,
      rarity: trait.rarity,
      baseWeight: 1,
      themeIds: ['deep-sea', 'fungal', 'shadow'],
      themeWeights: {},
      compatibleRigs: ['feline-sit'],
      assetPath: resource.assetPath,
      assetSha256: resource.assetSha256,
      pngPath: resource.pngPath,
      pngSha256: resource.pngSha256,
      approvedTransforms: [{ scale: 1, mirrorX: false }],
      maskPaths: {},
      origin: { x: 0, y: 0 },
      socket: null,
      layer: layerBySlot[trait.slotId],
      semanticTraitId: null,
      semanticPriority: 0,
      excludes: [],
      boosts: {},
      displayName: trait.displayName,
      flavorText: `固定猫科骨架上的${trait.displayName}特征。`,
      description: `由 ${trait.ownerRegionId} 区域约束的完整画布表达层。`,
      archetypeIds: ['feline'],
      featureTier: trait.rarity === 'L' ? 'special' : 'base',
      composition: {
        mode: 'species-rig',
        isNone: trait.slotId === 'effect' && trait.provenance.concept === 'none',
        motifTags: [],
        visualIntensity: trait.rarity === 'N' ? 'quiet' : 'strong',
        speciesRigId: SPECIES_RIG_ID,
        rigVersion: RIG_VERSION,
        sourceMasterSha256: inventory.sourceMasterSha256,
        expressionKind: trait.expressionKind,
        ownerRegionId: trait.ownerRegionId,
        blendMode: trait.blendMode,
        opacity: trait.opacity,
      },
    }
  })
  return {
    version: '0.8.0',
    themes: base.themes,
    rigs: [{
      id: 'feline-sit',
      sockets: {},
      sourceId: 'feline-sit-v1',
      displayName: '标准坐姿猫科骨架',
    }],
    archetypes: [{
      id: 'feline',
      displayName: '猫',
      rigIds: ['feline-sit'],
      defaultRigId: 'feline-sit',
      requiredVisibleSlots: [...VISUAL_SLOT_IDS],
      integratedSlots: [],
      specialFeatureSlots: ['extraAppendage'],
    }],
    parts,
    semanticTraits: base.semanticTraits.map(trait => ({
      ...trait,
      visualMapping: {},
    })),
    modifiers: [],
    dependencies: {},
    anatomyBundles: [{
      id: 'feline-sit-canonical-v1',
      archetypeId: 'feline',
      rigId: 'feline-sit',
      poseId: 'sit',
      rarity: 'N',
      baseWeight: 1,
      structural: runtime.structure,
      alpha: runtime.regions.bodySurface,
      clip: runtime.regions.bodySurface,
      faceSafeZone: { x: 480, y: 275, width: 1088, height: 850 },
      featureSockets: {},
      mutationAnchors: {},
      speciesRigId: SPECIES_RIG_ID,
      sourceMasterSha256: inventory.sourceMasterSha256,
      partPools,
    }],
    speciesRigs: [{
      schemaVersion: 'qmonster-species-rig-v1',
      id: SPECIES_RIG_ID,
      rigVersion: RIG_VERSION,
      archetypeId: 'feline',
      rigId: 'feline-sit',
      poseId: 'sit',
      canvas: { width: 2048, height: 2048 },
      coordinatePolicy: 'fixed-canvas-no-trim',
      sourceMasterSha256: inventory.sourceMasterSha256,
      regions: runtime.regions,
      layerOrder: [...V08_FELINE_LAYER_ORDER],
      allowedSlotExpressions: Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
        slotId, V08_SLOT_OWNER_POLICY[slotId].expressionKind,
      ])) as Record<VisualSlotId, V08ExpressionKind>,
    }],
  }
}

export interface AssembleV08CatalogInput {
  repositoryRoot: string
  sourceRoot: string
  stagedRoot: string
  resumeStagedRoot?: boolean
  onProgress?: (completed: number, total: number) => void
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isBelow(root: string, target: string): boolean {
  const remainder = relative(resolve(root), resolve(target))
  return remainder !== '' && !remainder.startsWith('..') && !isAbsolute(remainder)
}

async function writeJson(path: string, value: unknown): Promise<Buffer> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  await mkdir(dirname(path), { recursive: true })
  if (await exists(path)) {
    if (!(await readFile(path)).equals(bytes)) throw new Error(`V08_IMMUTABLE_OUTPUT_MISMATCH:${path}`)
  } else await writeFile(path, bytes, { flag: 'wx' })
  return bytes
}

async function packageTrait(sourcePath: string, outputStem: string): Promise<ResourceRef> {
  const pngPath = `${outputStem}.png`
  const webpPath = `${outputStem}.webp`
  await mkdir(dirname(pngPath), { recursive: true })
  const source = await readFile(sourcePath)
  if (await exists(pngPath) && await exists(webpPath)) {
    const [png, webp] = await Promise.all([readFile(pngPath), readFile(webpPath)])
    if (!png.equals(source)) throw new Error(`V08_IMMUTABLE_OUTPUT_MISMATCH:${pngPath}`)
    return {
      assetPath: webpPath,
      assetSha256: sha256(webp),
      pngPath,
      pngSha256: sha256(png),
    }
  }
  const webp = await sharp(source).webp({ lossless: true, effort: 1 }).toBuffer()
  for (const [path, bytes] of [[pngPath, source], [webpPath, webp]] as const) {
    if (await exists(path)) {
      if (!(await readFile(path)).equals(bytes)) throw new Error(`V08_IMMUTABLE_OUTPUT_MISMATCH:${path}`)
    } else await writeFile(path, bytes, { flag: 'wx' })
  }
  return {
    assetPath: webpPath,
    assetSha256: sha256(webp),
    pngPath,
    pngSha256: sha256(source),
  }
}

function portableResource(resource: ResourceRef, stagedAssetRoot: string): ResourceRef {
  const relativeAsset = relative(stagedAssetRoot, resource.assetPath).replaceAll('\\', '/')
  const relativePng = relative(stagedAssetRoot, resource.pngPath).replaceAll('\\', '/')
  return {
    ...resource,
    assetPath: `assets/v0.8.0/${relativeAsset}`,
    pngPath: `assets/v0.8.0/${relativePng}`,
  }
}

function allRuntimeResources(catalog: Catalog): Array<{ path: string; sha256: string }> {
  const rig = catalog.speciesRigs![0]!
  const bundle = catalog.anatomyBundles![0]!
  const byPath = new Map<string, string>()
  const add = (resource: ResourceRef): void => {
    byPath.set(resource.assetPath, resource.assetSha256)
    byPath.set(resource.pngPath, resource.pngSha256)
  }
  add(bundle.structural)
  for (const regionId of V08_REGION_IDS) add(rig.regions[regionId])
  for (const part of catalog.parts) add({
    assetPath: part.assetPath,
    assetSha256: part.assetSha256!,
    pngPath: part.pngPath!,
    pngSha256: part.pngSha256!,
  })
  return [...byPath].map(([path, hash]) => ({ path, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path))
}

async function promoteNewPath(staged: string, target: string): Promise<void> {
  if (await exists(target)) throw new Error(`V08_RELEASE_TARGET_EXISTS:${target}`)
  await mkdir(dirname(target), { recursive: true })
  await rename(staged, target)
}

export async function assembleV08Catalog(input: AssembleV08CatalogInput): Promise<Catalog> {
  const repositoryRoot = resolve(input.repositoryRoot)
  const sourceRoot = resolve(input.sourceRoot)
  const stagedRoot = resolve(input.stagedRoot)
  if (
    !isBelow(repositoryRoot, stagedRoot)
    || (await exists(stagedRoot) && input.resumeStagedRoot !== true)
  ) {
    throw new Error(`V08_STAGED_ROOT_INVALID:${stagedRoot}`)
  }
  const targets = {
    assets: join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.8.0'),
    catalog: join(repositoryRoot, 'packages', 'asset-catalog', 'catalog', 'v0.8.0'),
    sourceIndex: join(repositoryRoot, 'packages', 'asset-catalog', 'source-index-v0.8.0.json'),
    evidence: join(repositoryRoot, 'packages', 'asset-catalog', 'audit', 'v0.8.0', 'evidence-manifest.json'),
  }
  for (const target of Object.values(targets)) {
    if (await exists(target)) throw new Error(`V08_RELEASE_TARGET_EXISTS:${target}`)
  }

  const inventoryPath = join(sourceRoot, 'trait-inventory.json')
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as V08TraitInventory
  const inventoryDiagnostics = validateV08SourceInventory(inventory)
  if (inventoryDiagnostics.length > 0) throw new Error(inventoryDiagnostics.join('\n'))
  const masterPath = join(sourceRoot, 'master', 'feline-sit-v1.png')
  if (sha256(await readFile(masterPath)) !== inventory.sourceMasterSha256) {
    throw new Error('V08_SOURCE_MASTER_HASH_MISMATCH')
  }

  const stagedAssetRoot = join(stagedRoot, 'packages', 'asset-catalog', 'assets', 'v0.8.0')
  const stagedCatalogRoot = join(stagedRoot, 'packages', 'asset-catalog', 'catalog', 'v0.8.0')
  const prepared = await prepareV08FelineMaster({ sourceRoot, outputDirectory: stagedAssetRoot })
  if (prepared.sourceMasterSha256 !== inventory.sourceMasterSha256) {
    throw new Error('V08_PREPARED_MASTER_HASH_MISMATCH')
  }
  const structure = portableResource(prepared.structure, stagedAssetRoot)
  const regions = {} as Record<V08RegionId, ResourceRef>
  for (const regionId of V08_REGION_IDS) regions[regionId] = portableResource(prepared.regions[regionId], stagedAssetRoot)

  const traits = {} as Record<string, ResourceRef>
  const sourceIndexTraits: V08SourceIndex['traits'] = []
  const concurrency = 4
  for (let start = 0; start < inventory.traits.length; start += concurrency) {
    const batch = inventory.traits.slice(start, start + concurrency)
    const results = await Promise.all(batch.map(async trait => {
      const sourcePath = resolve(sourceRoot, trait.sourcePath)
      if (!isBelow(sourceRoot, sourcePath)) throw new Error(`V08_SOURCE_TRAIT_PATH_INVALID:${trait.id}`)
      const rasterDiagnostics = await validateV08RasterContract({
        sourcePath,
        role: 'trait',
        ownerMaskPath: join(sourceRoot, 'master', 'masks', {
          bodySurface: 'body-surface.png', headSurface: 'head-surface.png', faceSafeZone: 'face-safe-zone.png',
          eyesRegion: 'eyes-region.png', mouthRegion: 'mouth-region.png', oralRegion: 'oral-region.png',
          tailSurface: 'tail-surface.png', frontPawDetail: 'front-paw-detail.png', hindPawDetail: 'hind-paw-detail.png',
          headAccessory: 'head-accessory.png', mutationEar: 'mutation-ear.png', mutationBack: 'mutation-back.png',
          mutationTailTip: 'mutation-tail-tip.png', effectField: 'effect-field.png', faceProtection: 'face-protection.png',
        }[trait.ownerRegionId]),
        allowEmpty: trait.slotId === 'effect' && trait.provenance.concept === 'none',
      })
      if (rasterDiagnostics.some(item => item.severity === 'error')) {
        throw new Error(`V08_SOURCE_TRAIT_REJECTED:${trait.id}:${rasterDiagnostics[0]!.code}`)
      }
      const stem = join(stagedAssetRoot, 'traits', trait.slotId, trait.id)
      const packaged = portableResource(await packageTrait(sourcePath, stem), stagedAssetRoot)
      return {
        trait,
        packaged,
        sourceSha256: sha256(await readFile(sourcePath)),
      }
    }))
    for (const result of results) {
      traits[result.trait.id] = result.packaged
      sourceIndexTraits.push({
        id: result.trait.id,
        sourcePath: `feline/${result.trait.sourcePath}`,
        sourceSha256: result.sourceSha256,
        runtimePngPath: result.packaged.pngPath,
        runtimePngSha256: result.packaged.pngSha256,
        runtimeAssetPath: result.packaged.assetPath,
        runtimeAssetSha256: result.packaged.assetSha256,
      })
    }
    input.onProgress?.(Math.min(start + concurrency, inventory.traits.length), inventory.traits.length)
  }

  const catalog = buildV08CatalogDocument(inventory, {
    sourceMasterSha256: inventory.sourceMasterSha256,
    structure,
    regions,
    traits,
  })
  const parsed = parseCatalog(catalog)
  if (!parsed.ok) throw new Error(`V08_CATALOG_SCHEMA_INVALID:${parsed.diagnostics.map(item => item.code).join(',')}`)
  const structureDiagnostics = validateCatalogStructure(parsed.value)
  if (structureDiagnostics.some(item => item.severity === 'error')) {
    throw new Error(`V08_CATALOG_STRUCTURE_INVALID:${structureDiagnostics.map(item => item.code).join(',')}`)
  }

  const catalogBytes = await writeJson(join(stagedCatalogRoot, 'catalog.json'), catalog)
  for (const [name, value] of Object.entries({
    'parts.json': catalog.parts,
    'rigs.json': catalog.rigs,
    'themes.json': catalog.themes,
    'semantic-traits.json': catalog.semanticTraits,
    'modifiers.json': catalog.modifiers,
    'species-rigs.json': catalog.speciesRigs,
  })) await writeJson(join(stagedCatalogRoot, name), value)

  const sourceIndex: V08SourceIndex = {
    schemaVersion: 'qmonster-v08-source-index-v1',
    catalogVersion: '0.8.0',
    speciesRigId: 'feline-sit-v1',
    sourceMaster: { path: 'feline/master/feline-sit-v1.png', sha256: inventory.sourceMasterSha256 },
    regionGuide: {
      path: 'feline/region-guides.json',
      sha256: sha256(await readFile(join(sourceRoot, 'region-guides.json'))),
    },
    traits: sourceIndexTraits,
    runtimeResources: allRuntimeResources(catalog),
  }
  const sourceIndexBytes = await writeJson(
    join(stagedRoot, 'packages', 'asset-catalog', 'source-index-v0.8.0.json'), sourceIndex,
  )
  const evidence: V08EvidenceManifest = {
    schemaVersion: 'qmonster-v08-production-evidence-v1',
    catalogVersion: '0.8.0',
    sourceIndexPath: 'packages/asset-catalog/source-index-v0.8.0.json',
    sourceIndexSha256: sha256(sourceIndexBytes),
    catalogPath: 'packages/asset-catalog/catalog/v0.8.0/catalog.json',
    catalogSha256: sha256(catalogBytes),
    sourceMasterSha256: inventory.sourceMasterSha256,
    traitCount: 182,
    runtimeResourceCount: sourceIndex.runtimeResources.length,
  }
  await writeJson(join(stagedRoot, 'packages', 'asset-catalog', 'audit', 'v0.8.0', 'evidence-manifest.json'), evidence)

  const releaseDiagnostics = await validateV08ProductionRelease(stagedRoot, dirname(sourceRoot))
  if (releaseDiagnostics.some(item => item.severity === 'error')) {
    throw new Error(`V08_RELEASE_VALIDATION_FAILED:${releaseDiagnostics.map(item => item.code).join(',')}`)
  }

  await promoteNewPath(join(stagedRoot, 'packages', 'asset-catalog', 'assets', 'v0.8.0'), targets.assets)
  await promoteNewPath(join(stagedRoot, 'packages', 'asset-catalog', 'catalog', 'v0.8.0'), targets.catalog)
  await promoteNewPath(join(stagedRoot, 'packages', 'asset-catalog', 'source-index-v0.8.0.json'), targets.sourceIndex)
  await promoteNewPath(join(stagedRoot, 'packages', 'asset-catalog', 'audit', 'v0.8.0', 'evidence-manifest.json'), targets.evidence)
  await rm(stagedRoot, { recursive: true, force: true })
  return catalog
}

async function main(args: string[]): Promise<void> {
  const sourceRootIndex = args.indexOf('--source-root')
  const stagedRootIndex = args.indexOf('--staged-root')
  if (sourceRootIndex === -1 || stagedRootIndex === -1 || args.length !== 4) {
    throw new Error('Usage: tsx scripts/assemble-v08-catalog.ts --source-root <source-root> --staged-root <staged-root>')
  }
  const catalog = await assembleV08Catalog({
    repositoryRoot: process.cwd(),
    sourceRoot: args[sourceRootIndex + 1]!,
    stagedRoot: args[stagedRootIndex + 1]!,
    onProgress: (completed, total) => process.stdout.write(`packaged ${completed}/${total}\n`),
  })
  process.stdout.write(`published ${catalog.parts.length} traits\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main(process.argv.slice(2))
}
