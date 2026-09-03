import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseInterfaceSourceManifest } from './interface-source-schema.js'

describe('interface source manifest versions', () => {
  it('accepts a complete v0.5 interface manifest with v0.5 runtime and source paths', async () => {
    const v03Manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8'))
    const v05Manifest = JSON.parse(JSON.stringify(v03Manifest).replaceAll('v0.3.0', 'v0.5.0'))
    v05Manifest.catalogVersion = '0.5.0'

    const parsed = parseInterfaceSourceManifest(v05Manifest)

    expect(parsed).toMatchObject({ ok: true })
    if (parsed.ok) expect(parsed.value.catalogVersion).toBe('0.5.0')
  })
})
