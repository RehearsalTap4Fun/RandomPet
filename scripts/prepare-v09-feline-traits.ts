import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {
  canonicalJsonBytes,
  canonicalJsonSha256,
  createTraitVisualApproval,
  decodedPngSha256,
  sealTraitBundle,
  type SealContext,
  type TraitBundleV1,
  type TraitVisualApprovalV1,
  type ApprovedAttachmentAllowlistV1,
} from '../packages/asset-catalog/src/index.js'
import {
  parseContentResourceId,
  V09_TRAIT_SLOT_IDS,
  type AssemblyTemplateV1,
  type AttachmentShapeClass,
  type ContentResourceRef,
  type PngResourceRef,
  type SealedTraitArtifactV1,
  type SkeletonFamilyV1,
  type V09TraitRarity,
  type V09TraitSlotId,
} from '../packages/generator-core/src/v09-contracts.js'
import { approveFelineMasters, MOUTH_SOCKET_PARENT_TRAIT_IDS, prepareFelineMasters, validateFelineMasters, type CombinedTraitReview } from './prepare-v09-feline-masters.js'

const SIZE = 2048
const PIXELS = SIZE * SIZE
const SOURCE_ROOT = 'asset-source/v0.9.0/feline'
const ASSET_ROOT = 'packages/asset-catalog/assets/v0.9.0/by-sha256'
const SEALED_ROOT = 'packages/asset-catalog/catalog/v0.9.0/sealed-traits'
const APPROVAL_ROOT = 'packages/asset-catalog/audit/v0.9.0/trait-approvals'
const REPORT_PATH = 'artifacts/acceptance/v0.9.0-feline/trait-catalog-review.png'
const ORAL_REPORT_PATH = 'artifacts/acceptance/v0.9.0-feline/trait-oral-compatibility-review.png'
const ATTACHMENT_REPORT_PATH = 'artifacts/acceptance/v0.9.0-feline/trait-attachment-interface-review.png'
const REPORT_INDEX_PATH = `${SOURCE_ROOT}/trait-review/trait-catalog-review.index.json`
const FAMILY_IDS = ['feline-sit-v2-core', 'feline-sit-v2-legendary-01'] as const
const RARITIES = ['common', 'rare', 'legendary'] as const
const OPEN_SOCKET_CLASSES = ['open', 'narrow', 'wide'] as const
const COUNTS = { common: 8, rare: 4, legendary: 1 } as const
const SEALER_VERSION = 'qmonster-v09-feline-traits-deterministic-v1'

type SocketClass = 'oral-none' | 'open' | 'narrow' | 'wide'
type EffectMode = 'background' | 'foreground' | 'targeted'
export type FelineTraitDefinition = {
  slotId: V09TraitSlotId
  traitId: string
  displayName: string
  rarity: V09TraitRarity
  oralSocketClass?: SocketClass
  shapeClass?: AttachmentShapeClass
  effectMode?: EffectMode
}
type DefinitionTiers = Record<V09TraitRarity, readonly string[]>

const IDS: Record<V09TraitSlotId, DefinitionTiers> = {
  bodyColor: { common: ['body-color-lime-mint', 'body-color-coral-cream', 'body-color-ocean-blue', 'body-color-honey-gold', 'body-color-lavender-mist', 'body-color-rose-quartz', 'body-color-forest-moss', 'body-color-cloud-gray'], rare: ['body-color-ember-glow', 'body-color-arctic-teal', 'body-color-dusk-violet', 'body-color-sunburst'], legendary: ['body-color-aurora-prism'] },
  surfacePattern: { common: ['pattern-soft-tabby', 'pattern-cloud-spots', 'pattern-saddle-patch', 'pattern-sock-points', 'pattern-ripple-stripes', 'pattern-freckle-dust', 'pattern-mask-cap', 'pattern-dorsal-line'], rare: ['pattern-constellation', 'pattern-koi-marble', 'pattern-ember-rosette', 'pattern-moon-rings'], legendary: ['pattern-celestial-map'] },
  surfaceTexture: { common: ['texture-short-plush', 'texture-velvet', 'texture-woolly', 'texture-satin', 'texture-downy', 'texture-tousled', 'texture-corduroy', 'texture-suede'], rare: ['texture-crystal-fur', 'texture-mossy', 'texture-pearl-sheen', 'texture-frosted'], legendary: ['texture-starlight-pile'] },
  forepawDetail: { common: ['forepaw-mitten-tips', 'forepaw-toe-beans', 'forepaw-soft-socks', 'forepaw-dipped-toes', 'forepaw-double-bands', 'forepaw-speckled', 'forepaw-cream-cuffs', 'forepaw-shadow-cuffs'], rare: ['forepaw-ember-claws', 'forepaw-crystal-caps', 'forepaw-moon-sigils', 'forepaw-vine-wraps'], legendary: ['forepaw-star-gauntlets'] },
  hindpawDetail: { common: ['hindpaw-heel-socks', 'hindpaw-toe-beans', 'hindpaw-dipped-heels', 'hindpaw-soft-bands', 'hindpaw-speckled', 'hindpaw-cream-boots', 'hindpaw-shadow-boots', 'hindpaw-leaf-marks'], rare: ['hindpaw-ember-spurs', 'hindpaw-crystal-caps', 'hindpaw-moon-sigils', 'hindpaw-vine-wraps'], legendary: ['hindpaw-star-greaves'] },
  tailSurface: { common: ['tail-surface-ringed', 'tail-surface-dipped-tip', 'tail-surface-dorsal-stripe', 'tail-surface-soft-bands', 'tail-surface-speckled', 'tail-surface-gradient', 'tail-surface-leaf-marks', 'tail-surface-cloud-marks'], rare: ['tail-surface-ember-rings', 'tail-surface-crystal-bands', 'tail-surface-moon-trail', 'tail-surface-koi-marble'], legendary: ['tail-surface-constellation'] },
  eyes: { common: ['eyes-round-amber', 'eyes-round-aqua', 'eyes-soft-green', 'eyes-sleepy-violet', 'eyes-wide-blue', 'eyes-warm-hazel', 'eyes-button-black', 'eyes-rose-gold'], rare: ['eyes-heterochromia', 'eyes-crystal-facet', 'eyes-moon-slit', 'eyes-ember-ring'], legendary: ['eyes-nebula-pair'] },
  mouthShape: { common: ['mouth-soft-smile', 'mouth-petite-pout', 'mouth-open-cheer', 'mouth-tiny-yawn', 'mouth-narrow-grin', 'mouth-narrow-mew', 'mouth-wide-laugh', 'mouth-wide-surprise'], rare: ['mouth-fanged-smirk', 'mouth-heart-open', 'mouth-royal-wide', 'mouth-serene-closed'], legendary: ['mouth-celestial-roar'] },
  oralDetail: { common: ['oral-pink-tongue', 'oral-curl-tongue', 'oral-tiny-fangs', 'oral-pearl-teeth', 'oral-berry-tongue', 'oral-heart-tongue', 'oral-soft-palate', 'oral-milk-teeth'], rare: ['oral-crystal-fangs', 'oral-ember-tongue', 'oral-moon-teeth', 'oral-flower-tongue'], legendary: ['oral-starlight-breath'] },
  headAppendage: { common: ['head-tiny-horn', 'head-leaf-clip', 'head-ribbon-pin', 'head-bell-buds', 'head-shell-pin', 'head-feather-clip', 'head-flower-pin', 'head-moon-pin'], rare: ['head-crystal-horns', 'head-gilded-ornament', 'head-ember-horns', 'head-aurora-ornament'], legendary: ['head-celestial-crownlet'] },
  extraAppendage: { common: ['extra-soft-collar', 'extra-bell-collar', 'extra-leaf-collar', 'extra-ribbon-collar', 'extra-small-mane', 'extra-cloud-mane', 'extra-bead-collar', 'extra-moon-collar'], rare: ['extra-crystal-collar', 'extra-ember-mane', 'extra-royal-mane', 'extra-aurora-collar'], legendary: ['extra-celestial-mane'] },
  effect: { common: ['effect-soft-glow', 'effect-dust-motes', 'effect-leaf-drift', 'effect-bubble-halo', 'effect-heart-spark', 'effect-moon-motes', 'effect-warm-breath', 'effect-cloud-puff'], rare: ['effect-ember-orbit', 'effect-crystal-spark', 'effect-aurora-ribbon', 'effect-flower-burst'], legendary: ['effect-celestial-aura'] },
}

const mouthSocket = (traitId: string): SocketClass => {
  for (const [socket, ids] of Object.entries(MOUTH_SOCKET_PARENT_TRAIT_IDS) as Array<[SocketClass, readonly string[]]>) if (ids.includes(traitId)) return socket
  throw new Error(`Mouth trait lacks a frozen socket: ${traitId}`)
}

function definition(slotId: V09TraitSlotId, traitId: string, rarity: V09TraitRarity, ordinal: number): FelineTraitDefinition {
  const base = { slotId, traitId, rarity, displayName: traitId.split('-').slice(1).join(' ') }
  if (slotId === 'mouthShape') return { ...base, oralSocketClass: mouthSocket(traitId) }
  if (slotId === 'oralDetail') return { ...base, oralSocketClass: (['open', 'narrow', 'wide'] as const)[ordinal % 3]! }
  if (slotId === 'headAppendage') return { ...base, shapeClass: ordinal % 2 === 0 ? 'ear-horn-small' : 'ear-ornament' }
  if (slotId === 'extraAppendage') return { ...base, shapeClass: traitId.includes('mane') ? 'mane-small' : 'collar' }
  if (slotId === 'effect') return { ...base, effectMode: (['targeted', 'background', 'foreground'] as const)[ordinal % 3]! }
  return base
}

export const FELINE_TRAIT_DEFINITIONS = Object.freeze(Object.fromEntries(V09_TRAIT_SLOT_IDS.map(slotId => {
  let ordinal = 0
  return [slotId, Object.freeze(RARITIES.flatMap(rarity => IDS[slotId][rarity].map(traitId => definition(slotId, traitId, rarity, ordinal++))))]
})) as Record<V09TraitSlotId, readonly FelineTraitDefinition[]>)

export function buildFelineTraitInventory() {
  return {
    schemaVersion: 'qmonster-trait-inventory-v1' as const,
    traits: V09_TRAIT_SLOT_IDS.flatMap(slotId => FELINE_TRAIT_DEFINITIONS[slotId].map(item => ({
      slotId: item.slotId, traitId: item.traitId, rarity: item.rarity,
      ...((item.slotId === 'mouthShape' || item.slotId === 'oralDetail') ? { oralSocketClass: item.oralSocketClass } : {}),
    }))),
  }
}

type LoadedFamily = {
  family: SkeletonFamilyV1
  template: AssemblyTemplateV1
  templateSha256: string
  masterBytes: Buffer
  master: Buffer
  materialMap: Buffer
  resourceBytes: Map<string, Buffer>
  overlayPolicy: ContentResourceRef
}

