import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { z } from 'zod'
import { V09_COMPOSITION_NODE_IDS, V09_VERSION_TUPLE, parseContentResourceId, type AssemblyTemplateV1, type CompositionGraphV1, type PngResourceRef, type SkeletonFamilyV1, type ContentResourceRef } from '../packages/generator-core/src/v09-contracts.js'
import { canonicalJsonBytes, canonicalJsonSha256, decodedPngSha256 } from '../packages/asset-catalog/src/v09-content-identity.js'
import { decodeBinaryFullMasterMask } from '../packages/asset-catalog/src/v09-authoring-workbench.js'
import { validateV09Release, type AssemblyApprovalV1, type ApprovedAttachmentAllowlistV1, type V09ReleaseCandidate, type V09ContentRecordV1 } from '../packages/asset-catalog/src/v09-production-validation.js'

const SIZE = 2048, PIXELS = SIZE * SIZE
const ROOT = 'asset-source/v0.9.0/feline'
const REVIEW = 'artifacts/acceptance/v0.9.0-feline/master-overlay-review.png'
const INDEX = 'artifacts/acceptance/v0.9.0-feline/master-overlay-review.index.json'
const APPROVAL_PATH = `${ROOT}/approvals/assembly-approvals.json`
const EMPTY_ATTACHMENT_ALLOWLIST: ApprovedAttachmentAllowlistV1 = { schemaVersion: 'qmonster-approved-attachment-allowlist-v1', entries: [] }
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const approvalSchema = z.strictObject({
  schemaVersion: z.literal('qmonster-assembly-approval-v1'), skeletonFamilyId: z.string(), assemblyTemplateId: z.string(),
  assemblyTemplateSha256: digestSchema, neutralMasterSha256: digestSchema, materialMapSha256: digestSchema,
  fixedOccluderMasksSha256: digestSchema, attachmentAllowlistSha256: digestSchema, compositionGraphSha256: digestSchema, overlaySha256: digestSchema,
  approvedBy: z.literal('project-owner'), approvedAt: z.iso.datetime({ offset: true }), approvalRevision: z.literal(1), status: z.literal('approved'),
})
type ReviewBinding = Pick<AssemblyApprovalV1, 'skeletonFamilyId' | 'assemblyTemplateId' | 'assemblyTemplateSha256' | 'neutralMasterSha256' | 'materialMapSha256' | 'fixedOccluderMasksSha256' | 'compositionGraphSha256' | 'overlaySha256'> & { maskSetSha256: string; attachmentInterfacesSha256: string }
type ReviewIndex = { report: PngResourceRef; families: ReviewBinding[] }

function approvalsForReview(index: ReviewIndex, approvedAt: string): AssemblyApprovalV1[] {
  return index.families.map(family => ({
    schemaVersion: 'qmonster-assembly-approval-v1', skeletonFamilyId: family.skeletonFamilyId, assemblyTemplateId: family.assemblyTemplateId,
    assemblyTemplateSha256: family.assemblyTemplateSha256, neutralMasterSha256: family.neutralMasterSha256, materialMapSha256: family.materialMapSha256,
    fixedOccluderMasksSha256: family.fixedOccluderMasksSha256, attachmentAllowlistSha256: canonicalJsonSha256(EMPTY_ATTACHMENT_ALLOWLIST),
    compositionGraphSha256: family.compositionGraphSha256, overlaySha256: family.overlaySha256,
    approvedBy: 'project-owner', approvedAt, approvalRevision: 1, status: 'approved',
  }))
}

function approvalEvidence(index: ReviewIndex, approvals: AssemblyApprovalV1[]) {
  return { schemaVersion: 'qmonster-approved-master-review-v1', status: 'approved', approvedBy: 'project-owner', approvedAt: approvals[0]!.approvedAt, approvalRevision: 1,
    report: index.report, reviewIndexSha256: canonicalJsonSha256(index), assemblyApprovalsSha256: canonicalJsonSha256(approvals), attachmentAllowlistSha256: canonicalJsonSha256(EMPTY_ATTACHMENT_ALLOWLIST),
    families: index.families.map(family => ({ skeletonFamilyId: family.skeletonFamilyId, maskSetSha256: family.maskSetSha256, attachmentInterfacesSha256: family.attachmentInterfacesSha256 })) }
}

/** Strict approval and supplementary full-mask/interface evidence; no new hashes
 * are accepted merely because a JSON file calls itself approved. */
export function approvalBindingErrors(approvalsInput: unknown, evidence: unknown, allowlist: unknown, index: ReviewIndex): string[] {
  const parsed = z.array(approvalSchema).length(2).safeParse(approvalsInput)
  if (!parsed.success) return ['Assembly approvals must be two strict owner-approved revision-1 records']
  const expected = approvalsForReview(index, parsed.data[0]!.approvedAt)
  const errors: string[] = []
  if (!equal(parsed.data, expected)) errors.push('Assembly approval identity or timestamp differs from reviewed master bindings')
  if (!equal(allowlist, EMPTY_ATTACHMENT_ALLOWLIST)) errors.push('Task 7 cannot approve unreviewed attachment artifacts')
  if (!equal(evidence, approvalEvidence(index, expected))) errors.push('Approved review evidence no longer binds the complete mask/interface/report set')
  return errors
}

