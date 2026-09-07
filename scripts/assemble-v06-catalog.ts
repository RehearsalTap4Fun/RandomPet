import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { Catalog, Rarity, StructuralSlotId, VisualSlotId } from '@qmonster/generator-core'
import { buildProductionEvidenceManifest } from '../packages/asset-catalog/src/evidence-root.js'
import { PRODUCTION_CHROMA_GATE_PROFILE, PRODUCTION_CHROMA_GATE_VERSION } from '../packages/asset-catalog/src/chroma-quality-gate.js'
import { prepareAnatomyBundle, type AnatomyBundleSource, type PreparedAnatomyBundle } from './prepare-v06-anatomy-bundles.js'

const VERSION = '0.6.0'
export const V06_FELINE_RIG_ID = 'feline-sit' as const
const STRUCTURAL_SLOTS: StructuralSlotId[] = ['bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage']
const TRAIT_SLOTS: VisualSlotId[] = ['eyes', 'mouthShape', 'oralDetail', 'headAppendage', 'surfaceMaterial', 'pattern', 'colorScheme', 'effect']
const exactFinalPrompt = (primaryRequest: string): string => [
  'Use case: stylized-concept',
  'Asset type: 2048x2048 game anatomy bundle source',
  `Primary request: ${primaryRequest}`,
  'Scene/backdrop: genuinely transparent background.',
  'Composition/framing: centered full silhouette with generous transparent margin, entirely in canvas.',
  'Constraints: exactly one continuous cat silhouette; no separate parts; no props, floor, shadow, text, watermark, extra limbs, duplicate head, wings, fish tail, fan tail, cropped body.',
].join('\n')
const FINAL_PROMPTS: Record<string, string> = {
  'saffron-longtail': exactFinalPrompt('one complete front-facing seated feline, from head and two ears through neck and torso into exactly four paws and one conventional long curved cat tail, saffron orange with cream muzzle, friendly bright 3D plush-toy style.'),
  'silver-curl': exactFinalPrompt('one complete front-facing seated feline, head with two rounded triangular ears continuous through neck and torso to four paws and exactly one naturally curled C-shaped cat tail, soft silver gray and pale lavender accents, bright friendly 3D plush-toy style.'),
  'midnight-longtail': exactFinalPrompt('one complete front-facing seated feline, small pointed ears, head and neck continuous into a compact torso, four clear paws and exactly one conventional long sweeping cat tail, midnight navy with tiny teal inner-ear color, friendly bright 3D plush-toy style.'),
  'moss-curl': exactFinalPrompt('one complete front-facing seated feline, modest fluffy cheek tufts and two ears, continuous head neck torso, exactly four paws and one conventional curled cat tail, moss green plush fur with warm amber belly accent, friendly bright 3D plush-toy style.'),
  'rose-longtail': exactFinalPrompt('one complete front-facing seated feline with broad soft ears, head and neck visibly continuous into a rounded torso, four paws and exactly one conventional long gently hooked cat tail, dusty rose and cream plush fabric, friendly bright 3D plush-toy style.'),
  'umber-curl': exactFinalPrompt('one complete front-facing seated feline with small lynx-like ear tufts attached to its head, a continuous neck and torso, four paws and exactly one conventional curled cat tail, warm umber brown with creamy chest, friendly bright 3D plush-toy style.'),
  'ivory-longtail': exactFinalPrompt('one complete front-facing seated feline, tall triangular ears, head through neck continuous into torso, exactly four paws and one conventional long curved cat tail, ivory plush fur with coral pink ears and paws, friendly bright 3D plush-toy style.'),
  'violet-curl': exactFinalPrompt('one complete front-facing seated feline, rounded cat ears and a small fluffy forehead tuft, head neck torso all continuous, exactly four paws and one conventional curled cat tail, violet and smoky plum plush texture, friendly bright 3D plush-toy style.'),
}
export const ANATOMY_BUNDLE_SOURCES: AnatomyBundleSource[] = ['saffron-longtail', 'silver-curl', 'midnight-longtail', 'moss-curl', 'rose-longtail', 'umber-curl', 'ivory-longtail', 'violet-curl'].map(id => ({
  id: `feline-sit-${id}`, sourcePath: `asset-source/v0.6.0/anatomy-bundles/feline/feline-sit-${id}.png`, prompt: FINAL_PROMPTS[id]!,
  faceSafeZone: { x: 650, y: 280, width: 748, height: 620 }, featureSockets: { eyes: { x: 880, y: 560 }, mouth: { x: 1024, y: 735 }, headAppendage: { x: 1024, y: 345 } },
  mutationAnchors: { ear: { x: 540, y: 190, width: 340, height: 300 }, back: { x: 1320, y: 900, width: 310, height: 420 }, tailTip: { x: 1450, y: 1110, width: 380, height: 440 } }, allowedTraitPools: {},
}))
const BUNDLE_RARITY: Record<string, Rarity> = {
  'feline-sit-saffron-longtail': 'N',
  'feline-sit-silver-curl': 'N',
  'feline-sit-midnight-longtail': 'N',
  'feline-sit-moss-curl': 'N',
  'feline-sit-rose-longtail': 'R',
  'feline-sit-umber-curl': 'R',
  'feline-sit-ivory-longtail': 'N',
  'feline-sit-violet-curl': 'L',
}
function rarityForBundle(id: string): Rarity {
  const rarity = BUNDLE_RARITY[id]
  if (rarity === undefined) throw new Error(`V06_BUNDLE_RARITY_MISSING:${id}`)
  return rarity
}
const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
const portable = (root: string, file: string): string => relative(root, file).replaceAll('\\', '/')
async function writeNew(file: string, value: Buffer): Promise<void> { await mkdir(dirname(file), { recursive: true }); const h = await open(file, 'wx'); try { await h.writeFile(value); await h.sync() } finally { await h.close() } }
function empty(id: string, slotId: VisualSlotId): any { return { id, slotId, rarity: 'N', baseWeight: 1, themeIds: ['deep-sea', 'fungal', 'shadow'], themeWeights: { 'deep-sea': 1, fungal: 1, shadow: 1 }, compatibleRigs: [V06_FELINE_RIG_ID], assetPath: '', maskPaths: {}, origin: { x: 1024, y: 1024 }, socket: null, layer: slotId === 'bodyFrame' ? 'body' : 'faceAndHeadwear', semanticTraitId: null, semanticPriority: 0, excludes: [], boosts: {}, displayName: id.replaceAll('_', ' '), flavorText: '完整猫科解剖由对应 bundle 的连续源图提供。', description: `source-free feline anatomy bundle derivative ${id}`, archetypeIds: ['feline'], featureTier: 'base' } }
function idFor(bundle: PreparedAnatomyBundle, slot: VisualSlotId): string { return `${slot}_feline_bundle_${bundle.id.replaceAll('-', '_')}` }
function partsFor(bundle: PreparedAnatomyBundle): any[] {
  const parts = STRUCTURAL_SLOTS.map(slot => {
    const part = empty(idFor(bundle, slot), slot)
    if (slot === 'bodyFrame') Object.assign(part, { assetPath: bundle.structural.assetPath, assetSha256: bundle.structural.assetSha256, pngPath: bundle.structural.pngPath, pngSha256: bundle.structural.pngSha256, composition: { mode: 'bundle', bundleId: bundle.id, isNone: false, motifTags: [], visualIntensity: 'quiet', renderNodes: [{ id: `${part.id}-node`, assetPath: bundle.structural.assetPath, assetSha256: bundle.structural.assetSha256, pngPath: bundle.structural.pngPath, pngSha256: bundle.structural.pngSha256, parentSlot: null, socket: null, origin: { x: 1024, y: 1024 }, transform: { scale: 1, mirrorX: false }, layer: 'body', compatibleRigs: [V06_FELINE_RIG_ID], clipPolicy: 'none' }], geometryByRig: { [V06_FELINE_RIG_ID]: { sockets: bundle.featureSockets, faceSafeZone: bundle.faceSafeZone } } } })
    else part.composition = { mode: 'bundle', bundleId: bundle.id, isNone: true, motifTags: [], visualIntensity: 'quiet', renderNodes: [], geometryByRig: {} }
    return part
  })
  return parts.concat(TRAIT_SLOTS.map(slot => {
    const part = { ...empty(idFor(bundle, slot), slot), composition: { mode: 'attachment', isNone: true, motifTags: [], visualIntensity: 'quiet', renderNodes: [], geometryByRig: {} } }
    if (slot === 'colorScheme') Object.assign(part, {
      rigMaskPaths: { [V06_FELINE_RIG_ID]: { primary: bundle.alpha.pngPath, secondary: bundle.alpha.pngPath, accent: bundle.alpha.pngPath } },
      rigMaskSha256: { [V06_FELINE_RIG_ID]: { primary: bundle.alpha.pngSha256, secondary: bundle.alpha.pngSha256, accent: bundle.alpha.pngSha256 } },
    })
    return part
  }))
}
function buildCatalog(prepared: PreparedAnatomyBundle[], themes: any[]): Catalog {
  const anatomyBundles = prepared.map(bundle => ({ id: bundle.id, archetypeId: 'feline' as const, rigId: V06_FELINE_RIG_ID, poseId: 'feline-sit', rarity: rarityForBundle(bundle.id), baseWeight: 1, structural: { assetPath: bundle.structural.assetPath, assetSha256: bundle.structural.assetSha256, pngPath: bundle.structural.pngPath, pngSha256: bundle.structural.pngSha256 }, alpha: { assetPath: bundle.alpha.assetPath, assetSha256: bundle.alpha.assetSha256, pngPath: bundle.alpha.pngPath, pngSha256: bundle.alpha.pngSha256 }, clip: { assetPath: bundle.clip.assetPath, assetSha256: bundle.clip.assetSha256, pngPath: bundle.clip.pngPath, pngSha256: bundle.clip.pngSha256 }, faceSafeZone: bundle.faceSafeZone, featureSockets: bundle.featureSockets, mutationAnchors: bundle.mutationAnchors, derivedSlots: Object.fromEntries(STRUCTURAL_SLOTS.map(slot => [slot, idFor(bundle, slot)])), allowedTraitPools: Object.fromEntries(TRAIT_SLOTS.map(slot => [slot, [idFor(bundle, slot)]])) }))
  const semanticSlots = ['frame', 'appendage', 'headAndEyes', 'mouth', 'surface', 'pattern']
  const semanticTraits = semanticSlots.map(semanticSlotId => ({ id: `feline_${semanticSlotId}`, semanticSlotId, displayName: `猫${semanticSlotId}`, flavorText: `bundle 支持的猫${semanticSlotId}`, rarity: 'N', themeBoosts: {}, excludes: [], boosts: {}, visualMapping: {} })).concat(
    ['gentle', 'curious', 'brave', 'dreamy', 'mischievous', 'shy'].map(id => ({ id: `personality_feline_${id}`, semanticSlotId: 'personality', displayName: `猫${id}`, flavorText: `bundle 支持的${id}猫性格。`, rarity: 'N', themeBoosts: {}, excludes: [], boosts: {}, visualMapping: {} })),
    ['sunbeam', 'purr', 'whisker', 'nap', 'ribbon', 'moon'].map(id => ({ id: `quirk_feline_${id}`, semanticSlotId: 'quirk', displayName: `猫${id}`, flavorText: `bundle 支持的${id}猫小习惯。`, rarity: 'N', themeBoosts: {}, excludes: [], boosts: {}, visualMapping: {} })),
  )
  const modifiers = [
    ['mutation_moonlit', 'mutation', '#f4f0ea', '#dce9ef', '#f4c7b8'],
    ['mutation_ember', 'mutation', '#8a3f2c', '#d98955', '#ffe0b3'],
    ['aberration_tideglass', 'aberration', '#365f8f', '#65c7d8', '#f2d37a'],
    ['aberration_plumlight', 'aberration', '#5f447b', '#9f72bb', '#e8c98f'],
  ].map(([id, kind, primary, secondary, accent]) => ({ id, kind, baseWeight: 1, requiresMutation: false, overrides: { palette: { primary, secondary, accent } }, displayName: id, flavorText: `${id}为完整猫科 bundle 增添稳定配色。`, rarity: 'R', themeBoosts: {}, excludes: [], boosts: {}, visualMapping: { type: 'paletteOverride', targetSlot: 'colorScheme', assetIds: [] } }))
  return { version: VERSION, themes, rigs: [{ id: V06_FELINE_RIG_ID, sourceId: idFor(prepared[0]!, 'bodyFrame'), displayName: '正面居中坐姿猫', sockets: { head: { x: 1024, y: 650 }, tail: { x: 1540, y: 1320 }, eyes: { x: 880, y: 560 }, mouth: { x: 1024, y: 735 }, oralDetail: { x: 1024, y: 760 }, headAppendage: { x: 1024, y: 345 }, overlay: { x: 1024, y: 1024 }, effect: { x: 1024, y: 1024 } } }], parts: prepared.flatMap(partsFor), semanticTraits, modifiers, dependencies: { headShape: ['bodyFrame'], eyes: ['headShape'], mouthShape: ['headShape'], oralDetail: ['mouthShape'], headAppendage: ['headShape'], tail: ['bodyFrame'] }, compositionPolicy: { motifSlots: ['eyes', 'mouthShape'], surpriseRatio: 0.3, maxStrongFeatures: 2, maxStrongNonFacialFeatures: 1, optionalNoneRate: { min: 0.35, max: 0.5 }, frameBounds: { x: 0, y: 0, width: 2048, height: 2048 }, faceInsideRatio: 0.84, faceVisibleRatio: 0.84 }, archetypes: [{ id: 'feline', displayName: '坐姿猫', rigIds: [V06_FELINE_RIG_ID], defaultRigId: V06_FELINE_RIG_ID, requiredVisibleSlots: ['bodyFrame'], integratedSlots: ['arms', 'legs', 'extraAppendage', 'headShape', 'tail'], specialFeatureSlots: [] }], anatomyBundles } as Catalog
}
export async function assembleV06Catalog(options: { repositoryRoot?: string, stagedRoot: string }): Promise<Catalog> {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd()), stagedRoot = resolve(options.stagedRoot), assetRoot = join(stagedRoot, 'packages', 'asset-catalog', 'assets', `v${VERSION}`), catalogRoot = join(stagedRoot, 'packages', 'asset-catalog', 'catalog', `v${VERSION}`)
  for (const target of [assetRoot, catalogRoot]) try { await lstat(target); throw new Error(`V06_RELEASE_TARGET_EXISTS_NO_OVERWRITE:${target}`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const prepared = await Promise.all(ANATOMY_BUNDLE_SOURCES.map(source => prepareAnatomyBundle({ ...source, sourcePath: join(repositoryRoot, source.sourcePath) }, assetRoot)))
  const catalog = buildCatalog(prepared, JSON.parse(await readFile(join(repositoryRoot, 'packages', 'asset-catalog', 'catalog', 'v0.5.0', 'themes.json'), 'utf8')))
  const sourceHashes = new Map(await Promise.all(prepared.map(async bundle => [bundle.id, digest(await readFile(bundle.sourcePath))] as const)))
  const manifest = { schemaVersion: 'qmonster-v06-anatomy-bundles-v1', catalogVersion: VERSION, canvasSize: 2048, bundles: prepared.map(bundle => ({ id: bundle.id, rarity: rarityForBundle(bundle.id), baseWeight: 1, sourcePath: portable(repositoryRoot, bundle.sourcePath), dimensions: { width: 2048, height: 2048 }, alphaBounds: bundle.alphaBounds, sourceSha256: sourceHashes.get(bundle.id), faceSafeZone: bundle.faceSafeZone, featureSockets: bundle.featureSockets, mutationAnchors: bundle.mutationAnchors, allowedTraitPools: Object.fromEntries(TRAIT_SLOTS.map(slot => [slot, [idFor(bundle, slot)]])), prompt: bundle.prompt })) }
  const manifestBytes = json(manifest)
  const sources = prepared.map(bundle => { const part = catalog.parts.find(item => item.id === idFor(bundle, 'bodyFrame'))!; return { sourceId: part.id, kind: 'generated-transparent-layer', promptId: `v06-anatomy-${bundle.id}`, promptCatalogPath: 'asset-source/v0.6.0/anatomy-bundles/manifest.json', promptCatalogSha256: digest(manifestBytes), selectedCandidate: 1, sourceResources: [{ path: portable(repositoryRoot, bundle.sourcePath), sha256: sourceHashes.get(bundle.id) }], runtimePngPath: part.pngPath, runtimePngSha256: part.pngSha256, runtimeWebpPath: part.assetPath, runtimeWebpSha256: part.assetSha256, runtimeResources: [bundle.structural, bundle.alpha, bundle.clip].flatMap(resource => [{ path: resource.pngPath, sha256: resource.pngSha256 }, { path: resource.assetPath, sha256: resource.assetSha256 }]) } })
  const index = { catalogVersion: VERSION, extractionGate: { gateVersion: PRODUCTION_CHROMA_GATE_VERSION, profile: PRODUCTION_CHROMA_GATE_PROFILE }, sources, qualityGateSummary: { rigCandidatesEvaluated: 0, rigCandidatesPassed: 0, partCandidatesEvaluated: 0, partCandidatesPassed: 0, approvedRigSelectionsPassing: 0, approvedPartSelectionsPassing: 0 }, review: { generatedSourceCount: 8, invalidCandidateCount: 0 } }
  await Promise.all([writeNew(join(stagedRoot, 'asset-source', 'v0.6.0', 'anatomy-bundles', 'manifest.json'), manifestBytes), writeNew(join(stagedRoot, 'packages', 'asset-catalog', 'source-index-v0.6.0.json'), json(index)), writeNew(join(stagedRoot, 'packages', 'asset-catalog', 'audit', `v${VERSION}`, 'evidence-manifest.json'), json(buildProductionEvidenceManifest(index)))])
  for (const [name, value] of [['catalog.json', catalog], ['themes.json', catalog.themes], ['rigs.json', catalog.rigs], ['parts.json', catalog.parts], ['semantic-traits.json', catalog.semanticTraits], ['modifiers.json', catalog.modifiers]] as const) await writeNew(join(catalogRoot, name), json(value))
  return catalog
}