type ProjectionProduct = {
  artifact: SealedTraitArtifactV1
  artifactSha256: string
  manifestBytes: Buffer
  previewBytes: Buffer
  ownedResources: Map<string, { ref: ContentResourceRef; bytes: Buffer }>
  oralReview?: Array<{ oralSocketClass: typeof OPEN_SOCKET_CLASSES[number]; runtimeProjection: PngResourceRef; fullContextPreview: PngResourceRef }>
  attachmentReview?: { allowedZone: PngResourceRef; rearRootStencil: PngResourceRef; frontRootStencil?: PngResourceRef; fixedOccluderMask: PngResourceRef; diagnosticPreview: PngResourceRef }
}

type PreparedEntry = {
  skeletonFamilyId: string
  slotId: V09TraitSlotId
  traitId: string
  displayName: string
  rarity: V09TraitRarity
  sealedArtifactSha256: string
  sealedManifestPath: string
  sourceProjectionPath: string
  fullContextPreview: PngResourceRef
  assemblyTemplateSha256: string
  kind: SealedTraitArtifactV1['kind']
  interfaceId?: string
  shapeClass?: AttachmentShapeClass
  oralSocketClass?: string
  oralCompatibility?: ProjectionProduct['oralReview']
  attachmentInterface?: ProjectionProduct['attachmentReview']
}

const absolute = (workspaceRoot: string, path: string) => resolve(workspaceRoot, path)
const jsonBytes = (value: unknown) => Buffer.concat([canonicalJsonBytes(value), Buffer.from('\n')])
async function writeJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); await writeFile(path, jsonBytes(value)) }
async function pngRef(bytes: Buffer): Promise<PngResourceRef> { const sha256 = await decodedPngSha256(bytes); return { resourceId: parseContentResourceId(`sha256:${sha256}`)!, sha256, mediaType: 'image/png', width: SIZE, height: SIZE } }
function manifestRef(value: unknown): ContentResourceRef { const sha256 = canonicalJsonSha256(value); return { resourceId: parseContentResourceId(`sha256:${sha256}`)!, sha256, mediaType: 'application/qmonster-manifest-v1+json' } }
function materialRef(value: unknown): ContentResourceRef { const sha256 = canonicalJsonSha256(value); return { resourceId: parseContentResourceId(`sha256:${sha256}`)!, sha256, mediaType: 'application/qmonster-material-v1+json' } }
const byteSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const rawReportSha256 = (pixels: Uint8Array, width: number, height: number) => createHash('sha256').update(`${width}x${height}:rgba8:`).update(pixels).digest('hex')
const contained = (root: string, path: string) => { const part = relative(root, path); return part !== '..' && !part.startsWith('..' + sep) && !resolve(path).startsWith('\\\\') }

async function encodeRgba(pixels: Uint8Array, width = SIZE, height = SIZE): Promise<Buffer> {
  return sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer()
}

export async function reportCopyMatches(bytes: Uint8Array | undefined, descriptor: { sha256: string; byteSha256: string; width: number; height: number }): Promise<boolean> {
  if (bytes === undefined || byteSha256(bytes) !== descriptor.byteSha256) return false
  try {
    const raw = await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return raw.info.width === descriptor.width && raw.info.height === descriptor.height
      && rawReportSha256(raw.data, raw.info.width, raw.info.height) === descriptor.sha256
  } catch { return false }
}

async function loadFamily(workspaceRoot: string, skeletonFamilyId: string): Promise<LoadedFamily> {
  const templateDirectory = absolute(workspaceRoot, `${SOURCE_ROOT}/templates/${skeletonFamilyId}`)
  const family = JSON.parse(await readFile(join(templateDirectory, 'family.json'), 'utf8')) as SkeletonFamilyV1
  const template = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/templates/${skeletonFamilyId}.json`), 'utf8')) as AssemblyTemplateV1
  const masterBytes = await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/masters/${skeletonFamilyId}.png`))
  const master = await sharp(masterBytes).toColourspace('srgb').ensureAlpha().raw().toBuffer()
  const materialMap = await sharp(await readFile(join(templateDirectory, 'material-map.png'))).toColourspace('srgb').ensureAlpha().raw().toBuffer()
  const resourceBytes = new Map<string, Buffer>([[family.neutralMaster.resourceId, masterBytes]])
  for (const name of await readdir(templateDirectory)) if (name.endsWith('.png')) {
    const bytes = await readFile(join(templateDirectory, name)); const ref = await pngRef(bytes); resourceBytes.set(ref.resourceId, bytes)
  }
  const policy = JSON.parse(await readFile(join(templateDirectory, 'overlay-policy.json'), 'utf8'))
  const overlayPolicy = manifestRef(policy)
  resourceBytes.set(overlayPolicy.resourceId, canonicalJsonBytes(policy))
  return { family, template, templateSha256: canonicalJsonSha256(template), masterBytes, master, materialMap, resourceBytes, overlayPolicy }
}

function bytesFor(family: LoadedFamily, ref: ContentResourceRef): Buffer {
  const bytes = family.resourceBytes.get(ref.resourceId)
  if (bytes === undefined) throw new Error(`Missing template resource ${ref.resourceId}`)
  return bytes
}

function rgba(index: number, familyIndex: number): [number, number, number] {
  const palettes: Array<[number, number, number]> = [[98, 205, 145], [244, 151, 148], [80, 170, 232], [236, 190, 75], [169, 137, 224], [233, 126, 171], [77, 133, 91], [145, 157, 174], [235, 92, 62], [71, 205, 208], [116, 82, 183], [250, 166, 45], [164, 104, 245]]
  const color = palettes[index % palettes.length]!
  return familyIndex === 0 ? color : [Math.min(255, color[0] + 10), Math.max(0, color[1] - 7), Math.min(255, color[2] + 14)]
}

function alphaMask(bytes: Buffer): Promise<Buffer> { return sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer() }
function transparent(): Buffer { return Buffer.alloc(PIXELS * 4) }
function paint(mask: Uint8Array, color: [number, number, number], ordinal: number, mode: 'solid' | 'bands' | 'dots' | 'edge' = 'solid', alpha = 255): Buffer {
  const out = transparent()
  for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    if (mask[pixel * 4 + 3] === 0) continue
    const x = pixel % SIZE, y = Math.floor(pixel / SIZE)
    const on = mode === 'solid' || (mode === 'bands' ? ((x + y + ordinal * 37) % (92 + ordinal % 5 * 13)) < 28 : mode === 'dots' ? ((x * 17 + y * 29 + ordinal * 101) % 347) < 18 : ((x + ordinal * 31) % 113) < 10)
    if (!on) continue
    const i = pixel * 4; out[i] = color[0]; out[i + 1] = color[1]; out[i + 2] = color[2]; out[i + 3] = alpha
  }
  return out
}

type AlphaBounds = { minX: number; minY: number; maxX: number; maxY: number }

function alphaBounds(pixels: Uint8Array): AlphaBounds {
  let minX = SIZE, minY = SIZE, maxX = -1, maxY = -1
  for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    if (pixels[pixel * 4 + 3] === 0) continue
    const x = pixel % SIZE, y = Math.floor(pixel / SIZE)
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  if (maxX < minX || maxY < minY) throw new Error('Attachment mask is empty')
  return { minX, minY, maxX, maxY }
}

/**
 * Authors a compact silhouette grown from the immutable interface root. The
 * geometry is deliberately local: the allowed zone is a hard envelope, never
 * a shape template or a fill target.
 */
