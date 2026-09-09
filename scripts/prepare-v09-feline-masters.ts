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
const INDEX = `${ROOT}/review/master-overlay-review.index.json`
const APPROVAL_PATH = `${ROOT}/approvals/assembly-approvals.json`
const EMPTY_ATTACHMENT_ALLOWLIST: ApprovedAttachmentAllowlistV1 = { schemaVersion: 'qmonster-approved-attachment-allowlist-v1', entries: [] }
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const approvalSchema = z.strictObject({
  schemaVersion: z.literal('qmonster-assembly-approval-v1'), skeletonFamilyId: z.string(), assemblyTemplateId: z.string(),
  assemblyTemplateSha256: digestSchema, neutralMasterSha256: digestSchema, materialMapSha256: digestSchema,
  fixedOccluderMasksSha256: digestSchema, attachmentAllowlistSha256: digestSchema, compositionGraphSha256: digestSchema, overlaySha256: digestSchema,
  approvedBy: z.literal('project-owner'), approvedAt: z.iso.datetime({ offset: true }), approvalRevision: z.literal(2), status: z.literal('approved'),
})
type ReviewBinding = Pick<AssemblyApprovalV1, 'skeletonFamilyId' | 'assemblyTemplateId' | 'assemblyTemplateSha256' | 'neutralMasterSha256' | 'materialMapSha256' | 'fixedOccluderMasksSha256' | 'compositionGraphSha256' | 'overlaySha256'> & { maskSetSha256: string; attachmentInterfacesSha256: string }
type ReviewIndex = { report: PngResourceRef; families: ReviewBinding[] }

function approvalsForReview(index: ReviewIndex, approvedAt: string): AssemblyApprovalV1[] {
  return index.families.map(family => ({
    schemaVersion: 'qmonster-assembly-approval-v1', skeletonFamilyId: family.skeletonFamilyId, assemblyTemplateId: family.assemblyTemplateId,
    assemblyTemplateSha256: family.assemblyTemplateSha256, neutralMasterSha256: family.neutralMasterSha256, materialMapSha256: family.materialMapSha256,
    fixedOccluderMasksSha256: family.fixedOccluderMasksSha256, attachmentAllowlistSha256: canonicalJsonSha256(EMPTY_ATTACHMENT_ALLOWLIST),
    compositionGraphSha256: family.compositionGraphSha256, overlaySha256: family.overlaySha256,
    approvedBy: 'project-owner', approvedAt, approvalRevision: 2, status: 'approved',
  }))
}

function approvalEvidence(index: ReviewIndex, approvals: AssemblyApprovalV1[]) {
  return { schemaVersion: 'qmonster-approved-master-review-v1', status: 'approved', approvedBy: 'project-owner', approvedAt: approvals[0]!.approvedAt, approvalRevision: 2,
    report: index.report, reviewIndexSha256: canonicalJsonSha256(index), assemblyApprovalsSha256: canonicalJsonSha256(approvals), attachmentAllowlistSha256: canonicalJsonSha256(EMPTY_ATTACHMENT_ALLOWLIST),
    families: index.families.map(family => ({ skeletonFamilyId: family.skeletonFamilyId, maskSetSha256: family.maskSetSha256, attachmentInterfacesSha256: family.attachmentInterfacesSha256 })) }
}

/** Strict approval and supplementary full-mask/interface evidence; no new hashes
 * are accepted merely because a JSON file calls itself approved. */
