import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { ConnectorClass, ConnectorRole, Point2D } from '@qmonster/generator-core'
import { BIPED_SLICE, parseInterfaceSourceManifest, structuralVariants } from './interface-source-schema.js'

const CANVAS_SIZE = 2048

export interface GuideProfile {
  assetId: string
  id: string
  role: ConnectorRole
  connectorClass: ConnectorClass
  origin: Point2D
  tangent: Point2D
  outwardNormal: Point2D
  width: number
  depth: number
}

export interface RenderInterfaceGuidesInput {
  outputRoot: string
  rigId: 'biped'
  profiles: GuideProfile[]
}

export interface InterfaceGuideFile {
  assetId: string
  connectorId: string
  role: ConnectorRole
  guidePath: string
  guideSha256: string
  maskPath: string
  maskSha256: string
}

function finite(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function guideSvg(profile: GuideProfile): Buffer {
  const { x, y } = profile.origin
  const tx = profile.tangent.x * profile.width / 2
  const ty = profile.tangent.y * profile.width / 2
  const nx = profile.outwardNormal.x * profile.depth
  const ny = profile.outwardNormal.y * profile.depth
  const envelopeX = x - profile.width / 2
  const envelopeY = y - profile.depth / 2
  const angle = Math.atan2(profile.tangent.y, profile.tangent.x) * 180 / Math.PI
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">
<rect x="${finite(envelopeX)}" y="${finite(envelopeY)}" width="${finite(profile.width)}" height="${finite(profile.depth)}" transform="rotate(${finite(angle)} ${finite(x)} ${finite(y)})" fill="none" stroke="#ffd400" stroke-width="8" stroke-dasharray="18 12"/>
<line x1="${finite(x - tx)}" y1="${finite(y - ty)}" x2="${finite(x + tx)}" y2="${finite(y + ty)}" stroke="#00d8ff" stroke-width="10"/>
<line x1="${finite(x)}" y1="${finite(y)}" x2="${finite(x + nx)}" y2="${finite(y + ny)}" stroke="#ff3b8d" stroke-width="10"/>
<circle cx="${finite(x)}" cy="${finite(y)}" r="14" fill="#ffffff"/>
<polygon points="${finite(x + tx)},${finite(y + ty)} ${finite(x + tx - profile.tangent.x * 30 - profile.outwardNormal.x * 18)},${finite(y + ty - profile.tangent.y * 30 - profile.outwardNormal.y * 18)} ${finite(x + tx - profile.tangent.x * 30 + profile.outwardNormal.x * 18)},${finite(y + ty - profile.tangent.y * 30 + profile.outwardNormal.y * 18)}" fill="#00d8ff"/>
<polygon points="${finite(x + nx)},${finite(y + ny)} ${finite(x + nx - profile.outwardNormal.x * 30 - profile.tangent.x * 18)},${finite(y + ny - profile.outwardNormal.y * 30 - profile.tangent.y * 18)} ${finite(x + nx - profile.outwardNormal.x * 30 + profile.tangent.x * 18)},${finite(y + ny - profile.outwardNormal.y * 30 + profile.tangent.y * 18)}" fill="#ff3b8d"/>
</svg>`)
}

function machineMask(profile: GuideProfile): Buffer {
  const pixels = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE * 4)
  const tangentLength = Math.hypot(profile.tangent.x, profile.tangent.y)
  const tx = profile.tangent.x / tangentLength
  const ty = profile.tangent.y / tangentLength
  const rx = profile.width / 2
  const ry = profile.depth / 2
  for (let y = 0; y < CANVAS_SIZE; y += 1) {
    for (let x = 0; x < CANVAS_SIZE; x += 1) {
      const dx = x + 0.5 - profile.origin.x
      const dy = y + 0.5 - profile.origin.y
      const along = dx * tx + dy * ty
      const across = -dx * ty + dy * tx
      if ((along * along) / (rx * rx) + (across * across) / (ry * ry) > 1) continue
      const offset = (y * CANVAS_SIZE + x) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

async function hash(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function renderInterfaceGuides(input: RenderInterfaceGuidesInput): Promise<{
  connectorIds: string[]
  guidePaths: Record<string, string>
  maskPaths: Record<string, string>
  files: InterfaceGuideFile[]
}> {
  await mkdir(input.outputRoot, { recursive: true })
  const files: InterfaceGuideFile[] = []
  for (const profile of input.profiles) {
    const stem = `${profile.assetId}-${profile.id}-${profile.role}`
    const guidePath = join(input.outputRoot, `${stem}-guide.png`)
    const maskPath = join(input.outputRoot, `${stem}-mask.png`)
    await sharp(guideSvg(profile)).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(guidePath)
    await sharp(machineMask(profile), { raw: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(maskPath)
    files.push({
      assetId: profile.assetId,
      connectorId: profile.id,
      role: profile.role,
      guidePath,
      guideSha256: await hash(guidePath),
      maskPath,
      maskSha256: await hash(maskPath),
    })
  }
  const connectorIds = [...new Set(input.profiles.map(profile => profile.id))]
  return {
    connectorIds,
    guidePaths: Object.fromEntries(connectorIds.map(id => [id, files.find(file => file.connectorId === id)!.guidePath])),
    maskPaths: Object.fromEntries(connectorIds.map(id => [id, files.find(file => file.connectorId === id)!.maskPath])),
    files,
  }
}

async function main(): Promise<void> {
  const versionIndex = process.argv.indexOf('--version')
  const rigIndex = process.argv.indexOf('--rig')
  const version = versionIndex === -1 ? undefined : process.argv[versionIndex + 1]
  const rig = rigIndex === -1 ? undefined : process.argv[rigIndex + 1]
  if (version !== '0.3.0' || rig !== 'biped') throw new Error('Usage: tsx scripts/render-interface-guides.ts --version 0.3.0 --rig biped')
  const manifestPath = join('asset-source', 'v0.3.0', 'interface-manifest.json')
  const parsed = parseInterfaceSourceManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  if (!parsed.ok) throw new Error(`INTERFACE_SOURCE_INVALID: ${JSON.stringify(parsed.diagnostics)}`)
  const idsBySlot = new Map(Object.entries(BIPED_SLICE).map(([slotId, ids]) => [slotId, new Set<string>(ids)]))
  const profiles = structuralVariants(parsed.value)
    .filter(asset => asset.rigId === 'biped' && idsBySlot.get(asset.slotId)?.has(asset.partId))
    .flatMap(asset => asset.connectors.map(profile => ({ ...profile, assetId: asset.partId })))
  const result = await renderInterfaceGuides({ outputRoot: join('asset-source', 'v0.3.0', 'guides'), rigId: 'biped', profiles })
  console.log(JSON.stringify({ rig: 'biped', guides: result.files.length, output: basename(join('asset-source', 'v0.3.0', 'guides')) }))
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) void main()