export function paintAttachmentSilhouette(
  allowed: Uint8Array,
  root: Uint8Array,
  shapeClass: AttachmentShapeClass,
  ordinal: number,
  color: [number, number, number],
  layer: 'behind' | 'front',
  alpha: number,
): Buffer {
  const allowedBox = alphaBounds(allowed)
  const rootBox = alphaBounds(root)
  const out = transparent()
  const candidate = new Uint8Array(PIXELS)
  const rootCenterX = (rootBox.minX + rootBox.maxX) / 2
  const rootCenterY = (rootBox.minY + rootBox.maxY) / 2
  const isFront = layer === 'front'

  const headCandidate = (x: number, y: number): boolean => {
    if (shapeClass === 'ear-horn-small') {
      const count = ordinal >= 12 ? 3 : ordinal >= 8 ? 2 : 1
      for (let horn = 0; horn < count; horn += 1) {
        const spread = count === 1 ? 0 : (horn - (count - 1) / 2) * (isFront ? 54 : 86)
        const centerX = rootCenterX + spread + ((ordinal % 3) - 1) * 12
        const apexY = isFront ? rootBox.minY - 20 : allowedBox.minY + 12 + (ordinal % 4) * 7
        const baseY = isFront ? rootBox.maxY + 2 : rootBox.maxY
        if (y < apexY || y > baseY) continue
        const progress = (y - apexY) / Math.max(1, baseY - apexY)
        const halfWidth = (isFront ? 4 : 7) + progress * (isFront ? 22 : 42)
        if (Math.abs(x - centerX) <= halfWidth) return true
      }
      return false
    }
    const centerX = rootBox.minX + (rootBox.maxX - rootBox.minX) * (0.28 + (ordinal % 4) * 0.14)
    const centerY = rootBox.minY - (isFront ? 5 : 24)
    const radiusX = isFront ? 22 : 39 + ordinal % 3 * 4
    const radiusY = isFront ? 18 : 46 + ordinal % 2 * 8
    const emblem = ordinal % 4 === 1
      ? Math.abs(x - centerX) / radiusX + Math.abs(y - centerY) / radiusY <= 1
      : ((x - centerX) ** 2) / (radiusX ** 2) + ((y - centerY) ** 2) / (radiusY ** 2) <= 1
    const stem = Math.abs(x - centerX) <= (isFront ? 7 : 10) && y >= centerY && y <= rootBox.maxY
    return emblem || stem
  }

  const rowMin = new Int32Array(SIZE); rowMin.fill(SIZE)
  const rowMax = new Int32Array(SIZE); rowMax.fill(-1)
  if (shapeClass === 'collar') for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    if (root[pixel * 4 + 3] === 0) continue
    const x = pixel % SIZE, y = Math.floor(pixel / SIZE)
    rowMin[y] = Math.min(rowMin[y]!, x); rowMax[y] = Math.max(rowMax[y]!, x)
  }
  const extraCandidate = (x: number, y: number): boolean => {
    if (shapeClass === 'collar') {
      // The rear is a narrow neck band visible outside the shoulder; the front
      // adds a short drop and unmistakable pendant. Both are joined to the
      // immutable root, never inferred by filling the broad allowed envelope.
      if (!isFront) {
        const bandStart = allowedBox.minX + 18, bandEnd = rootBox.maxX
        if (x < bandStart || x > bandEnd) return false
        const t = (x - bandStart) / Math.max(1, bandEnd - bandStart)
        const bandY = rootBox.minY + 48 + Math.round(24 * Math.sin(t * Math.PI / 2))
        return Math.abs(y - bandY) <= 12 + ordinal % 3
      }
      const bandStart = rootBox.minX, bandEnd = allowedBox.maxX - 8
      const t = (x - bandStart) / Math.max(1, bandEnd - bandStart)
      const bandY = rootBox.minY + 34 + Math.round(18 * t)
      const strap = x >= bandStart && x <= bandEnd && Math.abs(y - bandY) <= 13 + ordinal % 3
      const joinX = allowedBox.maxX - 34, joinY = rootBox.minY + 52
      const drop = Math.abs(x - joinX) <= 7 && y >= joinY && y <= rootBox.maxY + 62
      const pendantY = rootBox.maxY + 82 + (ordinal % 3) * 5
      const pendant = Math.abs(x - joinX) / (24 + ordinal % 3 * 3) + Math.abs(y - pendantY) / 27 <= 1
      return strap || drop || pendant
    }
    // A mane reads as a fan of discrete tapered tufts grown leftward from the
    // neck root. Varying the tuft tips changes the same semantic candidate
    // deterministically without introducing detached capsules or zone wash.
    const tuftCount = ordinal >= 12 ? 5 : ordinal >= 8 ? 4 : 3
    const usableHeight = rootBox.maxY - rootBox.minY
    for (let tuft = 0; tuft < tuftCount; tuft += 1) {
      const anchorY = rootBox.minY + ((tuft + 0.5) / tuftCount) * usableHeight
      const halfHeight = usableHeight / tuftCount * (isFront ? 0.48 : 0.62)
      if (Math.abs(y - anchorY) > halfHeight) continue
      const taper = 1 - Math.abs(y - anchorY) / halfHeight
      const baseX = isFront ? rootBox.minX : rootBox.minX + 8
      const tipX = isFront ? allowedBox.maxX - 6 : rootBox.minX - (78 + (tuft % 2) * 20 + ordinal % 3 * 5)
      if (isFront) {
        if (x >= baseX - 8 && x <= tipX - (1 - taper) * (tipX - baseX)) return true
      } else if (x >= tipX + (1 - taper) * (baseX - tipX) && x <= baseX + 8) return true
    }
    return false
  }

  for (let y = allowedBox.minY; y <= allowedBox.maxY; y += 1) for (let x = allowedBox.minX; x <= allowedBox.maxX; x += 1) {
    const pixel = y * SIZE + x, offset = pixel * 4
    if (allowed[offset + 3] === 0) continue
    const isRoot = root[offset + 3] === 255
    const geometric = shapeClass === 'ear-horn-small' || shapeClass === 'ear-ornament'
      ? headCandidate(x, y)
      : extraCandidate(x, y)
    if (!isRoot && !geometric) continue
    candidate[pixel] = 1
    if (isRoot) root.copy(out, offset, offset, offset + 4)
    else { out[offset] = color[0]; out[offset + 1] = color[1]; out[offset + 2] = color[2]; out[offset + 3] = alpha }
  }

  // Keep only candidate geometry connected to an immutable root. This is also
  // resilient to clipped allowed-zone edges without growing or repainting them.
  const visited = new Uint8Array(PIXELS)
  const queue = new Int32Array(PIXELS)
  let read = 0, written = 0
  for (let pixel = 0; pixel < PIXELS; pixel += 1) if (root[pixel * 4 + 3] === 255) {
    visited[pixel] = 1; queue[written++] = pixel
  }
  while (read < written) {
    const pixel = queue[read++]!, x = pixel % SIZE, y = Math.floor(pixel / SIZE)
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue
      const next = ny * SIZE + nx
      if (candidate[next] === 0 || visited[next] !== 0) continue
      visited[next] = 1; queue[written++] = next
    }
  }
  for (let pixel = 0; pixel < PIXELS; pixel += 1) if (candidate[pixel] !== 0 && visited[pixel] === 0) out.fill(0, pixel * 4, pixel * 4 + 4)
  return out
}

function sourceOver(base: Buffer, layer: Uint8Array): Buffer {
  const out = Buffer.from(base)
  for (let i = 0; i < out.length; i += 4) {
    const a = layer[i + 3]!
    if (a === 0) continue
    const inv = 255 - a
    for (let c = 0; c < 3; c += 1) out[i + c] = Math.floor((layer[i + c]! * a + out[i + c]! * inv + 127) / 255)
    out[i + 3] = Math.min(255, a + Math.floor((out[i + 3]! * inv + 127) / 255))
  }
  return out
}

function replay(base: Buffer, master: Buffer, mask: Uint8Array): Buffer {
  const out = Buffer.from(base)
  for (let i = 0; i < out.length; i += 4) if (mask[i + 3] === 255) master.copy(out, i, i, i + 4)
  return out
}

function diagnosticOverlay(preview: Buffer, allowed: Uint8Array, rear: Uint8Array, front: Uint8Array | undefined, occluder: Uint8Array): Buffer {
  const out = Buffer.from(preview)
  const mark = (offset: number, rgb: [number, number, number]) => {
    out[offset] = rgb[0]; out[offset + 1] = rgb[1]; out[offset + 2] = rgb[2]; out[offset + 3] = 255
  }
  for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    const offset = pixel * 4, x = pixel % SIZE, y = Math.floor(pixel / SIZE)
    const boundary = allowed[offset + 3] !== 0 && (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1
      || allowed[offset - 4 + 3] === 0 || allowed[offset + 4 + 3] === 0
      || allowed[offset - SIZE * 4 + 3] === 0 || allowed[offset + SIZE * 4 + 3] === 0)
    if (boundary) mark(offset, [255, 220, 40])
    if (occluder[offset + 3] !== 0 && ((x + y) % 19 === 0)) mark(offset, [255, 255, 255])
    if (rear[offset + 3] === 255) mark(offset, [255, 40, 190])
    if (front?.[offset + 3] === 255) mark(offset, [30, 230, 255])
  }
  return out
}

function applyColorMap(master: Buffer, materialMap: Buffer, colorMap: Buffer, blendMode: 'replace-color' | 'multiply' | 'overlay'): Buffer {
  const out = Buffer.from(master)
  for (let i = 0; i < out.length; i += 4) {
    if (materialMap[i] !== 1 || materialMap[i + 3] !== 255 || colorMap[i + 3] === 0) continue
    const alpha = colorMap[i + 3]!
    for (let c = 0; c < 3; c += 1) {
      const base = out[i + c]!, color = colorMap[i + c]!
      const target = blendMode === 'replace-color' ? color : blendMode === 'multiply' ? Math.floor((base * color + 127) / 255) : base < 128 ? Math.floor((2 * base * color + 127) / 255) : 255 - Math.floor((2 * (255 - base) * (255 - color) + 127) / 255)
      out[i + c] = Math.floor((target * alpha + base * (255 - alpha) + 127) / 255)
    }
  }
  return out
}