async function readApprovals(): Promise<AssemblyApprovalV1[] | undefined> {
  try { return z.array(approvalSchema).length(2).parse(JSON.parse(await readFile(APPROVAL_PATH, 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

/** Explicit post-owner-approval action only. The caller must supply the exact
 * reviewed PNG digest and the approval instant; normal prepare never calls it. */
export async function approveFelineMasters(input: { reportSha256: string; approvedAt: string }): Promise<void> {
  digestSchema.parse(input.reportSha256); z.iso.datetime({ offset: true }).parse(input.approvedAt)
  const errors = await validateFelineMasters()
  if (errors.length) throw new Error(errors.join('\n'))
  const index: ReviewIndex = JSON.parse(await readFile(INDEX, 'utf8'))
  if (index.report.sha256 !== input.reportSha256) throw new Error('Owner approval does not match this review PNG')
  const approvals = approvalsForReview(index, input.approvedAt)
  const previous = await readApprovals()
  if (previous !== undefined && !equal(previous, approvals)) throw new Error('Existing approval differs; a new explicit revision is required')
  await writeJson(`${ROOT}/approvals/attachment-allowlist.json`, EMPTY_ATTACHMENT_ALLOWLIST)
  await writeJson(`${ROOT}/approvals/approved-master-review.json`, approvalEvidence(index, approvals))
  await writeJson(APPROVAL_PATH, approvals)
}
const pointSchema = z.tuple([z.number().int().min(0).max(2047), z.number().int().min(0).max(2047)])
const polygonSchema = z.array(pointSchema).min(3)
const regionSchema = z.strictObject({ description: z.string().min(10), vertices: polygonSchema, additionalPolygons: z.array(polygonSchema) })
const masterSchema = z.strictObject({
  skeletonFamilyId: z.enum(['feline-sit-v2-core', 'feline-sit-v2-legendary-01']), skeletonClass: z.enum(['base', 'legendary']), weight: z.union([z.literal(8), z.literal(1)]),
  structuralShapeClasses: z.tuple([z.literal('feline-standard'), z.enum(['cat-tail-long', 'cat-tail-curled'])]), speciesRigId: z.literal('feline-sit-v2'), archetypeId: z.literal('domestic-plush-cat'), poseId: z.literal('seated-front-three-quarter'),
  masterPath: z.string(), masterSha256: z.string().regex(/^[a-f0-9]{64}$/), sourcePath: z.string(), assemblyTemplateId: z.string(), templatePath: z.string(),
  materialRegistry: z.strictObject({ fur: z.literal(1), innerEar: z.literal(2), nose: z.literal(3) }), landmarks: z.record(z.string(), pointSchema),
  regions: z.record(z.string(), regionSchema), expectedMaskPaths: z.record(z.string(), z.string()),
})
const inventorySchema = z.strictObject({
  schemaVersion: z.literal('qmonster-authored-master-inventory-v1'), canvas: z.strictObject({ width: z.literal(2048), height: z.literal(2048) }), authoringMethod: z.string(),
  alphaExtraction: z.strictObject({ method: z.literal('neutral-checker-local-chroma-v1'), script: z.literal('scripts/extract-v09-feline-alpha.ts'), ownerAuthorized: z.literal(true), sourceCanvas: z.literal(1254), normalizedContentSize: z.literal(1856), border: z.literal(96) }),
  masters: z.tuple([masterSchema, masterSchema]),
})
export type MasterInventoryEntry = z.infer<typeof masterSchema>
type Region = z.infer<typeof regionSchema>
type MaskSet = Record<string, Buffer>
type FamilyResult = { entry: MasterInventoryEntry; master: Buffer; masks: MaskSet; refs: Record<string, PngResourceRef>; template: AssemblyTemplateV1; family: SkeletonFamilyV1 }
export const GRAPH: CompositionGraphV1 = { schemaVersion: 'qmonster-composition-graph-v1', orderedNodes: [...V09_COMPOSITION_NODE_IDS], blendMode: 'source-over-premultiplied-srgb', transformPolicy: 'identity-only' }

export async function readInventory() {
  const inventory = inventorySchema.parse(JSON.parse(await readFile(`${ROOT}/master-inventory.json`, 'utf8')))
  if (inventory.masters[0].skeletonClass !== 'base' || inventory.masters[0].weight !== 8 || inventory.masters[1].skeletonClass !== 'legendary' || inventory.masters[1].weight !== 1) throw new Error('Frozen base/legendary pool is not 8:1')
  for (const entry of inventory.masters) {
    if (entry.masterPath !== `${ROOT}/masters/${entry.skeletonFamilyId}.png` || entry.templatePath !== `${ROOT}/templates/${entry.skeletonFamilyId}.json`) throw new Error('Master/template path escaped family ownership')
    for (const [name, path] of Object.entries(entry.expectedMaskPaths)) if (path !== `${ROOT}/templates/${entry.skeletonFamilyId}/${name}.png`) throw new Error('Mask path escaped family ownership')
    for (const region of Object.values(entry.regions)) for (const vertices of [region.vertices, ...region.additionalPolygons]) {
      let area = 0
      for (let i = 0; i < vertices.length; i++) { const a = vertices[i]!, b = vertices[(i + 1) % vertices.length]!; area += a[0] * b[1] - a[1] * b[0] }
      if (Math.abs(area) < 40 || new Set(vertices.map(point => point.join(','))).size !== vertices.length) throw new Error('Degenerate authored polygon')
    }
  }
  return inventory
}

function pointInside(x: number, y: number, vertices: number[][]): boolean {
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i]!, b = vertices[j]!
    if ((a[1]! > y) !== (b[1]! > y) && x < (b[0]! - a[0]!) * (y - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside
  }
  return inside
}

/** Explicit authored polygons only; no inferred symmetry or generic shape fit. */
export function rasterizeRegion(region: Region, master?: Buffer): Buffer {
  const result = Buffer.alloc(PIXELS * 4)
  for (const vertices of [region.vertices, ...region.additionalPolygons]) {
    const minX = Math.max(0, Math.min(...vertices.map(p => p[0]))), maxX = Math.min(SIZE - 1, Math.max(...vertices.map(p => p[0])))
    const minY = Math.max(0, Math.min(...vertices.map(p => p[1]))), maxY = Math.min(SIZE - 1, Math.max(...vertices.map(p => p[1])))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const i = (y * SIZE + x) * 4 + 3
      if ((master === undefined || master[i]! > 0) && pointInside(x + 0.5, y + 0.5, vertices)) result[i] = 255
    }
  }
  return result
}

function intersection(a: Buffer, b: Buffer): Buffer { const out = Buffer.alloc(PIXELS * 4); for (let i = 3; i < out.length; i += 4) if (a[i] && b[i]) out[i] = 255; return out }
function union(a: Buffer, b: Buffer): Buffer { const out = Buffer.alloc(PIXELS * 4); for (let i = 3; i < out.length; i += 4) if (a[i] || b[i]) out[i] = 255; return out }
function insetEdge(zone: Buffer, thickness = 5): Buffer {
  const out = Buffer.alloc(PIXELS * 4)
  for (let y = thickness; y < SIZE - thickness; y++) for (let x = thickness; x < SIZE - thickness; x++) {
    const i = (y * SIZE + x) * 4 + 3
    if (!zone[i]) continue
    if (!zone[i - thickness * 4] || !zone[i + thickness * 4] || !zone[i - thickness * SIZE * 4] || !zone[i + thickness * SIZE * 4]) out[i] = 255
  }
  return out
}

export function deriveMasks(entry: MasterInventoryEntry, master: Buffer): MaskSet {
  const regions = entry.regions
  const inside = (name: string) => rasterizeRegion(regions[name]!, master)
  const exterior = (name: string) => rasterizeRegion(regions[name]!)
  const masks: MaskSet = {
    'inner-ears': inside('innerEars'), nose: inside('nose'), forepaw: inside('forepaw'), hindpaw: inside('hindpaw'), tail: inside('tail'),
    'left-eye': inside('leftEye'), 'right-eye': inside('rightEye'), mouth: inside('mouth'),
    'oral-open': inside('oralOpen'), 'oral-narrow': inside('oralNarrow'), 'oral-wide': inside('oralWide'),
    'head-allowed': exterior('headAllowed'), 'head-rear': exterior('headRear'), 'head-front': inside('headFront'), 'head-occluder': inside('headOccluder'),
    'extra-allowed': exterior('extraAllowed'), 'extra-rear': exterior('extraRear'), 'extra-front': inside('extraFront'), 'extra-occluder': inside('extraOccluder'),
    targeted: inside('targeted'), background: exterior('background'), foreground: exterior('foreground'),
  }
  const fur = Buffer.alloc(PIXELS * 4)
  for (let i = 3; i < fur.length; i += 4) if (master[i] && !masks['inner-ears']![i] && !masks.nose![i]) fur[i] = 255
  masks['global-fur'] = fur
  for (const name of ['forepaw', 'hindpaw', 'tail']) masks[name] = intersection(masks[name]!, fur)
  masks['eye-pair'] = union(masks['left-eye']!, masks['right-eye']!)
  masks['eye-edge'] = insetEdge(masks['eye-pair']!)
  masks['mouth-edge'] = insetEdge(masks.mouth!)
  return masks
}

async function encode(pixels: Buffer): Promise<Buffer> { return sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer() }
async function writeJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.concat([canonicalJsonBytes(value), Buffer.from('\n')])) }
async function pngRef(bytes: Buffer): Promise<PngResourceRef> { const sha256 = await decodedPngSha256(bytes); return { resourceId: parseContentResourceId(`sha256:${sha256}`)!, sha256, mediaType: 'image/png', width: SIZE, height: SIZE } }
const jsonRef = (value: unknown): ContentResourceRef => { const sha256 = canonicalJsonSha256(value); return { resourceId: parseContentResourceId(`sha256:${sha256}`)!, sha256, mediaType: 'application/qmonster-manifest-v1+json' } }

function makeTemplate(entry: MasterInventoryEntry, refs: Record<string, PngResourceRef>): AssemblyTemplateV1 {
  const ref = (name: string) => refs[name]!
  return {
    schemaVersion: 'qmonster-assembly-template-v1', assemblyTemplateId: entry.assemblyTemplateId, skeletonFamilyId: entry.skeletonFamilyId, canvas: { width: SIZE, height: SIZE }, neutralMasterSha256: entry.masterSha256,
    materialRegistry: entry.materialRegistry, compositionGraph: GRAPH,
    slots: {
      surface: (['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface'] as const).map(slotId => ({ kind: 'surface', slotId, ownerMaterialId: 'fur', authoringZone: ref(({ forepawDetail: 'forepaw', hindpawDetail: 'hindpaw', tailSurface: 'tail' } as Record<string, string>)[slotId] ?? 'global-fur') })),
      embedded: [
        { kind: 'eyePair', slotId: 'eyes', leftAuthoringZone: ref('left-eye'), rightAuthoringZone: ref('right-eye'), pairAuthoringZone: ref('eye-pair'), occlusionReplayZone: ref('eye-edge') },
        { kind: 'mouth', slotId: 'mouthShape', authoringZone: ref('mouth'), occlusionReplayZone: ref('mouth-edge') },
        { kind: 'oralDetail', slotId: 'oralDetail', socketRegistry: Object.fromEntries(['open', 'narrow', 'wide'].map(name => [name, { authoringZone: ref(`oral-${name}`), parentMouthTraitIds: [`mouth-${name}`] }])), closedMouthSentinel: 'oral-none' },
      ],
      attachment: [
        { kind: 'attachment', slotId: 'headAppendage', attachmentInterface: { interfaceId: `${entry.skeletonFamilyId}-crown`, allowedShapeClasses: ['ear-horn-small', 'ear-ornament'], allowedZone: ref('head-allowed'), rearRootStencil: ref('head-rear'), frontRootStencil: ref('head-front'), fixedOccluderMaskId: 'crown-fur' } },
        { kind: 'attachment', slotId: 'extraAppendage', attachmentInterface: { interfaceId: `${entry.skeletonFamilyId}-collar`, allowedShapeClasses: ['mane-small', 'collar'], allowedZone: ref('extra-allowed'), rearRootStencil: ref('extra-rear'), frontRootStencil: ref('extra-front'), fixedOccluderMaskId: 'collar-fur' } },
      ],
      effect: [
        { kind: 'targetedEffect', slotId: 'effect', targetId: 'chest', authoringZone: ref('targeted'), compositionNode: 'targetedEffect.overlay' },
        { kind: 'ambientEffect', slotId: 'effect', zoneId: 'background', authoringZone: ref('background'), compositionNode: 'backgroundEffect' },
        { kind: 'ambientEffect', slotId: 'effect', zoneId: 'foreground', authoringZone: ref('foreground'), compositionNode: 'foregroundAmbientEffect' },
      ],
    },
  }
}

function materialPixels(entry: MasterInventoryEntry, master: Buffer, masks: MaskSet): Buffer {
  const map = Buffer.alloc(PIXELS * 4)
  for (let i = 0; i < map.length; i += 4) if (master[i + 3]) { map[i] = masks.nose![i + 3] ? entry.materialRegistry.nose : masks['inner-ears']![i + 3] ? entry.materialRegistry.innerEar : entry.materialRegistry.fur; map[i + 3] = 255 }
  return map
}

async function produceFamily(entry: MasterInventoryEntry): Promise<FamilyResult> {
  const bytes = await readFile(entry.masterPath)
  if (await decodedPngSha256(bytes) !== entry.masterSha256) throw new Error(`Master identity changed: ${entry.skeletonFamilyId}`)
  const master = await sharp(bytes).raw().toBuffer()
  const masks = deriveMasks(entry, master), refs: Record<string, PngResourceRef> = {}
  await mkdir(`${ROOT}/templates/${entry.skeletonFamilyId}`, { recursive: true })
  for (const [name, pixels] of Object.entries(masks)) {
    if (!entry.expectedMaskPaths[name]) throw new Error(`Unregistered mask ${name}`)
    const bytes = await encode(pixels); refs[name] = await pngRef(bytes); await writeFile(entry.expectedMaskPaths[name]!, bytes)
  }
  const material = await encode(materialPixels(entry, master, masks)), materialMap = await pngRef(material)
  await writeFile(`${ROOT}/templates/${entry.skeletonFamilyId}/material-map.png`, material)
  const template = makeTemplate(entry, refs)
  const family: SkeletonFamilyV1 = { schemaVersion: 'qmonster-skeleton-family-v1', skeletonFamilyId: entry.skeletonFamilyId, skeletonClass: entry.skeletonClass, structuralShapeClasses: entry.structuralShapeClasses, archetypeId: entry.archetypeId, poseId: entry.poseId, speciesRigId: entry.speciesRigId, canvas: { width: SIZE, height: SIZE }, neutralMaster: await pngRef(bytes), materialMap, fixedOccluderMasks: { 'crown-fur': refs['head-occluder']!, 'collar-fur': refs['extra-occluder']!, 'eye-edge': refs['eye-edge']!, 'mouth-edge': refs['mouth-edge']! }, assemblyTemplateId: entry.assemblyTemplateId }
  await writeJson(entry.templatePath, template)
  await writeJson(`${ROOT}/templates/${entry.skeletonFamilyId}/family.json`, family)
  return { entry, master, masks, refs, template, family }
}

export function componentStats(pixels: Buffer, threshold = 1): { included: number; largest: number; components: number; safeBorder: number; bounds: number[] } {
  const visited = new Uint8Array(PIXELS), queue = new Int32Array(PIXELS)
  let included = 0, largest = 0, components = 0, minX = SIZE, minY = SIZE, maxX = -1, maxY = -1
  for (let p = 0; p < PIXELS; p++) {
    if (pixels[p * 4 + 3]! < threshold) continue
    included++; const x = p % SIZE, y = Math.floor(p / SIZE); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    if (visited[p]) continue
    let tail = 1; queue[0] = p; visited[p] = 1; components++
    for (let at = 0; at < tail; at++) {
      const q = queue[at]!, qx = q % SIZE, qy = Math.floor(q / SIZE)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = qx + dx, ny = qy + dy, n = ny * SIZE + nx
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || visited[n] || pixels[n * 4 + 3]! < threshold) continue
        visited[n] = 1; queue[tail++] = n
      }
    }
    largest = Math.max(largest, tail)
  }
  return { included, largest, components, safeBorder: Math.min(minX, minY, SIZE - 1 - maxX, SIZE - 1 - maxY), bounds: [minX, minY, maxX, maxY] }
}