export function approvalBindingErrors(approvalsInput: unknown, evidence: unknown, allowlist: unknown, index: ReviewIndex): string[] {
  const parsed = z.array(approvalSchema).length(2).safeParse(approvalsInput)
  if (!parsed.success) return ['Assembly approvals must be two strict owner-approved revision-2 records']
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
  structuralShapeClasses: z.tuple([z.literal('feline-standard'), z.enum(['cat-tail-long', 'cat-tail-curled'])]), speciesRigId: z.literal('feline-sit-v2'), archetypeId: z.literal('feline'), poseId: z.literal('seated-front-three-quarter'),
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

// Embedded bitmap glyphs make decoded review identity independent of host typography.
const GLYPHS: Record<string, string> = {
  '=':'00000/00000/11111/00000/11111/00000/00000',
  A:'01110/10001/10001/11111/10001/10001/10001', B:'11110/10001/10001/11110/10001/10001/11110', C:'01111/10000/10000/10000/10000/10000/01111',
  D:'11110/10001/10001/10001/10001/10001/11110', E:'11111/10000/10000/11110/10000/10000/11111', F:'11111/10000/10000/11110/10000/10000/10000',
  G:'01111/10000/10000/10111/10001/10001/01111', H:'10001/10001/10001/11111/10001/10001/10001', I:'11111/00100/00100/00100/00100/00100/11111',
  J:'00111/00010/00010/00010/10010/10010/01100', K:'10001/10010/10100/11000/10100/10010/10001', L:'10000/10000/10000/10000/10000/10000/11111',
  M:'10001/11011/10101/10101/10001/10001/10001', N:'10001/11001/10101/10011/10001/10001/10001', O:'01110/10001/10001/10001/10001/10001/01110',
  P:'11110/10001/10001/11110/10000/10000/10000', Q:'01110/10001/10001/10001/10101/10010/01101', R:'11110/10001/10001/11110/10100/10010/10001',
  S:'01111/10000/10000/01110/00001/00001/11110', T:'11111/00100/00100/00100/00100/00100/00100', U:'10001/10001/10001/10001/10001/10001/01110',
  V:'10001/10001/10001/10001/10001/01010/00100', W:'10001/10001/10001/10101/10101/10101/01010', X:'10001/10001/01010/00100/01010/10001/10001',
  Y:'10001/10001/01010/00100/00100/00100/00100', Z:'11111/00001/00010/00100/01000/10000/11111',
  '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110','2':'01110/10001/00001/00010/00100/01000/11111',
  '3':'11110/00001/00001/01110/00001/00001/11110','4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110',
  '6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000','8':'01110/10001/10001/01110/10001/10001/01110',
  '9':'01110/10001/10001/01111/00001/00001/01110','-':'00000/00000/00000/11111/00000/00000/00000',
  ':':'00000/00100/00100/00000/00100/00100/00000','/':'00001/00010/00010/00100/01000/01000/10000','.':'00000/00000/00000/00000/00000/00110/00110',
  '|':'00100/00100/00100/00100/00100/00100/00100',' ':'00000/00000/00000/00000/00000/00000/00000',
}
type ReviewPanel = { skeletonFamilyId: string; view: string; maskName?: string; maskSha256?: string; visibleMaskPixels?: number; x: number; y: number; size: number }

/** One independent, full-coordinate preview for every mask. Max-pool support
 * preserves even thin roots/replay edges; no mask can hide another mask. */
async function makeReview(families: FamilyResult[]): Promise<{ ref: PngResourceRef; panels: ReviewPanel[] }> {
  const canvas = Buffer.alloc(PIXELS * 4), panels: ReviewPanel[] = []
  for (let i = 0; i < canvas.length; i += 4) canvas.set([242, 245, 249, 255], i)
  const label = (x: number, y: number, value: string, scale = 2) => {
    for (const [n, char] of [...value.toUpperCase()].entries()) {
      const glyph = GLYPHS[char]; if (!glyph) throw new Error('Unsupported review glyph: ' + char)
      for (const [gy, row] of glyph.split('/').entries()) for (const [gx, on] of [...row].entries()) if (on === '1') {
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const px = x + n * 6 * scale + gx * scale + dx, py = y + gy * scale + dy
          if (px >= SIZE || py >= SIZE) throw new Error('Review label overflow')
          canvas.set([21, 34, 48, 255], (py * SIZE + px) * 4)
        }
      }
    }
  }
  const tile = (result: FamilyResult, x: number, y: number, size: number, maskName?: string, material = false) => {
    let visibleMaskPixels = 0
    const support = new Uint8Array(size * size)
    if (maskName) {
      const mask = result.masks[maskName]!
      for (let sy = 0; sy < SIZE; sy++) for (let sx = 0; sx < SIZE; sx++) if (mask[(sy * SIZE + sx) * 4 + 3]) support[Math.floor(sy * size / SIZE) * size + Math.floor(sx * size / SIZE)] = 1
    }
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const sx = Math.floor((px + 0.5) * SIZE / size), sy = Math.floor((py + 0.5) * SIZE / size), source = (sy * SIZE + sx) * 4
      const dark = !maskName && !material, background = dark ? [28, 40, 55] : [218, 226, 235]
      const alpha = result.master[source + 3]! / 255
      let rgb = background.map((v, c) => Math.round(v * (1 - alpha) + result.master[source + c]! * alpha))
      if (material && alpha) {
        const color = result.masks['inner-ears']![source + 3] ? [230, 72, 160] : result.masks.nose![source + 3] ? [255, 105, 42] : [0, 178, 190]
        rgb = rgb.map((v, c) => Math.round(v * 0.35 + color[c]! * 0.65))
      }
      if (maskName && support[py * size + px]) { visibleMaskPixels++; rgb = rgb.map((v, c) => Math.round(v * 0.32 + [240, 38, 109][c]! * 0.68)) }
      canvas.set([...rgb, 255], ((y + py) * SIZE + x + px) * 4)
    }
    panels.push({ skeletonFamilyId: result.entry.skeletonFamilyId, view: maskName ? 'individual-mask-full-context' : material ? 'material' : 'clean', ...(maskName ? { maskName, maskSha256: result.refs[maskName]!.sha256, visibleMaskPixels } : {}), x, y, size })
  }
  label(20, 14, 'QMONSTER V0.9 | EXPANDED MASTER REVIEW | PENDING OWNER APPROVAL', 3)
  label(20, 45, '52 INDIVIDUAL MASKS. PINK = MASK SUPPORT. MASTER COORDINATES / NO TRAIT COMBINATIONS.')
  for (const [i, result] of families.entries()) {
    const x = i * 1024
    label(x + 12, 72, result.entry.skeletonFamilyId)
    label(x + 12, 93, result.entry.skeletonClass + ' / ' + result.entry.structuralShapeClasses[1] + ' / WEIGHT ' + result.entry.weight)
    label(x + 12, 116, 'CLEAN MASTER'); label(x + 524, 116, 'MATERIAL: CYAN FUR / PINK EAR / ORANGE NOSE', 1)
    tile(result, x + 6, 138, 500); tile(result, x + 518, 138, 500, undefined, true)
    label(x + 12, 644, 'MASTER ' + result.entry.masterSha256, 2)
    label(x + 12, 664, 'MASKS ' + canonicalJsonSha256(result.refs), 2)
  }
  for (const [familyIndex, result] of families.entries()) {
    const top = 696 + familyIndex * 662
    label(12, top, result.entry.skeletonFamilyId + ' / ALL 26 MASKS')
    const names = Object.keys(result.masks).sort()
    for (const [n, name] of names.entries()) {
      const x = n % 9 * 227, y = top + 28 + Math.floor(n / 9) * 207
      label(x + 4, y, name, 2)
      tile(result, x + 21, y + 18, 184, name)
    }
  }
  label(12, 2029, 'REVIEW: ONE HEAD / TWO EARS / FOUR PAWS / ONE TAIL / SMOOTH EYELESS FACE / ALPHA EDGES / ALL ZONES', 2)
  const bytes = await encode(canvas), ref = await pngRef(bytes)
  await mkdir(dirname(REVIEW), { recursive: true }); await writeFile(REVIEW, bytes)
  await mkdir(ROOT + '/review/resources', { recursive: true }); await writeFile(ROOT + '/review/resources/' + ref.sha256 + '.png', bytes)
  return { ref, panels }
}