async function buildProjection(family: LoadedFamily, definition: FelineTraitDefinition, familyIndex: number): Promise<ProjectionProduct> {
  const ordinal = FELINE_TRAIT_DEFINITIONS[definition.slotId].findIndex(item => item.traitId === definition.traitId)
  const color = rgba(ordinal + V09_TRAIT_SLOT_IDS.indexOf(definition.slotId) * 3, familyIndex)
  const ownedResources = new Map<string, { ref: ContentResourceRef; bytes: Buffer }>()
  const addPng = async (pixels: Buffer) => { const bytes = await encodeRgba(pixels); const ref = await pngRef(bytes); ownedResources.set(ref.resourceId, { ref, bytes }); return ref }
  const addJson = (value: unknown, media: 'material' | 'manifest' = 'manifest') => {
    const ref = media === 'material' ? materialRef(value) : manifestRef(value); const bytes = canonicalJsonBytes(value)
    ownedResources.set(ref.resourceId, { ref, bytes }); return ref
  }
  addJson(JSON.parse(Buffer.from(bytesFor(family, family.overlayPolicy)).toString('utf8')))
  let preview = Buffer.from(family.master)
  let oralReview: ProjectionProduct['oralReview']
  let attachmentReview: ProjectionProduct['attachmentReview']
  let bundle: Omit<TraitBundleV1, 'fullContextPreview'>
  const common = {
    traitId: definition.traitId, rarity: definition.rarity, slotId: definition.slotId,
    skeletonFamilyId: family.family.skeletonFamilyId, assemblyTemplateId: family.template.assemblyTemplateId,
    assemblyTemplateSha256: family.templateSha256, neutralMasterSha256: family.family.neutralMaster.sha256,
    sealerVersion: SEALER_VERSION, overlayPolicy: family.overlayPolicy,
  }

  if (['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface'].includes(definition.slotId)) {
    const slot = family.template.slots.surface.find(item => item.slotId === definition.slotId)
    if (slot === undefined) throw new Error(`Missing surface slot ${definition.slotId}`)
    const zone = await alphaMask(bytesFor(family, slot.authoringZone))
    const mode = definition.slotId === 'bodyColor' ? 'solid' : definition.slotId === 'surfaceTexture' ? 'dots' : definition.slotId.endsWith('Detail') ? 'edge' : 'bands'
    const alpha = definition.slotId === 'bodyColor' ? 225 : definition.rarity === 'legendary' ? 210 : 165
    const mapPixels = paint(zone, color, ordinal, mode, alpha)
    const mapRef = await addPng(mapPixels)
    const blendMode = definition.slotId === 'bodyColor' ? 'replace-color' as const : definition.slotId === 'surfaceTexture' ? 'multiply' as const : 'overlay' as const
    const operation = { schemaVersion: 'qmonster-material-v1' as const, ownerMaterialId: slot.ownerMaterialId, colorMap: mapRef, alphaPolicy: 'preserve-skeleton-alpha' as const, blendMode }
    const operationRef = addJson(operation, 'material')
    preview = applyColorMap(family.master, family.materialMap, mapPixels, blendMode)
    bundle = { ...common, kind: 'surface', resources: { materialOperation: operationRef } }
  } else if (definition.slotId === 'eyes') {
    const slot = family.template.slots.embedded.find(item => item.kind === 'eyePair')
    if (slot?.kind !== 'eyePair') throw new Error('Missing paired-eye template')
    const zone = await alphaMask(bytesFor(family, slot.pairAuthoringZone))
    const underlayPixels = paint(zone, [42, 35, 54], ordinal, 'solid', 110)
    const contentPixels = paint(zone, color, ordinal, 'solid', 255)
    for (let pixel = 0; pixel < PIXELS; pixel += 1) if (zone[pixel * 4 + 3] && ((pixel % SIZE) * 11 + Math.floor(pixel / SIZE) * 7 + ordinal * 31) % 151 < 31) {
      const i = pixel * 4; contentPixels[i] = 18; contentPixels[i + 1] = 22; contentPixels[i + 2] = 29; contentPixels[i + 3] = 255
    }
    const underlay = await addPng(underlayPixels), content = await addPng(contentPixels)
    preview = sourceOver(sourceOver(preview, underlayPixels), contentPixels)
    preview = replay(preview, family.master, await alphaMask(bytesFor(family, slot.occlusionReplayZone)))
    bundle = { ...common, kind: 'eyePair', resources: { underlay, content } }
  } else if (definition.slotId === 'mouthShape') {
    const mouth = family.template.slots.embedded.find(item => item.kind === 'mouth')
    const oral = family.template.slots.embedded.find(item => item.kind === 'oralDetail')
    if (mouth?.kind !== 'mouth' || oral?.kind !== 'oralDetail' || definition.oralSocketClass === undefined) throw new Error('Missing mouth/oral template')
    const socketRef = definition.oralSocketClass === 'oral-none' ? mouth.authoringZone : oral.socketRegistry[definition.oralSocketClass]?.authoringZone
    if (socketRef === undefined) throw new Error(`Missing oral socket ${definition.oralSocketClass}`)
    const socket = await alphaMask(bytesFor(family, socketRef)), mouthZone = await alphaMask(bytesFor(family, mouth.authoringZone))
    const backPixels = paint(socket, [65, 30, 48], ordinal, definition.oralSocketClass === 'oral-none' ? 'edge' : 'solid', 245)
    const frontPixels = paint(mouthZone, color, ordinal, 'edge', 180)
    const mouthBack = await addPng(backPixels), mouthFront = await addPng(frontPixels)
    preview = sourceOver(sourceOver(preview, backPixels), frontPixels)
    preview = replay(preview, family.master, await alphaMask(bytesFor(family, mouth.occlusionReplayZone)))
    bundle = { ...common, kind: 'mouth', oralSocketClass: definition.oralSocketClass === 'oral-none' ? 'closed' : definition.oralSocketClass, resources: { mouthBack, mouthFront } }
  } else if (definition.slotId === 'oralDetail') {
    const oral = family.template.slots.embedded.find(item => item.kind === 'oralDetail')
    const mouth = family.template.slots.embedded.find(item => item.kind === 'mouth')
    if (oral?.kind !== 'oralDetail' || mouth?.kind !== 'mouth' || definition.oralSocketClass === undefined || definition.oralSocketClass === 'oral-none') throw new Error('Missing open oral projection template')
    const mouthZone = await alphaMask(bytesFor(family, mouth.authoringZone))
    const replayZone = await alphaMask(bytesFor(family, mouth.occlusionReplayZone))
    const oralProjections: Record<string, PngResourceRef> = {}
    oralReview = []
    for (const [socketIndex, oralSocketClass] of OPEN_SOCKET_CLASSES.entries()) {
      const zoneRef = oral.socketRegistry[oralSocketClass]?.authoringZone
      if (zoneRef === undefined) throw new Error(`Missing oral projection zone ${oralSocketClass}`)
      const zone = await alphaMask(bytesFor(family, zoneRef))
      const socketOrdinal = ordinal * OPEN_SOCKET_CLASSES.length + socketIndex
      const socketColor = rgba(ordinal + socketIndex * 4 + 2, familyIndex)
      const layerPixels = paint(zone, socketColor, socketOrdinal, (ordinal + socketIndex) % 2 ? 'dots' : 'bands', 255)
      const layer = await addPng(layerPixels)
      oralProjections[oralSocketClass] = layer
      const mouthBack = paint(zone, [61, 25, 42], socketOrdinal, 'solid', 255)
      const mouthFront = paint(mouthZone, [226, 132, 151], socketOrdinal, 'edge', 150)
      let socketPreview = sourceOver(sourceOver(sourceOver(family.master, mouthBack), layerPixels), mouthFront)
      socketPreview = replay(socketPreview, family.master, replayZone)
      const socketPreviewBytes = await encodeRgba(socketPreview)
      const socketPreviewRef = await pngRef(socketPreviewBytes)
      ownedResources.set(socketPreviewRef.resourceId, { ref: socketPreviewRef, bytes: socketPreviewBytes })
      oralReview.push({ oralSocketClass, runtimeProjection: layer, fullContextPreview: socketPreviewRef })
      if (socketIndex === 0) preview = socketPreview
    }
    bundle = { ...common, kind: 'oralDetail', oralSocketClasses: [...OPEN_SOCKET_CLASSES], resources: { oralProjections } }
  } else if (definition.slotId === 'headAppendage' || definition.slotId === 'extraAppendage') {
    const slot = family.template.slots.attachment.find(item => item.slotId === definition.slotId)
    if (slot === undefined || definition.shapeClass === undefined) throw new Error(`Missing attachment interface ${definition.slotId}`)
    const iface = slot.attachmentInterface
    const allowed = await alphaMask(bytesFor(family, iface.allowedZone))
    const rearRoot = await alphaMask(bytesFor(family, iface.rearRootStencil))
    const behindPixels = paintAttachmentSilhouette(allowed, rearRoot, definition.shapeClass, ordinal, color, 'behind', definition.rarity === 'legendary' ? 255 : 225)
    const attachmentBehind = await addPng(behindPixels)
    let frontPixels: Buffer | undefined, attachmentFront: PngResourceRef | undefined
    if (iface.frontRootStencil !== undefined) {
      const frontRoot = await alphaMask(bytesFor(family, iface.frontRootStencil))
      frontPixels = paintAttachmentSilhouette(allowed, frontRoot, definition.shapeClass, ordinal, rgba(ordinal + 5, familyIndex), 'front', 150)
      attachmentFront = await addPng(frontPixels)
    }
    preview = sourceOver(transparent(), behindPixels)
    preview = sourceOver(preview, family.master)
    if (frontPixels !== undefined) preview = sourceOver(preview, frontPixels)
    const occluder = family.family.fixedOccluderMasks[iface.fixedOccluderMaskId]
    if (occluder === undefined) throw new Error(`Missing fixed attachment occluder ${iface.fixedOccluderMaskId}`)
    preview = replay(preview, family.master, await alphaMask(bytesFor(family, occluder)))
    const occluderPixels = await alphaMask(bytesFor(family, occluder))
    const diagnosticBytes = await encodeRgba(diagnosticOverlay(preview, allowed, rearRoot,
      iface.frontRootStencil === undefined ? undefined : await alphaMask(bytesFor(family, iface.frontRootStencil)), occluderPixels))
    const diagnosticPreview = await pngRef(diagnosticBytes)
    ownedResources.set(diagnosticPreview.resourceId, { ref: diagnosticPreview, bytes: diagnosticBytes })
    attachmentReview = {
      allowedZone: iface.allowedZone, rearRootStencil: iface.rearRootStencil,
      ...(iface.frontRootStencil === undefined ? {} : { frontRootStencil: iface.frontRootStencil }),
      fixedOccluderMask: occluder, diagnosticPreview,
    }
    bundle = { ...common, kind: 'attachment', interfaceId: iface.interfaceId, shapeClass: definition.shapeClass, resources: { attachmentBehind, ...(attachmentFront === undefined ? {} : { attachmentFront }) } }
  } else {
    const wanted = definition.effectMode ?? 'targeted'
    const slot = family.template.slots.effect.find(item => wanted === 'targeted' ? item.kind === 'targetedEffect' : item.kind === 'ambientEffect' && item.zoneId === wanted)
    if (slot === undefined) throw new Error(`Missing effect zone ${wanted}`)
    const zone = await alphaMask(bytesFor(family, slot.authoringZone))
    const layerPixels = paint(zone, color, ordinal, wanted === 'targeted' ? 'edge' : 'dots', definition.rarity === 'legendary' ? 210 : 145)
    const effectLayer = await addPng(layerPixels)
    preview = wanted === 'background' ? sourceOver(sourceOver(transparent(), layerPixels), family.master) : sourceOver(family.master, layerPixels)
    bundle = slot.kind === 'targetedEffect'
      ? { ...common, kind: 'targetedEffect', targetId: slot.targetId, resources: { effectLayer } }
      : { ...common, kind: 'ambientEffect', zoneId: slot.zoneId, resources: { effectLayer } }
  }

  const previewBytes = await encodeRgba(preview)
  const previewRef = await pngRef(previewBytes)
  ownedResources.set(previewRef.resourceId, { ref: previewRef, bytes: previewBytes })
  const contextResources = new Map(family.resourceBytes)
  for (const { ref, bytes } of ownedResources.values()) contextResources.set(ref.resourceId, bytes)
  const context: SealContext = { family: family.family, template: family.template, assemblyTemplateSha256: family.templateSha256, resources: contextResources }
  const sealed = await sealTraitBundle({ ...bundle, fullContextPreview: previewRef } as TraitBundleV1, context)
  return { ...sealed, manifestBytes: jsonBytes(sealed.artifact), previewBytes, ownedResources, oralReview, attachmentReview }
}

function resourcePath(ref: ContentResourceRef): string { return `${ASSET_ROOT}/${ref.sha256}.${ref.mediaType === 'image/png' ? 'png' : 'json'}` }
async function writeProjection(workspaceRoot: string, definition: FelineTraitDefinition, family: LoadedFamily, product: ProjectionProduct): Promise<PreparedEntry> {
  for (const { ref, bytes } of product.ownedResources.values()) {
    const path = absolute(workspaceRoot, resourcePath(ref)); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes)
  }
  const manifestPath = `${SEALED_ROOT}/${family.family.skeletonFamilyId}/${definition.slotId}/${definition.rarity}/${definition.traitId}.json`
  await writeFileAfterMkdir(absolute(workspaceRoot, manifestPath), product.manifestBytes)
  const sourceProjectionPath = `${SOURCE_ROOT}/traits/${definition.slotId}/${definition.rarity}/${definition.traitId}/${family.family.skeletonFamilyId}/projection.json`
  await writeJson(absolute(workspaceRoot, sourceProjectionPath), {
    schemaVersion: 'qmonster-authored-trait-projection-v1', generationMethod: 'deterministic-full-master-zones-v1', batchOrdinal: 1,
    traitId: definition.traitId, displayName: definition.displayName, slotId: definition.slotId, rarity: definition.rarity,
    skeletonFamilyId: family.family.skeletonFamilyId, assemblyTemplateSha256: family.templateSha256,
    sealedArtifactSha256: product.artifactSha256, fullContextPreview: product.artifact.fullContextPreview,
    runtimeResources: product.artifact.runtimeResources, authoringInputs: product.artifact.authoringInputs,
    ...(product.oralReview === undefined ? {} : { oralCompatibility: product.oralReview }),
    ...(product.attachmentReview === undefined ? {} : { attachmentInterface: product.attachmentReview }),
  })
  return {
    skeletonFamilyId: family.family.skeletonFamilyId, slotId: definition.slotId, traitId: definition.traitId, displayName: definition.displayName,
    rarity: definition.rarity, sealedArtifactSha256: product.artifactSha256, sealedManifestPath: manifestPath, sourceProjectionPath,
    fullContextPreview: product.artifact.fullContextPreview, assemblyTemplateSha256: family.templateSha256, kind: product.artifact.kind,
    ...('interfaceId' in product.artifact ? { interfaceId: product.artifact.interfaceId, shapeClass: product.artifact.shapeClass } : {}),
    ...('oralSocketClass' in product.artifact ? { oralSocketClass: product.artifact.oralSocketClass } : {}),
    ...(product.oralReview === undefined ? {} : { oralCompatibility: product.oralReview }),
    ...(product.attachmentReview === undefined ? {} : { attachmentInterface: product.attachmentReview }),
  }
}

