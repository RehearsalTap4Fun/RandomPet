import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { Catalog } from '@qmonster/generator-core'
import {
  structuralVariants,
  type InterfaceSourceManifest,
} from './interface-source-schema.js'

export const V04_INTERFACE_FACE_ZONE_OVERLAY_SCHEMA = 'qmonster-v0.4-interface-face-zone-overlay-v1'
export const V04_INTERFACE_FACE_ZONE_OVERLAY_PATH = 'asset-source/v0.4.0/interface-face-zone-overrides.json'

export interface V04InterfaceFaceZoneOverlay {
  schemaVersion: typeof V04_INTERFACE_FACE_ZONE_OVERLAY_SCHEMA
  catalogVersion: '0.4.0'
  basedOn: {
    manifestPath: 'asset-source/v0.3.0/interface-manifest.json'
    manifestSha256: string
  }
  overrides: Array<{
    partId: 'head_shadow_hood'
    rigId: 'floating'
    baseFaceSafeZones: Array<{ x: number, y: number, width: number, height: number }>
    faceSafeZones: Array<{ x: number, y: number, width: number, height: number }>
  }>
  headOcclusionMaskOverride: {
    derivation: 'head-alpha-face-zone-promote-v1'
    node: { sourcePath: string, sourceSha256: string }
    foreground: { sourcePath: string, sourceSha256: string, targetPath: string }
    background: { sourcePath: string, sourceSha256: string, targetPath: string }
  }
}

export interface V04InterfaceFaceZoneOverlayProvenance {
  schemaVersion: typeof V04_INTERFACE_FACE_ZONE_OVERLAY_SCHEMA
  sourcePath: typeof V04_INTERFACE_FACE_ZONE_OVERLAY_PATH
  sourceSha256: string
  manifestPath: 'asset-source/v0.3.0/interface-manifest.json'
  manifestSha256: string
}

type FaceSafeZone = { x: number, y: number, width: number, height: number }
export interface V04HeadOcclusionMaskHashes {
  foregroundMaskSha256: string
  backgroundMaskSha256: string
}

