import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('v0.2 source-only tools', () => {
  it.each(['create-guides.ts', 'vertical-render.ts'])('%s never references the legacy v0.1 tree', async file => {
    const source = await readFile(`asset-source/v0.2.0/${file}`, 'utf8')

    expect(source).not.toContain('v0.1.0')
    expect(source).toContain('v0.2.0')
  })
})