async function writeFileAfterMkdir(path: string, bytes: Uint8Array): Promise<void> { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) }

const GLYPHS: Record<string, string> = {
  A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/10101/01010',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',
  '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110','2':'01110/10001/00001/00010/00100/01000/11111','3':'11110/00001/00001/01110/00001/00001/11110','4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110','6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000','8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110',
  '-':'00000/00000/00000/11111/00000/00000/00000',' ':'00000/00000/00000/00000/00000/00000/00000','/':'00001/00010/00010/00100/01000/01000/10000',':':'00000/00100/00100/00000/00100/00100/00000','.':'00000/00000/00000/00000/00000/00110/00110','=':'00000/00000/11111/00000/11111/00000/00000',
}

function drawText(canvas: Buffer, width: number, height: number, x: number, y: number, value: string, scale = 1, rgb: [number, number, number] = [24, 35, 49]): void {
  for (const [index, char] of [...value.toUpperCase()].entries()) {
    const glyph = GLYPHS[char] ?? GLYPHS[' ']!
    for (const [gy, row] of glyph.split('/').entries()) for (const [gx, on] of [...row].entries()) if (on === '1') {
      for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) {
        const px = x + index * 6 * scale + gx * scale + dx, py = y + gy * scale + dy
        if (px < 0 || py < 0 || px >= width || py >= height) continue
        const offset = (py * width + px) * 4; canvas[offset] = rgb[0]; canvas[offset + 1] = rgb[1]; canvas[offset + 2] = rgb[2]; canvas[offset + 3] = 255
      }
    }
  }
}

async function buildReport(workspaceRoot: string, entries: PreparedEntry[]): Promise<{ bytes: Buffer; sha256: string; width: number; height: number; panels: unknown[] }> {
  const width = 4096, cellWidth = 282, tile = 232, rowHeight = 286, left = 384, top = 150, familyGap = 110
  const familyHeight = V09_TRAIT_SLOT_IDS.length * rowHeight + 92
  const height = top + FAMILY_IDS.length * familyHeight + familyGap + 30
  const canvas = Buffer.alloc(width * height * 4)
  for (let i = 0; i < canvas.length; i += 4) canvas.set([242, 245, 249, 255], i)
  drawText(canvas, width, height, 24, 22, 'QMONSTER V0.9 TRAIT CATALOG / ONE SEALED BATCH / PENDING OWNER APPROVAL', 3)
  drawText(canvas, width, height, 24, 58, '312 FULL CONTEXT PROJECTIONS / 12 SLOTS / 8 COMMON + 4 RARE + 1 LEGENDARY / NO RESAMPLING', 2)
  drawText(canvas, width, height, left, 95, 'COMMON', 2, [46, 137, 91]); drawText(canvas, width, height, left + 8 * cellWidth, 95, 'RARE', 2, [55, 99, 184]); drawText(canvas, width, height, left + 12 * cellWidth, 95, 'LEGENDARY', 2, [173, 104, 26])
  const panels: unknown[] = []
  for (const [familyIndex, skeletonFamilyId] of FAMILY_IDS.entries()) {
    const familyTop = top + familyIndex * familyHeight
    drawText(canvas, width, height, 24, familyTop, skeletonFamilyId, 3)
    drawText(canvas, width, height, 24, familyTop + 30, 'REVISED TEMPLATE REGISTRY: ORAL-NONE / OPEN / NARROW / WIDE', 2)
    for (const [slotIndex, slotId] of V09_TRAIT_SLOT_IDS.entries()) {
      const y = familyTop + 68 + slotIndex * rowHeight
      drawText(canvas, width, height, 24, y + 12, slotId, 2)
      const row = entries.filter(entry => entry.skeletonFamilyId === skeletonFamilyId && entry.slotId === slotId)
      if (row.length !== 13) throw new Error(`Report row ${skeletonFamilyId}/${slotId} has ${row.length} entries`)
      for (const [column, entry] of row.entries()) {
        const x = left + column * cellWidth
        const previewPath = absolute(workspaceRoot, resourcePath(entry.fullContextPreview))
        const resized = await sharp(await readFile(previewPath)).resize(tile, tile, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).raw().toBuffer()
        for (let py = 0; py < tile; py += 1) resized.copy(canvas, ((y + py) * width + x) * 4, py * tile * 4, (py + 1) * tile * 4)
        const rarityColor: [number, number, number] = entry.rarity === 'common' ? [46, 137, 91] : entry.rarity === 'rare' ? [55, 99, 184] : [173, 104, 26]
        for (let py = 0; py < 5; py += 1) for (let px = 0; px < tile; px += 1) canvas.set([...rarityColor, 255], ((y + py) * width + x + px) * 4)
        drawText(canvas, width, height, x, y + tile + 7, entry.traitId.slice(0, 38), 1)
        drawText(canvas, width, height, x, y + tile + 18, `${entry.rarity} / ${entry.kind}`, 1, rarityColor)
        panels.push({ skeletonFamilyId, slotId, traitId: entry.traitId, rarity: entry.rarity, fullContextPreview: entry.fullContextPreview, x, y, width: tile, height: tile })
      }
    }
  }
  const bytes = await encodeRgba(canvas, width, height)
  return { bytes, sha256: rawReportSha256(canvas, width, height), width, height, panels }
}

type ReviewPanel = Record<string, unknown> & { fullContextPreview?: PngResourceRef; diagnosticPreview?: PngResourceRef }
async function buildDiagnosticReport(
  workspaceRoot: string,
  title: string,
  subtitle: string,
  panels: ReviewPanel[],
  imageKey: 'fullContextPreview' | 'diagnosticPreview',
): Promise<{ bytes: Buffer; sha256: string; width: number; height: number; panels: number }> {
  const tile = 512, cellWidth = 580, rowHeight = 570, columns = 4, left = 24, top = 120
  const width = left * 2 + columns * cellWidth
  const height = top + Math.ceil(panels.length / columns) * rowHeight + 24
  const canvas = Buffer.alloc(width * height * 4)
  for (let i = 0; i < canvas.length; i += 4) canvas.set([242, 245, 249, 255], i)
  drawText(canvas, width, height, 24, 20, title, 3)
  drawText(canvas, width, height, 24, 58, subtitle, 2)
  for (const [index, panel] of panels.entries()) {
    const ref = panel[imageKey] as PngResourceRef
    const x = left + index % columns * cellWidth, y = top + Math.floor(index / columns) * rowHeight
    const resized = await sharp(await readFile(absolute(workspaceRoot, resourcePath(ref)))).resize(tile, tile, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).raw().toBuffer()
    for (let py = 0; py < tile; py += 1) resized.copy(canvas, ((y + py) * width + x) * 4, py * tile * 4, (py + 1) * tile * 4)
    drawText(canvas, width, height, x, y + tile + 8, String(panel.traitId).slice(0, 45), 1)
    drawText(canvas, width, height, x, y + tile + 20, `${String(panel.skeletonFamilyId)} / ${String(panel.oralSocketClass ?? panel.interfaceId)}`.slice(0, 70), 1)
  }
  const bytes = await encodeRgba(canvas, width, height)
  return { bytes, sha256: rawReportSha256(canvas, width, height), width, height, panels: panels.length }
}

