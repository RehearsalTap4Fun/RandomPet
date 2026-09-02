import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { parseInterfaceSourceManifest } from './interface-source-schema.js'
import { parseV04InterfaceFaceZoneOverlay } from './v04-interface-face-zone-overlay.js'

const ROOT = process.cwd()
const MANIFEST_PATH = resolve(ROOT, 'asset-source/v0.3.0/interface-manifest.json')
const OVERLAY_PATH = resolve(ROOT, 'asset-source/v0.4.0/interface-face-zone-overrides.json')

test('rejects an alternate in-bounds face rectangle instead of widening the approved v0.4 override scope', async () => {
  const manifestBytes = await readFile(MANIFEST_PATH)
  const parsedManifest = parseInterfaceSourceManifest(JSON.parse(manifestBytes.toString('utf8')))
  if (!parsedManifest.ok) throw new Error(`Invalid immutable interface manifest: ${JSON.stringify(parsedManifest.diagnostics)}`)
  const overlay = JSON.parse(await readFile(OVERLAY_PATH, 'utf8')) as {
    overrides: Array<{ faceSafeZones: Array<{ x: number, y: number, width: number, height: number }> }>
  }
  overlay.overrides[0]!.faceSafeZones = [{ x: 800, y: 1050, width: 448, height: 325 }]

  expect(() => parseV04InterfaceFaceZoneOverlay(
    overlay,
    parsedManifest.value,
    createHash('sha256').update(manifestBytes).digest('hex'),
  )).toThrow('V04_INTERFACE_FACE_ZONE_OVERLAY_SCOPE_INVALID')
})