export interface V04HeadOcclusionMaskDerivation extends V04HeadOcclusionMaskHashes {
  foregroundPng: Buffer
  backgroundPng: Buffer
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function faceSafeZones(value: unknown): FaceSafeZone[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const parsed: FaceSafeZone[] = []
  for (const item of value) {
    const zone = record(item)
    const x = zone?.x
    const y = zone?.y
    const width = zone?.width
    const height = zone?.height
    if (
      zone === null
      || typeof x !== 'number' || typeof y !== 'number'
      || typeof width !== 'number' || typeof height !== 'number'
      || !Number.isFinite(x) || !Number.isFinite(y)
      || !Number.isFinite(width) || !Number.isFinite(height)
      || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > 2048 || y + height > 2048
    ) return null
    parsed.push({ x, y, width, height })
  }
  return parsed
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function decodeRgba(bytes: Uint8Array): Promise<{ data: Buffer, width: number, height: number }> {
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height }
}

/**
 * Deterministically promotes the approved face rectangle into the head foreground
 * split. The v0.3 source masks remain untouched; only the staged v0.4 copies are
 * derived from their exact SHA-attested bytes.
 */
export async function deriveV04HeadOcclusionMaskOverride(
  overlay: V04InterfaceFaceZoneOverlay,
  readSource: (path: string) => Promise<Buffer>,
): Promise<V04HeadOcclusionMaskDerivation> {
  const [nodeBytes, sourceForegroundBytes, sourceBackgroundBytes] = await Promise.all([
    readSource(overlay.headOcclusionMaskOverride.node.sourcePath),
    readSource(overlay.headOcclusionMaskOverride.foreground.sourcePath),
    readSource(overlay.headOcclusionMaskOverride.background.sourcePath),
  ])
  if (
    digest(nodeBytes) !== overlay.headOcclusionMaskOverride.node.sourceSha256
    || digest(sourceForegroundBytes) !== overlay.headOcclusionMaskOverride.foreground.sourceSha256
    || digest(sourceBackgroundBytes) !== overlay.headOcclusionMaskOverride.background.sourceSha256
  ) throw new Error('V04_INTERFACE_FACE_ZONE_OVERLAY_MASK_SOURCE_HASH_INVALID')

  const [node, foreground, background] = await Promise.all([
    decodeRgba(nodeBytes), decodeRgba(sourceForegroundBytes), decodeRgba(sourceBackgroundBytes),
  ])
  if (
    node.width !== foreground.width || node.height !== foreground.height
    || node.width !== background.width || node.height !== background.height
  ) throw new Error('V04_INTERFACE_FACE_ZONE_OVERLAY_MASK_DIMENSIONS_INVALID')

  const zone = overlay.overrides[0]!.faceSafeZones[0]!
  const foregroundOutput = Buffer.alloc(node.data.length)
  const backgroundOutput = Buffer.alloc(node.data.length)
  for (let y = 0; y < node.height; y += 1) for (let x = 0; x < node.width; x += 1) {
    const index = (y * node.width + x) * 4
    const nodeAlpha = node.data[index + 3]!
    const promote = nodeAlpha > 0
      && x >= zone.x && x < zone.x + zone.width
      && y >= zone.y && y < zone.y + zone.height
    const foregroundAlpha = promote ? 255 : foreground.data[index + 3]!
    const backgroundAlpha = promote ? 0 : background.data[index + 3]!
    for (const output of [foregroundOutput, backgroundOutput]) {
      output[index] = 255
      output[index + 1] = 255
      output[index + 2] = 255
    }
    foregroundOutput[index + 3] = foregroundAlpha
    backgroundOutput[index + 3] = backgroundAlpha
  }
  const [foregroundPng, backgroundPng] = await Promise.all([
    sharp(foregroundOutput, { raw: { width: node.width, height: node.height, channels: 4 } }).png().toBuffer(),
    sharp(backgroundOutput, { raw: { width: node.width, height: node.height, channels: 4 } }).png().toBuffer(),
  ])
  return {
    foregroundPng,
    backgroundPng,
    foregroundMaskSha256: digest(foregroundPng),
    backgroundMaskSha256: digest(backgroundPng),
  }
}

export function parseV04InterfaceFaceZoneOverlay(
  input: unknown,
  manifest: InterfaceSourceManifest,
  manifestSha256: string,
): V04InterfaceFaceZoneOverlay {
  const document = record(input)
  const basedOn = document === null ? null : record(document.basedOn)
  if (
    document === null
    || document.schemaVersion !== V04_INTERFACE_FACE_ZONE_OVERLAY_SCHEMA
    || document.catalogVersion !== '0.4.0'
    || basedOn === null
    || basedOn.manifestPath !== 'asset-source/v0.3.0/interface-manifest.json'
    || basedOn.manifestSha256 !== manifestSha256
    || !sha256(basedOn.manifestSha256)
    || !Array.isArray(document.overrides)
    || document.overrides.length !== 1
  ) throw new Error('V04_INTERFACE_FACE_ZONE_OVERLAY_DOCUMENT_INVALID')

  const rawOverride = record(document.overrides[0])
  const headOcclusionMaskOverride = document === null ? null : record(document.headOcclusionMaskOverride)
  const expectedBase = structuralVariants(manifest).find(variant => (
    variant.partId === 'head_shadow_hood' && variant.rigId === 'floating' && variant.slotId === 'headShape'
  ))
  const baseFaceSafeZones = rawOverride === null ? null : faceSafeZones(rawOverride.baseFaceSafeZones)
  const replacementFaceSafeZones = rawOverride === null ? null : faceSafeZones(rawOverride.faceSafeZones)
  if (
    rawOverride === null
    || rawOverride.partId !== 'head_shadow_hood'
    || rawOverride.rigId !== 'floating'
    || expectedBase === undefined
    || baseFaceSafeZones === null
    || replacementFaceSafeZones === null
    || !sameJson(baseFaceSafeZones, expectedBase.faceSafeZones)
    || sameJson(baseFaceSafeZones, replacementFaceSafeZones)
    || headOcclusionMaskOverride === null
    || headOcclusionMaskOverride.derivation !== 'head-alpha-face-zone-promote-v1'
    || !sameJson(headOcclusionMaskOverride.node, {
      sourcePath: 'assets/v0.3.0/structural/floating/task7-natural-neck/nodes/head_shadow_hood/neck.png',
      sourceSha256: '33dd458c8039f1775499696807e7ceb37ad7684166e2d5a14639168f9198bcda',
    })
    || !sameJson(headOcclusionMaskOverride.foreground, {
      sourcePath: 'assets/v0.3.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-foreground.png',
      sourceSha256: '1aab57d718754a94b00b2d6c1b49014bcad76dda9e285a1ade2b11ef460a9914',
      targetPath: 'assets/v0.4.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-foreground.png',
    })
    || !sameJson(headOcclusionMaskOverride.background, {
      sourcePath: 'assets/v0.3.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-background.png',
      sourceSha256: 'a6f5b0c96020d44e9cb989dfc5a4858bbe699195983982781c6292d7e7579b25',
      targetPath: 'assets/v0.4.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-background.png',
    })
  ) throw new Error('V04_INTERFACE_FACE_ZONE_OVERLAY_SCOPE_INVALID')

  return {
    schemaVersion: V04_INTERFACE_FACE_ZONE_OVERLAY_SCHEMA,
    catalogVersion: '0.4.0',
    basedOn: {
      manifestPath: 'asset-source/v0.3.0/interface-manifest.json',
      manifestSha256,
    },
    overrides: [{
      partId: 'head_shadow_hood',
      rigId: 'floating',
      baseFaceSafeZones,
      faceSafeZones: replacementFaceSafeZones,
    }],
    headOcclusionMaskOverride: {
      derivation: 'head-alpha-face-zone-promote-v1',
      node: structuredClone(headOcclusionMaskOverride.node) as { sourcePath: string, sourceSha256: string },
      foreground: structuredClone(headOcclusionMaskOverride.foreground) as { sourcePath: string, sourceSha256: string, targetPath: string },
      background: structuredClone(headOcclusionMaskOverride.background) as { sourcePath: string, sourceSha256: string, targetPath: string },
    },
  }
}

export function v04InterfaceFaceZoneOverlayProvenance(
  overlay: V04InterfaceFaceZoneOverlay,
  sourceSha256: string,
): V04InterfaceFaceZoneOverlayProvenance {
  if (!sha256(sourceSha256)) throw new Error('V04_INTERFACE_FACE_ZONE_OVERLAY_SOURCE_HASH_INVALID')
  return {
    schemaVersion: V04_INTERFACE_FACE_ZONE_OVERLAY_SCHEMA,
    sourcePath: V04_INTERFACE_FACE_ZONE_OVERLAY_PATH,
    sourceSha256,
    manifestPath: overlay.basedOn.manifestPath,
    manifestSha256: overlay.basedOn.manifestSha256,
  }
}

export function applyV04InterfaceFaceZoneOverlayToCatalog(
  catalog: Catalog,
  overlay: V04InterfaceFaceZoneOverlay,
  maskHashes?: V04HeadOcclusionMaskHashes,
): Catalog {
  const result = structuredClone(catalog)
  for (const override of overlay.overrides) {
    const part = result.parts.find(candidate => candidate.id === override.partId)
    const variant = part?.composition?.mode === 'interface'
      ? part.composition.variantsByRig[override.rigId]
      : undefined
    if (part?.slotId !== 'headShape' || variant === undefined) {
      throw new Error(`V04_INTERFACE_FACE_ZONE_OVERLAY_TARGET_MISSING:${override.partId}:${override.rigId}`)
    }
    variant.faceSafeZones = structuredClone(override.faceSafeZones)
    if (maskHashes !== undefined) {
      const connector = variant.connectors.find(candidate => candidate.id === 'neck' && candidate.role === 'plug')
      if (connector === undefined) throw new Error(`V04_INTERFACE_FACE_ZONE_OVERLAY_CONNECTOR_MISSING:${override.partId}:${override.rigId}`)
      connector.foregroundMaskSha256 = maskHashes.foregroundMaskSha256
      connector.backgroundMaskSha256 = maskHashes.backgroundMaskSha256
    }
  }
  return result
}

export function applyV04InterfaceFaceZoneOverlayToManifest(
  manifest: InterfaceSourceManifest,
  overlay: V04InterfaceFaceZoneOverlay,
): InterfaceSourceManifest {
  const result = structuredClone(manifest)
  for (const override of overlay.overrides) {
    let matched = false
    for (const asset of result.assets) {
      if (asset.id !== override.partId || asset.slotId !== 'headShape') continue
      const variants = 'variants' in asset ? asset.variants : [asset]
      for (const variant of variants) {
        if (variant.rigId !== override.rigId) continue
        variant.faceSafeZones = structuredClone(override.faceSafeZones)
        matched = true
      }
    }
    if (!matched) throw new Error(`V04_INTERFACE_FACE_ZONE_OVERLAY_TARGET_MISSING:${override.partId}:${override.rigId}`)
  }
  return result
}