async function archiveRevisionTwo(workspaceRoot: string): Promise<void> {
  const history = absolute(workspaceRoot, `${SOURCE_ROOT}/approval-history/revision-2`)
  await mkdir(history, { recursive: true })
  try {
    const superseded = JSON.parse(await readFile(join(history, 'superseded.json'), 'utf8'))
    if (superseded.supersededRevision === 2 && superseded.nextRevision === 3) {
      await rm(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/assembly-approvals.json`), { force: true })
      await rm(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/approved-master-review.json`), { force: true })
      await writeJson(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/attachment-allowlist.json`), { schemaVersion: 'qmonster-approved-attachment-allowlist-v1', entries: [] })
      return
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const activeFiles = ['assembly-approvals.json', 'approved-master-review.json', 'attachment-allowlist.json']
  for (const name of activeFiles) {
    const source = absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/${name}`)
    try {
      const destination = join(history, name)
      const bytes = await readFile(source)
      try { if (!(await readFile(destination)).equals(bytes)) throw new Error(`Historical revision-2 file differs: ${name}`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') await copyFile(source, destination); else throw error }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const oldIndex = absolute(workspaceRoot, `${SOURCE_ROOT}/review/master-overlay-review.index.json`)
  const historyIndex = join(history, 'master-overlay-review.index.json')
  const oldIndexBytes = await readFile(oldIndex)
  try { if (!(await readFile(historyIndex)).equals(oldIndexBytes)) throw new Error('Historical revision-2 review index differs') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') await copyFile(oldIndex, historyIndex); else throw error }
  await writeJson(join(history, 'superseded.json'), {
    schemaVersion: 'qmonster-superseded-approval-v1', status: 'superseded', supersededRevision: 2, nextRevision: 3,
    reason: 'Task 8 freezes thirteen unique mouth traits; the revision-2 template registry listed only three placeholder parent mouth IDs. Revised exhaustive oral compatibility and every trait projection require one combined owner review.',
  })
  await rm(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/assembly-approvals.json`), { force: true })
  await rm(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/approved-master-review.json`), { force: true })
  await writeJson(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/attachment-allowlist.json`), { schemaVersion: 'qmonster-approved-attachment-allowlist-v1', entries: [] })
}

async function removeOwnedOutput(workspaceRoot: string, relativePath: string): Promise<void> {
  const root = resolve(workspaceRoot), target = absolute(workspaceRoot, relativePath)
  if (!contained(root, target) || target === root) throw new Error(`Refusing to remove uncontrolled output: ${target}`)
  await rm(target, { recursive: true, force: true })
}

async function filesBelow(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? filesBelow(join(root, entry.name)) : [join(root, entry.name)]))).flat().sort()
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

function expectedSocketRegistry(template: AssemblyTemplateV1) {
  const mouth = template.slots.embedded.find(item => item.kind === 'mouth')
  if (mouth?.kind !== 'mouth') throw new Error('Template lacks mouth zone')
  const oral = template.slots.embedded.find(item => item.kind === 'oralDetail')
  if (oral?.kind !== 'oralDetail') throw new Error('Template lacks oral registry')
  return {
    'oral-none': { authoringZone: mouth.authoringZone, parentMouthTraitIds: [...MOUTH_SOCKET_PARENT_TRAIT_IDS['oral-none']] },
    open: { authoringZone: oral.socketRegistry.open!.authoringZone, parentMouthTraitIds: [...MOUTH_SOCKET_PARENT_TRAIT_IDS.open] },
    narrow: { authoringZone: oral.socketRegistry.narrow!.authoringZone, parentMouthTraitIds: [...MOUTH_SOCKET_PARENT_TRAIT_IDS.narrow] },
    wide: { authoringZone: oral.socketRegistry.wide!.authoringZone, parentMouthTraitIds: [...MOUTH_SOCKET_PARENT_TRAIT_IDS.wide] },
  }
}

type ReportProduct = { bytes: Buffer; sha256: string; width: number; height: number; panels: unknown[] | number }
async function writeReportCopies(workspaceRoot: string, acceptancePath: string, report: ReportProduct) {
  const sourcePath = `${SOURCE_ROOT}/trait-review/resources/${report.sha256}.png`
  const assetPath = `${ASSET_ROOT}/${report.sha256}.png`
  for (const path of [acceptancePath, sourcePath, assetPath]) await writeFileAfterMkdir(absolute(workspaceRoot, path), report.bytes)
  return { acceptancePath, sourcePath, assetPath, sha256: report.sha256, byteSha256: byteSha256(report.bytes), width: report.width, height: report.height, panels: Array.isArray(report.panels) ? report.panels.length : report.panels }
}

function scopedGitAddPaths(entries: PreparedEntry[], reportSourcePaths: string[]): string[] {
  const history = ['assembly-approvals.json', 'approved-master-review.json', 'attachment-allowlist.json', 'master-overlay-review.index.json', 'superseded.json']
    .map(name => `${SOURCE_ROOT}/approval-history/revision-2/${name}`)
  return [...new Set([
    ...history,
    `${SOURCE_ROOT}/trait-inventory.json`, `${SOURCE_ROOT}/trait-approval-plan.json`, `${SOURCE_ROOT}/attachment-allowlist-candidate.json`,
    REPORT_INDEX_PATH, ...reportSourcePaths, ...entries.map(entry => entry.sourceProjectionPath),
  ])].sort()
}

export async function prepareFelineTraits(options: { workspaceRoot?: string; reviewRepairRound?: 1 } = {}): Promise<void> {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd())
  if (workspaceRoot !== resolve(process.cwd())) throw new Error('Task 8 production must run from the selected worktree root')
  const approvalPlanPath = absolute(workspaceRoot, `${SOURCE_ROOT}/trait-approval-plan.json`)
  let supersededClosureSha256: string | undefined
  try {
    await access(approvalPlanPath)
    if (options.reviewRepairRound !== 1) throw new Error('Task 8 batch 1 is already sealed; use --verify instead of regenerating or cherry-picking')
    const oldPlan = JSON.parse(await readFile(approvalPlanPath, 'utf8'))
    const oldApprovalFiles = await filesBelow(absolute(workspaceRoot, APPROVAL_ROOT))
    const oldAllowlist = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/attachment-allowlist.json`), 'utf8'))
    if (oldPlan.batchOrdinal !== 1 || oldPlan.status !== 'pending-owner-approval' || oldApprovalFiles.length !== 0 || oldAllowlist.entries.length !== 0) throw new Error('Review repair requires the unchanged preapproval batch-1 state')
    const oldClosureFiles = [
      ...await filesBelow(absolute(workspaceRoot, SEALED_ROOT)), ...await filesBelow(absolute(workspaceRoot, `${SOURCE_ROOT}/traits`)), ...await filesBelow(absolute(workspaceRoot, ASSET_ROOT)),
      absolute(workspaceRoot, `${SOURCE_ROOT}/trait-inventory.json`), absolute(workspaceRoot, `${SOURCE_ROOT}/attachment-allowlist-candidate.json`),
      absolute(workspaceRoot, REPORT_INDEX_PATH), absolute(workspaceRoot, REPORT_PATH),
    ].sort()
    const oldClosure = []
    for (const path of oldClosureFiles) oldClosure.push([relative(workspaceRoot, path).replaceAll('\\', '/'), byteSha256(await readFile(path))])
    supersededClosureSha256 = oldPlan.supersedesClosureSha256 ?? canonicalJsonSha256(oldClosure)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }

  const inventory = buildFelineTraitInventory()
  await writeJson(absolute(workspaceRoot, `${SOURCE_ROOT}/trait-inventory.json`), inventory)
  await archiveRevisionTwo(workspaceRoot)
  await prepareFelineMasters()
  for (const owned of [`${SOURCE_ROOT}/traits`, `${SOURCE_ROOT}/trait-review`, ASSET_ROOT, SEALED_ROOT, APPROVAL_ROOT]) await removeOwnedOutput(workspaceRoot, owned)
  for (const path of [REPORT_PATH, ORAL_REPORT_PATH, ATTACHMENT_REPORT_PATH]) await removeOwnedOutput(workspaceRoot, path)
  await mkdir(absolute(workspaceRoot, APPROVAL_ROOT), { recursive: true })

  const families: LoadedFamily[] = []
  for (const familyId of FAMILY_IDS) families.push(await loadFamily(workspaceRoot, familyId))
  const entries: PreparedEntry[] = []
  const resourcePaths: Record<string, string> = {}
  for (const [familyIndex, family] of families.entries()) {
    const oral = family.template.slots.embedded.find(item => item.kind === 'oralDetail')
    if (oral?.kind !== 'oralDetail' || canonicalJsonSha256(oral.socketRegistry) !== canonicalJsonSha256(expectedSocketRegistry(family.template))) throw new Error(`Revised oral registry did not rebuild exactly for ${family.family.skeletonFamilyId}`)
    for (const slotId of V09_TRAIT_SLOT_IDS) for (const definition of FELINE_TRAIT_DEFINITIONS[slotId]) {
      const product = await buildProjection(family, definition, familyIndex)
      const entry = await writeProjection(workspaceRoot, definition, family, product)
      entries.push(entry)
      for (const { ref } of product.ownedResources.values()) resourcePaths[ref.resourceId] = resourcePath(ref)
    }
  }
  if (entries.length !== 312) throw new Error(`Expected 312 sealed projections, built ${entries.length}`)

  const report = await buildReport(workspaceRoot, entries)
  const oralCompatibilityPanels = entries.filter(entry => entry.kind === 'oralDetail').flatMap(entry => (entry.oralCompatibility ?? []).map(item => ({
    skeletonFamilyId: entry.skeletonFamilyId, traitId: entry.traitId, rarity: entry.rarity,
    oralSocketClass: item.oralSocketClass, runtimeProjection: item.runtimeProjection, fullContextPreview: item.fullContextPreview,
  })))
  const attachmentInterfacePanels = entries.filter(entry => entry.kind === 'attachment').map(entry => ({
    skeletonFamilyId: entry.skeletonFamilyId, traitId: entry.traitId, rarity: entry.rarity, interfaceId: entry.interfaceId,
    shapeClass: entry.shapeClass, ...entry.attachmentInterface,
  }))
  const oralReport = await buildDiagnosticReport(workspaceRoot, 'ORAL COMPATIBILITY / ALL OPEN SOCKETS', '78 PANELS / OPEN + NARROW + WIDE / RUNTIME REF BOUND', oralCompatibilityPanels, 'fullContextPreview')
  const attachmentReport = await buildDiagnosticReport(workspaceRoot, 'ATTACHMENT ROOT AND INTERFACE AUDIT', '52 PANELS / YELLOW ZONE / MAGENTA REAR ROOT / CYAN FRONT ROOT / WHITE OCCLUDER', attachmentInterfacePanels, 'diagnosticPreview')
  const reportDescriptor = await writeReportCopies(workspaceRoot, REPORT_PATH, report)
  const oralReportDescriptor = await writeReportCopies(workspaceRoot, ORAL_REPORT_PATH, oralReport)
  const attachmentReportDescriptor = await writeReportCopies(workspaceRoot, ATTACHMENT_REPORT_PATH, attachmentReport)
  for (const descriptor of [reportDescriptor, oralReportDescriptor, attachmentReportDescriptor]) resourcePaths[`sha256:${descriptor.sha256}`] = descriptor.assetPath
  const attachmentCandidates = entries.filter(entry => entry.kind === 'attachment').map(entry => ({
    skeletonFamilyId: entry.skeletonFamilyId, interfaceId: entry.interfaceId!, shapeClass: entry.shapeClass!, sealedArtifactSha256: entry.sealedArtifactSha256,
  }))
  const attachmentAllowlistCandidate = { schemaVersion: 'qmonster-pending-attachment-allowlist-v1', status: 'pending-owner-approval', entries: attachmentCandidates }
  await writeJson(absolute(workspaceRoot, `${SOURCE_ROOT}/attachment-allowlist-candidate.json`), attachmentAllowlistCandidate)
  const revisedTemplates = families.map(family => {
    const policy = JSON.parse(Buffer.from(bytesFor(family, family.overlayPolicy)).toString('utf8'))
    return {
      skeletonFamilyId: family.family.skeletonFamilyId, assemblyTemplateId: family.template.assemblyTemplateId,
      assemblyTemplateSha256: family.templateSha256, neutralMasterSha256: family.family.neutralMaster.sha256,
      materialMapSha256: family.family.materialMap.sha256, fixedOccluderMasksSha256: canonicalJsonSha256(family.family.fixedOccluderMasks),
      compositionGraphSha256: canonicalJsonSha256(family.template.compositionGraph), overlayPolicySha256: canonicalJsonSha256(policy),
      oralSocketRegistry: expectedSocketRegistry(family.template), approvalRevisionRequired: 3,
    }
  })
  const reportIndex = {
    schemaVersion: 'qmonster-trait-catalog-review-index-v1', status: 'pending-owner-approval', batchOrdinal: 1,
    generationMethod: 'deterministic-full-master-zones-v1', inventorySha256: canonicalJsonSha256(inventory),
    report: reportDescriptor,
    diagnosticReports: { oralCompatibility: oralReportDescriptor, attachmentInterfaces: attachmentReportDescriptor },
    panels: report.panels, oralCompatibilityPanels, attachmentInterfacePanels, revisedTemplates, entries,
  }
  await writeJson(absolute(workspaceRoot, REPORT_INDEX_PATH), reportIndex)
  const approvalPlan = {
    schemaVersion: 'qmonster-trait-approval-plan-v1', status: 'pending-owner-approval', batchOrdinal: 1,
    generationMethod: 'deterministic-full-master-zones-v1', mediaApiCalls: 0, subjectiveRegenerations: 0,
    semanticTraitCount: 156, sealedProjectionCount: 312, skeletonFamilyCount: 2, revisedAssemblyApprovalRevision: 3,
    inventorySha256: canonicalJsonSha256(inventory), reportIndexSha256: canonicalJsonSha256(reportIndex),
    report: reportIndex.report, diagnosticReports: reportIndex.diagnosticReports, revisedTemplates, attachmentAllowlistCandidateSha256: canonicalJsonSha256(attachmentAllowlistCandidate),
    resourcePaths: Object.fromEntries(Object.entries(resourcePaths).sort(([a], [b]) => a.localeCompare(b))), entries,
    reviewRound: options.reviewRepairRound ?? 0, ...(supersededClosureSha256 === undefined ? {} : { supersedesClosureSha256: supersededClosureSha256 }),
    scopedGitAddPaths: scopedGitAddPaths(entries, [reportDescriptor.sourcePath, oralReportDescriptor.sourcePath, attachmentReportDescriptor.sourcePath]),
  }
  await writeJson(approvalPlanPath, approvalPlan)
  const result = await validatePreparedFelineTraits({ workspaceRoot, deterministicRebuild: false })
  if (result.failures.length) throw new Error(result.failures.join('\n'))
}

export async function approvePreparedFelineTraits(input: { approvedAt: string; workspaceRoot?: string }): Promise<void> {
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd())
  if (workspaceRoot !== resolve(process.cwd())) throw new Error('Task 8 approval must run from the selected worktree root')
  const preflight = await validatePreparedFelineTraits({ workspaceRoot, deterministicRebuild: false })
  if (preflight.failures.length || preflight.activeTraitApprovals !== 0 || preflight.activeAttachmentAllowlistEntries !== 0) throw new Error(`Task 8 approval requires the exact clean preapproval closure:\n${preflight.failures.join('\n')}`)
  const plan = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/trait-approval-plan.json`), 'utf8'))
  const index = JSON.parse(await readFile(absolute(workspaceRoot, REPORT_INDEX_PATH), 'utf8'))
  const candidates = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/attachment-allowlist-candidate.json`), 'utf8'))
  const approvalByArtifact = new Map<string, { approval: TraitVisualApprovalV1; sha256: string }>()
  for (const entry of plan.entries as PreparedEntry[]) {
    const previewBytes = await readFile(absolute(workspaceRoot, resourcePath(entry.fullContextPreview)))
    const result = await createTraitVisualApproval({
      skeletonFamilyId: entry.skeletonFamilyId, assemblyTemplateSha256: entry.assemblyTemplateSha256,
      sealedArtifactSha256: entry.sealedArtifactSha256, fullContextPreview: entry.fullContextPreview, fullContextPreviewBytes: previewBytes,
      approvedBy: 'project-owner', approvedAt: input.approvedAt, approvalRevision: 1, status: 'approved',
    })
    approvalByArtifact.set(`${entry.skeletonFamilyId}:${entry.sealedArtifactSha256}`, { approval: result.approval, sha256: result.approvalSha256 })
    await writeJson(absolute(workspaceRoot, `${APPROVAL_ROOT}/${entry.skeletonFamilyId}/${entry.slotId}/${entry.rarity}/${entry.traitId}.json`), result.approval)
  }
  const allowlist: ApprovedAttachmentAllowlistV1 = {
    schemaVersion: 'qmonster-approved-attachment-allowlist-v1',
    entries: candidates.entries.map((candidate: { skeletonFamilyId: string; interfaceId: string; shapeClass: AttachmentShapeClass; sealedArtifactSha256: string }) => {
      const approval = approvalByArtifact.get(`${candidate.skeletonFamilyId}:${candidate.sealedArtifactSha256}`)
      if (approval === undefined) throw new Error(`Attachment candidate lacks exact trait approval: ${candidate.sealedArtifactSha256}`)
      return { ...candidate, traitVisualApprovalSha256: approval.sha256 }
    }),
  }
  await writeJson(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/attachment-allowlist.json`), allowlist)
  const combinedTraitReview: CombinedTraitReview = {
    reportSha256: index.report.sha256, reviewIndexSha256: canonicalJsonSha256(index), approvalPlanSha256: canonicalJsonSha256(plan),
  }
  const masterIndex = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/review/master-overlay-review.index.json`), 'utf8'))
  await approveFelineMasters({ reportSha256: masterIndex.report.sha256, approvedAt: input.approvedAt, approvalRevision: 3, combinedTraitReview })
  const postflight = await validatePreparedFelineTraits({ workspaceRoot, deterministicRebuild: false })
  if (postflight.failures.length || postflight.activeTraitApprovals !== 312 || postflight.activeAttachmentAllowlistEntries !== 52) throw new Error(`Task 8 postapproval validation failed:\n${postflight.failures.join('\n')}`)
}