function overlayPixels(masks: MaskSet, layers: Array<[string, number[], number]>): Buffer {
  const out = Buffer.alloc(PIXELS * 4)
  for (const [name, rgb, alpha] of layers) for (let i = 0; i < out.length; i += 4) if (masks[name]![i + 3]) { out[i] = rgb[0]!; out[i + 1] = rgb[1]!; out[i + 2] = rgb[2]!; out[i + 3] = alpha }
  return out
}

async function makeReview(families: FamilyResult[]): Promise<PngResourceRef> {
  const composites: sharp.OverlayOptions[] = []
  const labels: string[] = []
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const text = (x: number, y: number, value: string, size = 19, fill = '#17212b') => labels.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="DejaVu Sans,Arial">${escape(value)}</text>`)
  text(32, 43, 'QMONSTER v0.9 | TWO WHOLE FELINE MASTERS | PENDING OWNER APPROVAL', 30)
  text(32, 77, 'No trait combinations. Smooth eyeless face; original head / neck / torso / four paws / one tail remain one image.', 21)
  for (const [row, result] of families.entries()) {
    const y = 110 + row * 935, { entry, masks } = result
    text(24, y + 28, `${entry.skeletonFamilyId} | ${entry.skeletonClass} | ${entry.structuralShapeClasses[1]} | weight ${entry.weight}`, 26)
    text(24, y + 57, `MASTER ${entry.masterSha256}`, 20)
    text(24, y + 84, `TEMPLATE ${canonicalJsonSha256(result.template)}`, 20)
    const views: Array<Array<[string, number[], number]>> = [[], [['global-fur', [0, 178, 190], 76], ['inner-ears', [230, 72, 160], 180], ['nose', [255, 105, 42], 200]], [['left-eye', [32, 174, 255], 125], ['right-eye', [188, 77, 235], 125], ['mouth', [242, 161, 34], 105], ['oral-wide', [255, 84, 88], 125], ['oral-open', [24, 200, 170], 155], ['oral-narrow', [51, 58, 255], 170], ['eye-edge', [255, 255, 255], 190], ['mouth-edge', [255, 255, 255], 190]], [['head-allowed', [170, 80, 235], 95], ['extra-allowed', [0, 160, 218], 95], ['head-occluder', [255, 170, 55], 160], ['extra-occluder', [255, 170, 55], 160], ['head-rear', [255, 20, 75], 235], ['extra-rear', [255, 20, 75], 235], ['head-front', [10, 245, 160], 230], ['extra-front', [10, 245, 160], 230]]]
    const titles = ['CLEAN MASTER / ALPHA EDGE', 'MATERIAL OWNERSHIP', 'EYE / MOUTH / ORAL ZONES', 'ATTACHMENT / ROOTS / OCCLUDERS']
    for (let col = 0; col < 4; col++) {
      const x = col * 512
      text(x + 15, y + 125, titles[col]!, 20)
      const layers = views[col]!.length ? [{ input: await encode(overlayPixels(masks, views[col]!)) }] : []
      const tile = await sharp(await readFile(entry.masterPath)).composite(layers).png().toBuffer()
      const resized = await sharp(tile).resize(500, 500).flatten({ background: col === 0 ? '#202936' : '#edf0f4' }).png().toBuffer()
      composites.push({ input: resized, left: x + 6, top: y + 146 })
    }
    const stats = componentStats(result.master)
    text(18, y + 681, `RGBA8 2048 x 2048 | safe border ${stats.safeBorder}px | dominant alpha component ${(stats.largest / stats.included * 100).toFixed(5)}%`, 22)
    text(18, y + 716, 'Material: cyan = fur; pink = inner ears; orange = nose. Local paw/tail surface zones own fur only.', 21)
    text(18, y + 749, 'Face: blue/purple = left/right eyes; amber = mouth; red/teal/indigo = wide/open/narrow oral sockets; white = replay edge.', 21)
    text(18, y + 782, 'Attachment: purple/cyan = extension allowance; red = fixed rear root; green = front root; amber = native fur occluder.', 21)
    text(18, y + 815, `MATERIAL ${result.family.materialMap.sha256}`, 20)
    text(18, y + 845, `MASK SET ${canonicalJsonSha256(result.refs)}`, 20)
    text(18, y + 878, 'Human gate: confirm familiar feline silhouette, one head/two ears/four paws/one tail, no eyes/sockets, continuous fur and clean edges.', 20)
  }
  const labelSvg = Buffer.from(`<svg width="2048" height="2048" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`)
  await mkdir(dirname(REVIEW), { recursive: true })
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#f8fafc' } }).composite([...composites, { input: labelSvg }]).png().toFile(REVIEW)
  return pngRef(await readFile(REVIEW))
}

export async function prepareFelineMasters(): Promise<void> {
  const inventory = await readInventory(), families: FamilyResult[] = []
  for (const entry of inventory.masters) families.push(await produceFamily(entry))
  const reviewRef = await makeReview(families)
  const pending = []
  for (const { entry, template, family, refs, master } of families) {
    const policy = { schemaVersion: 'qmonster-overlay-policy-v1', skeletonFamilyId: entry.skeletonFamilyId, assemblyTemplateSha256: canonicalJsonSha256(template), fullContextOverlay: reviewRef, previewPolicy: 'full-context-identity-only' }
    await writeJson(`${ROOT}/templates/${entry.skeletonFamilyId}/overlay-policy.json`, policy)
    pending.push({ skeletonFamilyId: entry.skeletonFamilyId, assemblyTemplateId: entry.assemblyTemplateId, assemblyTemplateSha256: canonicalJsonSha256(template), neutralMasterSha256: entry.masterSha256, materialMapSha256: family.materialMap.sha256, fixedOccluderMasksSha256: canonicalJsonSha256(family.fixedOccluderMasks), maskSetSha256: canonicalJsonSha256(refs), masks: refs, attachmentInterfacesSha256: canonicalJsonSha256(template.slots.attachment), compositionGraphSha256: canonicalJsonSha256(GRAPH), overlaySha256: canonicalJsonSha256(policy), stats: componentStats(master) })
  }
  await writeJson(INDEX, { schemaVersion: 'qmonster-master-review-index-v1', status: 'pending-owner-approval', inventorySha256: canonicalJsonSha256(inventory), reportPath: REVIEW, report: reviewRef, families: pending })
  // A pending design index is never an AssemblyApprovalV1; no approvedBy/time/status
  // is generated here. Future attachment allowlist hashes require actual sealed traits.
  await writeJson(`${ROOT}/templates/pending-master-review.json`, { schemaVersion: 'qmonster-pending-master-review-v1', status: 'pending-owner-approval', reportPath: REVIEW, report: reviewRef, families: pending })
}

async function decode(path: string): Promise<Buffer> { return sharp(await readFile(path)).raw().toBuffer() }
const equal = (a: unknown, b: unknown) => canonicalJsonSha256(a) === canonicalJsonSha256(b)
function contained(a: Buffer, b: Buffer): boolean { for (let i = 3; i < a.length; i += 4) if (a[i] && !b[i]) return false; return true }
function overlaps(a: Buffer, b: Buffer): boolean { for (let i = 3; i < a.length; i += 4) if (a[i] && b[i]) return true; return false }

/** Probe the real Task 5 parser using an honest incomplete candidate. Missing
 * traits and approvals remain visible failures; no fake approval/traits are built. */
export async function productionContractDiagnostics(families: SkeletonFamilyV1[], templates: AssemblyTemplateV1[], pngs: Map<string, V09ContentRecordV1>, approvals: AssemblyApprovalV1[] = []) {
  const speciesRig = { speciesRigId: 'feline-sit-v2' }
  const skeletonPool = { schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'feline-sit-v2-masters', candidates: families.map((family, i) => ({ skeletonFamilyId: family.skeletonFamilyId, skeletonClass: family.skeletonClass, weight: i === 0 ? 8 : 1 })) }
  const traitInventory = { schemaVersion: 'qmonster-trait-inventory-v1' as const, traits: [] }
  const attachmentAllowlist = EMPTY_ATTACHMENT_ALLOWLIST
  const documents = [speciesRig, skeletonPool, ...families, ...templates, ...approvals, traitInventory, attachmentAllowlist, GRAPH]
  const records: V09ContentRecordV1[] = documents.map(value => ({ ref: jsonRef(value), bytes: canonicalJsonBytes(value) }))
  const required = new Set<string>()
  const refs = (v: unknown) => { if (v === null || typeof v !== 'object') return; if ('mediaType' in v && v.mediaType === 'image/png') { required.add((v as PngResourceRef).resourceId); return }; for (const next of Object.values(v)) refs(next) }
  families.forEach(refs); templates.forEach(refs)
  for (const id of required) { const item = pngs.get(id); if (!item) throw new Error(`Missing PNG ${id}`); records.push(item) }
  const releaseManifest = { schemaVersion: 'qmonster-release-v1', versionTuple: V09_VERSION_TUPLE, speciesRig: jsonRef(speciesRig), skeletonPool: jsonRef(skeletonPool), skeletonFamilies: families.map(jsonRef), assemblyTemplates: templates.map(jsonRef), approvals: approvals.map(jsonRef), traitApprovals: [], traitInventory: jsonRef(traitInventory), sealedTraits: [], compositionGraph: jsonRef(GRAPH), rendererBuildSha256: canonicalJsonSha256({ stage: 'authoring-contract-probe' }) }
  const candidate: V09ReleaseCandidate = { releaseManifest, speciesRig, skeletonPool, skeletonFamilies: families, assemblyTemplates: templates, assemblyApprovals: approvals, traitApprovals: [], attachmentAllowlist, traitInventory, sealedTraits: [], compositionGraph: GRAPH, resources: records }
  return validateV09Release(candidate)
}

export async function validateFelineMasters(options: { requireApproval?: boolean } = {}): Promise<string[]> {
  const errors: string[] = [], inventory = await readInventory(), families: SkeletonFamilyV1[] = [], templates: AssemblyTemplateV1[] = [], pngs = new Map<string, V09ContentRecordV1>()
  const index = JSON.parse(await readFile(INDEX, 'utf8'))
  const check = (condition: unknown, error: string) => { if (!condition) errors.push(error) }
  check(index.status === 'pending-owner-approval', 'Review index must remain pending')
  check(index.inventorySha256 === canonicalJsonSha256(inventory), 'Inventory identity differs from report')
  check(index.report.sha256 === await decodedPngSha256(await readFile(REVIEW)), 'Review hash changed')
  for (const entry of inventory.masters) {
    const label = entry.skeletonFamilyId
    const bytes = await readFile(entry.masterPath), master = await decode(entry.masterPath)
    check(await decodedPngSha256(bytes) === entry.masterSha256, `${label}: master hash changed`)
    const stats = componentStats(master)
    check(stats.safeBorder >= 96, `${label}: insufficient safe border`)
    check(stats.included > 600_000 && stats.largest / stats.included >= 0.999, `${label}: disconnected master alpha`)
    // Neutral backgrounds are absent even in the enclosed tail/torso gap. This
    // is a pixel check of the known rejected source, not an anatomical detector.
    let opaqueNeutral = 0, fractional = 0
    for (let i = 0; i < master.length; i += 4) { if (master[i + 3]! > 0 && master[i + 3]! < 255) fractional++; if (master[i + 3] === 255 && Math.max(master[i]!, master[i + 1]!, master[i + 2]!) - Math.min(master[i]!, master[i + 1]!, master[i + 2]!) < 8) opaqueNeutral++ }
    check(opaqueNeutral < 150, `${label}: neutral checker residue`); check(fractional > 1000, `${label}: missing antialiased fur alpha`)
    for (const [name, [x, y]] of Object.entries(entry.landmarks)) check(master[(y * SIZE + x) * 4 + 3]! > 0, `${label}: landmark ${name} is off creature`)
    const masks: MaskSet = {}, refs: Record<string, PngResourceRef> = {}, expected = deriveMasks(entry, master)
    for (const [name, path] of Object.entries(entry.expectedMaskPaths)) {
      const bytes = await readFile(path), decoded = await decodeBinaryFullMasterMask(bytes)
      masks[name] = decoded.pixels; refs[name] = await pngRef(bytes); pngs.set(refs[name]!.resourceId, { ref: refs[name]!, bytes })
      check(decoded.pixels.equals(expected[name]!), `${label}: ${name} differs from authored polygon raster`)
      let valid = true, included = 0
      for (let i = 0; i < decoded.pixels.length; i += 4) { if (decoded.pixels[i] || decoded.pixels[i + 1] || decoded.pixels[i + 2] || (decoded.pixels[i + 3] !== 0 && decoded.pixels[i + 3] !== 255)) valid = false; if (decoded.pixels[i + 3]) included++ }
      check(valid && included > 0, `${label}: ${name} binary/RGB0/nonempty contract`)
      if (!['head-allowed', 'head-rear', 'extra-allowed', 'extra-rear', 'background', 'foreground'].includes(name)) check(contained(decoded.pixels, master), `${label}: ${name} escapes master alpha`)
    }
    check(!overlaps(masks['left-eye']!, masks['right-eye']!), `${label}: eye zones overlap`)
    check(masks['eye-pair']!.equals(union(masks['left-eye']!, masks['right-eye']!)), `${label}: eye pair differs`)
    for (const name of ['open', 'narrow', 'wide']) check(contained(masks[`oral-${name}`]!, masks.mouth!), `${label}: oral ${name} escapes mouth`)
    check(contained(masks['eye-edge']!, masks['eye-pair']!) && contained(masks['mouth-edge']!, masks.mouth!), `${label}: replay edge containment`)
    for (const name of ['forepaw', 'hindpaw', 'tail']) check(contained(masks[name]!, masks['global-fur']!), `${label}: local surface not fur owned`)
    for (const name of ['head', 'extra']) {
      const root = masks[`${name}-rear`]!, front = masks[`${name}-front`]!, allowed = masks[`${name}-allowed`]!, occluder = masks[`${name}-occluder`]!
      check(contained(root, allowed) && contained(front, allowed), `${label}: ${name} roots escape allowance`)
      check(overlaps(root, master) && !contained(root, master), `${label}: ${name} root must straddle master seam`)
      check(contained(intersection(root, master), occluder) && contained(front, occluder), `${label}: ${name} root not covered by native occluder`)
      check(componentStats(allowed).components === 1 && overlaps(root, allowed), `${label}: ${name} extension disconnected from root`)
    }
    const [tipX, tipY] = entry.landmarks.tailTip!, [rootX, rootY] = entry.landmarks.tailRoot!
    check(masks.tail![(tipY * SIZE + tipX) * 4 + 3] === 255 && masks.tail![(rootY * SIZE + rootX) * 4 + 3] === 255, `${label}: tail zone misses actual tail tip/root`)
    const template: AssemblyTemplateV1 = JSON.parse(await readFile(entry.templatePath, 'utf8'))
    const family: SkeletonFamilyV1 = JSON.parse(await readFile(`${ROOT}/templates/${label}/family.json`, 'utf8'))
    check(equal(template, makeTemplate(entry, refs)), `${label}: template drift`)
    check(equal(template.compositionGraph, GRAPH), `${label}: graph drift`)
    const mapBytes = await readFile(`${ROOT}/templates/${label}/material-map.png`), map = await decode(`${ROOT}/templates/${label}/material-map.png`)
    check(map.equals(materialPixels(entry, master, masks)), `${label}: material ownership differs`)
    check(await decodedPngSha256(mapBytes) === family.materialMap.sha256, `${label}: material identity mismatch`)
    const policy = JSON.parse(await readFile(`${ROOT}/templates/${label}/overlay-policy.json`, 'utf8'))
    check(equal(policy, { schemaVersion: 'qmonster-overlay-policy-v1', skeletonFamilyId: label, assemblyTemplateSha256: canonicalJsonSha256(template), fullContextOverlay: index.report, previewPolicy: 'full-context-identity-only' }), `${label}: strict overlay policy drift`)
    const pending = index.families.find((f: { skeletonFamilyId: string }) => f.skeletonFamilyId === label)
    check(pending?.maskSetSha256 === canonicalJsonSha256(refs) && pending?.overlaySha256 === canonicalJsonSha256(policy) && pending?.assemblyTemplateSha256 === canonicalJsonSha256(template), `${label}: pending review binding mismatch`)
    pngs.set(family.neutralMaster.resourceId, { ref: family.neutralMaster, bytes }); pngs.set(family.materialMap.resourceId, { ref: family.materialMap, bytes: mapBytes })
    families.push(family); templates.push(template)
  }
  const approvals = await readApprovals()
  if (approvals !== undefined) {
    const evidence = JSON.parse(await readFile(`${ROOT}/approvals/approved-master-review.json`, 'utf8'))
    const allowlist = JSON.parse(await readFile(`${ROOT}/approvals/attachment-allowlist.json`, 'utf8'))
    errors.push(...approvalBindingErrors(approvals, evidence, allowlist, index))
  } else if (options.requireApproval) errors.push('Explicit owner approval records are required')
  const diagnostics = await productionContractDiagnostics(families, templates, pngs, approvals)
  const expectedPending = (d: { code: string; path: (string | number)[] }) => (d.code === 'RARITY_INVENTORY_MISMATCH' && d.path[0] === 'traitInventory') || (d.code === 'SKELETON_PROJECTION_MISSING' && d.path.join('.') === 'sealedTraits') || (d.code === 'ASSEMBLY_TEMPLATE_HASH_MISMATCH' && d.path[0] === 'assemblyApprovals' && d.path[2] === 'overlaySha256') || (approvals === undefined && d.code === 'ASSEMBLY_TEMPLATE_UNAPPROVED' && d.path[0] === 'assemblyApprovals')
  for (const diagnostic of diagnostics) if (!expectedPending(diagnostic)) errors.push(`Task 5: ${diagnostic.code} ${diagnostic.path.join('.')} ${diagnostic.message}`)
  check(approvals === undefined ? diagnostics.some(d => d.code === 'ASSEMBLY_TEMPLATE_UNAPPROVED') : !diagnostics.some(d => d.code === 'ASSEMBLY_TEMPLATE_UNAPPROVED'), 'Task 5 owner-approval gate disagrees with the actual approved records')
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareFelineMasters()
  const approvalFlag = process.argv.indexOf('--approve-at'), reviewFlag = process.argv.indexOf('--review-sha256')
  if (approvalFlag !== -1 || reviewFlag !== -1) {
    if (approvalFlag === -1 || reviewFlag === -1) throw new Error('Approval requires both --approve-at and --review-sha256')
    await approveFelineMasters({ approvedAt: process.argv[approvalFlag + 1]!, reportSha256: process.argv[reviewFlag + 1]! })
  }
  const errors = await validateFelineMasters()
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 } else console.log(await readApprovals() ? 'APPROVED: exact owner-approved feline master bindings verified.' : 'NEEDS_APPROVAL: two masters, deterministic masks/templates and one hash-bound review report prepared.')
}