export async function prepareFelineMasters(): Promise<void> {
  const inventory = await readInventory(), families: FamilyResult[] = []
  for (const entry of inventory.masters) families.push(await produceFamily(entry))
  const { ref: reviewRef, panels } = await makeReview(families)
  const resourcePaths: Record<string, string> = { [reviewRef.resourceId]: `${ROOT}/review/resources/${reviewRef.sha256}.png` }
  const pending = []
  for (const { entry, template, family, refs, master } of families) {
    const policy = { schemaVersion: 'qmonster-overlay-policy-v1', skeletonFamilyId: entry.skeletonFamilyId, assemblyTemplateSha256: canonicalJsonSha256(template), fullContextOverlay: reviewRef, previewPolicy: 'full-context-identity-only' }
    await writeJson(`${ROOT}/templates/${entry.skeletonFamilyId}/overlay-policy.json`, policy)
    const policyRef = jsonRef(policy), policyPath = `${ROOT}/review/resources/${policyRef.sha256}.json`
    await writeJson(policyPath, policy); resourcePaths[policyRef.resourceId] = policyPath
    pending.push({ skeletonFamilyId: entry.skeletonFamilyId, assemblyTemplateId: entry.assemblyTemplateId, assemblyTemplateSha256: canonicalJsonSha256(template), neutralMasterSha256: entry.masterSha256, materialMapSha256: family.materialMap.sha256, fixedOccluderMasksSha256: canonicalJsonSha256(family.fixedOccluderMasks), maskSetSha256: canonicalJsonSha256(refs), masks: refs, attachmentInterfacesSha256: canonicalJsonSha256(template.slots.attachment), compositionGraphSha256: canonicalJsonSha256(GRAPH), overlaySha256: canonicalJsonSha256(policy), stats: componentStats(master) })
  }
  await writeJson(INDEX, { schemaVersion: 'qmonster-master-review-index-v1', status: 'pending-owner-approval', inventorySha256: canonicalJsonSha256(inventory), reportPath: resourcePaths[reviewRef.resourceId], report: reviewRef, panels, resourcePaths, families: pending })
  // A pending design index is never an AssemblyApprovalV1; no approvedBy/time/status
  // is generated here. Future attachment allowlist hashes require actual sealed traits.
  await writeJson(`${ROOT}/templates/pending-master-review.json`, { schemaVersion: 'qmonster-pending-master-review-v1', status: 'pending-owner-approval', reportPath: REVIEW, report: reviewRef, families: pending })
}