export type PreparedTraitSummary = {
  semanticTraits: number
  sealedProjections: number
  skeletonFamilies: number
  activeTraitApprovals: number
  activeAttachmentAllowlistEntries: number
  batchOrdinal: number
  closureSha256: string
  reportSha256: string
  failures: string[]
}

export async function validatePreparedFelineTraits(options: { workspaceRoot?: string; deterministicRebuild?: boolean } = {}): Promise<PreparedTraitSummary> {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd()), failures: string[] = []
  const check = (condition: unknown, message: string) => { if (!condition) failures.push(message) }
  const inventory = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/trait-inventory.json`), 'utf8'))
  check(canonicalJsonSha256(inventory) === canonicalJsonSha256(buildFelineTraitInventory()), 'Semantic inventory differs from the frozen 156-trait definition')
  const plan = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/trait-approval-plan.json`), 'utf8'))
  const index = JSON.parse(await readFile(absolute(workspaceRoot, REPORT_INDEX_PATH), 'utf8'))
  check(plan.status === 'pending-owner-approval' && plan.batchOrdinal === 1, 'Approval plan is not the single pending batch')
  check(plan.entries.length === 312 && index.entries.length === 312 && index.panels.length === 312, 'Approval/report closure does not enumerate all 312 projections')
  check(index.oralCompatibilityPanels?.length === 78, 'Oral compatibility review does not enumerate all 78 family/socket projections')
  check(index.attachmentInterfacePanels?.length === 52, 'Attachment interface review does not enumerate all 52 family projections')
  check(plan.reportIndexSha256 === canonicalJsonSha256(index), 'Approval plan does not bind the exact report index')
  const approvalFiles = await filesBelow(absolute(workspaceRoot, APPROVAL_ROOT))
  const isApproved = approvalFiles.length === 312
  check(approvalFiles.length === 0 || isApproved, 'Active TraitVisualApprovalV1 records are partial')
  let hasAssemblyApprovals = false
  try { await access(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/assembly-approvals.json`)); hasAssemblyApprovals = true }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  check(hasAssemblyApprovals === isApproved, isApproved ? 'Revision-3 assembly approvals are absent after combined owner review' : 'Revision-3 assembly approvals exist before combined owner review')
  const allowlist = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/attachment-allowlist.json`), 'utf8'))
  check(allowlist.schemaVersion === 'qmonster-approved-attachment-allowlist-v1' && allowlist.entries.length === (isApproved ? 52 : 0), 'Active attachment allowlist does not match approval state')
  const approvalByArtifact = new Map<string, { approval: TraitVisualApprovalV1; sha256: string }>()
  if (isApproved) {
    const expectedApprovalPaths = new Set((plan.entries as PreparedEntry[]).map(entry => absolute(workspaceRoot, `${APPROVAL_ROOT}/${entry.skeletonFamilyId}/${entry.slotId}/${entry.rarity}/${entry.traitId}.json`)))
    check(approvalFiles.every(path => expectedApprovalPaths.has(path)), 'Trait approval root has an orphan path')
    for (const entry of plan.entries as PreparedEntry[]) {
      const path = absolute(workspaceRoot, `${APPROVAL_ROOT}/${entry.skeletonFamilyId}/${entry.slotId}/${entry.rarity}/${entry.traitId}.json`)
      const approval = JSON.parse(await readFile(path, 'utf8')) as TraitVisualApprovalV1
      const previewBytes = await readFile(absolute(workspaceRoot, resourcePath(entry.fullContextPreview)))
      const expected = await createTraitVisualApproval({ skeletonFamilyId: entry.skeletonFamilyId, assemblyTemplateSha256: entry.assemblyTemplateSha256,
        sealedArtifactSha256: entry.sealedArtifactSha256, fullContextPreview: entry.fullContextPreview, fullContextPreviewBytes: previewBytes,
        approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, approvalRevision: approval.approvalRevision, status: approval.status })
      check(approval.approvedBy === 'project-owner' && approval.approvalRevision === 1 && approval.status === 'approved'
        && canonicalJsonSha256(approval) === expected.approvalSha256, `${entry.skeletonFamilyId}/${entry.slotId}/${entry.traitId}: trait approval binding differs`)
      approvalByArtifact.set(`${entry.skeletonFamilyId}:${entry.sealedArtifactSha256}`, { approval, sha256: expected.approvalSha256 })
    }
    const candidates = JSON.parse(await readFile(absolute(workspaceRoot, `${SOURCE_ROOT}/attachment-allowlist-candidate.json`), 'utf8'))
    const expectedAllowlist = candidates.entries.map((candidate: { skeletonFamilyId: string; interfaceId: string; shapeClass: AttachmentShapeClass; sealedArtifactSha256: string }) => ({
      ...candidate, traitVisualApprovalSha256: approvalByArtifact.get(`${candidate.skeletonFamilyId}:${candidate.sealedArtifactSha256}`)?.sha256,
    }))
    check(canonicalJsonSha256(allowlist.entries) === canonicalJsonSha256(expectedAllowlist), 'Active attachment allowlist differs from the exact approved candidates')
    const masterErrors = await validateFelineMasters({ requireApproval: true })
    check(masterErrors.length === 0, `Revision-3 master approval validation failed: ${masterErrors.join('; ')}`)
  }

  const families: LoadedFamily[] = []
  for (const familyId of FAMILY_IDS) families.push(await loadFamily(workspaceRoot, familyId))
  for (const family of families) {
    const oral = family.template.slots.embedded.find(item => item.kind === 'oralDetail')
    check(oral?.kind === 'oralDetail' && canonicalJsonSha256(oral.socketRegistry) === canonicalJsonSha256(expectedSocketRegistry(family.template)), `${family.family.skeletonFamilyId}: oral registry is not exhaustive`)
  }

  const expectedManifestPaths = new Set<string>(), expectedSourcePaths = new Set<string>(), expectedAssetPaths = new Set<string>()
  const rebuiltEntries: PreparedEntry[] = []
  for (const [familyIndex, family] of families.entries()) for (const slotId of V09_TRAIT_SLOT_IDS) for (const definition of FELINE_TRAIT_DEFINITIONS[slotId]) {
    const manifestPath = `${SEALED_ROOT}/${family.family.skeletonFamilyId}/${definition.slotId}/${definition.rarity}/${definition.traitId}.json`
    const sourcePath = `${SOURCE_ROOT}/traits/${definition.slotId}/${definition.rarity}/${definition.traitId}/${family.family.skeletonFamilyId}/projection.json`
    expectedManifestPaths.add(absolute(workspaceRoot, manifestPath)); expectedSourcePaths.add(absolute(workspaceRoot, sourcePath))
    const artifact = JSON.parse(await readFile(absolute(workspaceRoot, manifestPath), 'utf8')) as SealedTraitArtifactV1
    const artifactHash = canonicalJsonSha256(artifact)
    const entry = plan.entries.find((item: PreparedEntry) => item.skeletonFamilyId === family.family.skeletonFamilyId && item.slotId === slotId && item.traitId === definition.traitId)
    check(entry?.sealedArtifactSha256 === artifactHash, `${family.family.skeletonFamilyId}/${slotId}/${definition.traitId}: manifest hash differs from approval plan`)
    check(artifact.authoringInputs.filter(ref => ref.resourceId === family.overlayPolicy.resourceId).length === 1, `${family.family.skeletonFamilyId}/${slotId}/${definition.traitId}: overlay policy binding is absent or duplicated`)
    check(!/"(?:anchor|transform|crop|zIndex|path|url)"\s*:/i.test(JSON.stringify(artifact)), `${family.family.skeletonFamilyId}/${slotId}/${definition.traitId}: forbidden placement field found`)
    if (artifact.kind === 'oralDetail') {
      check(JSON.stringify(Object.keys(artifact.runtimeResources.oralProjections).sort()) === JSON.stringify([...OPEN_SOCKET_CLASSES].sort()), `${family.family.skeletonFamilyId}/oralDetail/${definition.traitId}: runtime oral mappings are incomplete`)
    }
    for (const path of Object.values(plan.resourcePaths) as string[]) expectedAssetPaths.add(absolute(workspaceRoot, path))
    if (options.deterministicRebuild) {
      const product = await buildProjection(family, definition, familyIndex)
      check(product.artifactSha256 === artifactHash, `${family.family.skeletonFamilyId}/${slotId}/${definition.traitId}: deterministic artifact rebuild differs`)
      check((await readFile(absolute(workspaceRoot, resourcePath(product.artifact.fullContextPreview)))).equals(product.previewBytes), `${family.family.skeletonFamilyId}/${slotId}/${definition.traitId}: deterministic preview PNG rebuild differs`)
      for (const { ref, bytes } of product.ownedResources.values()) check((await readFile(absolute(workspaceRoot, resourcePath(ref)))).equals(bytes), `${family.family.skeletonFamilyId}/${slotId}/${definition.traitId}: resource rebuild differs for ${ref.resourceId}`)
    }
    rebuiltEntries.push(entry)
  }
  const actualManifests = new Set(await filesBelow(absolute(workspaceRoot, SEALED_ROOT)))
  const actualSources = new Set(await filesBelow(absolute(workspaceRoot, `${SOURCE_ROOT}/traits`)))
  const actualAssets = new Set(await filesBelow(absolute(workspaceRoot, ASSET_ROOT)))
  check(actualManifests.size === 312 && [...actualManifests].every(path => expectedManifestPaths.has(path)), 'Sealed manifest root has missing or orphan files')
  check(actualSources.size === 312 && [...actualSources].every(path => expectedSourcePaths.has(path)), 'Authored projection root has missing or orphan files')
  check(actualAssets.size === expectedAssetPaths.size && [...actualAssets].every(path => expectedAssetPaths.has(path)), 'Content-addressed asset root has missing or orphan files')
  for (const [resourceId, path] of Object.entries(plan.resourcePaths) as Array<[string, string]>) {
    const bytes = await readFile(absolute(workspaceRoot, path)), digest = resourceId.slice('sha256:'.length)
    const reportDescriptor = [plan.report, plan.diagnosticReports?.oralCompatibility, plan.diagnosticReports?.attachmentInterfaces]
      .find(item => item?.assetPath === path)
    const actual = reportDescriptor !== undefined
      ? await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(raw => rawReportSha256(raw.data, raw.info.width, raw.info.height))
      : path.endsWith('.png') ? await decodedPngSha256(bytes) : canonicalJsonSha256(JSON.parse(bytes.toString('utf8')))
    check(actual === digest, `Resource hash mismatch: ${resourceId}`)
  }
  const reportBytes = await readFile(absolute(workspaceRoot, REPORT_PATH))
  const reportRaw = await sharp(reportBytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const reportSha256 = rawReportSha256(reportRaw.data, reportRaw.info.width, reportRaw.info.height)
  check(reportSha256 === plan.report.sha256 && byteSha256(reportBytes) === plan.report.byteSha256, 'Bulk report identity differs from the approval plan')
  const reportDescriptors = [plan.report, plan.diagnosticReports?.oralCompatibility, plan.diagnosticReports?.attachmentInterfaces].filter(Boolean)
  for (const descriptor of reportDescriptors) {
    for (const path of [descriptor.acceptancePath, descriptor.sourcePath, descriptor.assetPath]) {
      try {
        const bytes = await readFile(absolute(workspaceRoot, path))
        check(await reportCopyMatches(bytes, descriptor), `Report copy is missing or tampered: ${path}`)
      } catch { check(false, `Report copy is missing or tampered: ${path}`) }
    }
  }
  if (options.deterministicRebuild) {
    const rebuiltReport = await buildReport(workspaceRoot, rebuiltEntries)
    check(rebuiltReport.bytes.equals(reportBytes) && rebuiltReport.sha256 === reportSha256, 'Deterministic bulk report rebuild differs byte-for-byte')
    const oralPanels = rebuiltEntries.filter(entry => entry.kind === 'oralDetail').flatMap(entry => (entry.oralCompatibility ?? []).map(item => ({ skeletonFamilyId: entry.skeletonFamilyId, traitId: entry.traitId, rarity: entry.rarity, oralSocketClass: item.oralSocketClass, runtimeProjection: item.runtimeProjection, fullContextPreview: item.fullContextPreview })))
    const attachmentPanels = rebuiltEntries.filter(entry => entry.kind === 'attachment').map(entry => ({ skeletonFamilyId: entry.skeletonFamilyId, traitId: entry.traitId, rarity: entry.rarity, interfaceId: entry.interfaceId, shapeClass: entry.shapeClass, ...entry.attachmentInterface }))
    const rebuiltOral = await buildDiagnosticReport(workspaceRoot, 'ORAL COMPATIBILITY / ALL OPEN SOCKETS', '78 PANELS / OPEN + NARROW + WIDE / RUNTIME REF BOUND', oralPanels, 'fullContextPreview')
    const rebuiltAttachment = await buildDiagnosticReport(workspaceRoot, 'ATTACHMENT ROOT AND INTERFACE AUDIT', '52 PANELS / YELLOW ZONE / MAGENTA REAR ROOT / CYAN FRONT ROOT / WHITE OCCLUDER', attachmentPanels, 'diagnosticPreview')
    check(rebuiltOral.sha256 === plan.diagnosticReports.oralCompatibility.sha256 && byteSha256(rebuiltOral.bytes) === plan.diagnosticReports.oralCompatibility.byteSha256, 'Deterministic oral diagnostic report rebuild differs byte-for-byte')
    check(rebuiltAttachment.sha256 === plan.diagnosticReports.attachmentInterfaces.sha256 && byteSha256(rebuiltAttachment.bytes) === plan.diagnosticReports.attachmentInterfaces.byteSha256, 'Deterministic attachment diagnostic report rebuild differs byte-for-byte')
  }
  const expectedScopedPaths = scopedGitAddPaths(rebuiltEntries, reportDescriptors.map(item => item.sourcePath))
  check(JSON.stringify(plan.scopedGitAddPaths) === JSON.stringify(expectedScopedPaths), 'Scoped ignored-source git add closure is not exact')
  const approvalClosureFiles = isApproved ? [
    ...approvalFiles,
    absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/attachment-allowlist.json`),
    absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/assembly-approvals.json`),
    absolute(workspaceRoot, `${SOURCE_ROOT}/approvals/approved-master-review.json`),
    ...(plan.scopedGitAddPaths as string[]).map(path => absolute(workspaceRoot, path)),
  ] : []
  const closureFiles = [...new Set([...actualManifests, ...actualSources, ...actualAssets, absolute(workspaceRoot, `${SOURCE_ROOT}/trait-inventory.json`), absolute(workspaceRoot, `${SOURCE_ROOT}/attachment-allowlist-candidate.json`), absolute(workspaceRoot, REPORT_INDEX_PATH), ...reportDescriptors.flatMap(item => [absolute(workspaceRoot, item.sourcePath), absolute(workspaceRoot, item.acceptancePath)]), ...approvalClosureFiles])].sort()
  const closure = []
  for (const path of closureFiles) closure.push([relative(workspaceRoot, path).replaceAll('\\', '/'), byteSha256(await readFile(path))])
  return {
    semanticTraits: inventory.traits.length, sealedProjections: actualManifests.size, skeletonFamilies: families.length,
    activeTraitApprovals: approvalFiles.length, activeAttachmentAllowlistEntries: allowlist.entries.length, batchOrdinal: plan.batchOrdinal,
    closureSha256: canonicalJsonSha256(closure), reportSha256, failures,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const approvalFlag = process.argv.indexOf('--approve-at')
  if (approvalFlag !== -1) {
    const approvedAt = process.argv[approvalFlag + 1]
    if (approvedAt === undefined || approvedAt.startsWith('--')) throw new Error('--approve-at requires the exact owner approval UTC instant')
    await approvePreparedFelineTraits({ approvedAt })
    const result = await validatePreparedFelineTraits()
    console.log(`APPROVED: ${result.activeTraitApprovals} trait projections, ${result.activeAttachmentAllowlistEntries} attachment entries, closure ${result.closureSha256}`)
  } else if (process.argv.includes('--verify')) {
    const result = await validatePreparedFelineTraits({ deterministicRebuild: process.argv.includes('--deterministic-rebuild') })
    if (result.failures.length) { console.error(result.failures.join('\n')); process.exitCode = 1 } else console.log(JSON.stringify(result))
  } else {
    await prepareFelineTraits({ reviewRepairRound: process.argv.includes('--review-fix-round-1') ? 1 : undefined })
    const result = await validatePreparedFelineTraits()
    console.log(`NEEDS_APPROVAL: ${result.semanticTraits} semantic traits, ${result.sealedProjections} sealed projections, report ${REPORT_PATH}, closure ${result.closureSha256}`)
  }
}