/** Exact tracked resource closure usable by downstream sealed authoring inputs. */
export async function loadReviewResources(): Promise<V09ContentRecordV1[]> {
  const index = JSON.parse(await readFile(INDEX, 'utf8'))
  const resources: V09ContentRecordV1[] = []
  for (const [id, path] of Object.entries(index.resourcePaths as Record<string, string>)) {
    if (!path.startsWith(ROOT + '/review/resources/') || path.includes('..')) throw new Error('Review resource escaped ownership')
    const bytes = await readFile(path)
    const ref = path.endsWith('.png') ? await pngRef(bytes) : jsonRef(JSON.parse(bytes.toString('utf8')))
    if (ref.resourceId !== id || !path.endsWith('/' + ref.sha256 + (ref.mediaType === 'image/png' ? '.png' : '.json'))) throw new Error('Review resource identity mismatch')
    resources.push({ ref, bytes })
  }
  if (resources.length !== 3 || !resources.some(r => equal(r.ref, index.report))) throw new Error('Review closure is incomplete')
  for (const family of index.families) {
    const resource = resources.find(r => r.ref.sha256 === family.overlaySha256 && r.ref.mediaType !== 'image/png')
    if (!resource) throw new Error('Review closure lacks family overlay policy')
    const policy = JSON.parse(Buffer.from(resource.bytes).toString('utf8'))
    if (policy.skeletonFamilyId !== family.skeletonFamilyId || policy.assemblyTemplateSha256 !== family.assemblyTemplateSha256 || !equal(policy.fullContextOverlay, index.report)) throw new Error('Overlay policy does not resolve exact full context')
  }
  return resources
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
  // This zero-trait probe cannot reach overlay policies: approval.overlaySha256
  // is a digest, not a resource ref. Real sealed traits will reference policies
  // through authoringInputs. Validate the complete review closure separately,
  // including after owner approval, rather than inventing release reachability.
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
  check(index.report.sha256 === await decodedPngSha256(await readFile(index.reportPath)), 'Review hash changed')
  await loadReviewResources()
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
