import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleV06Catalog } from './assemble-v06-catalog.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('assemble v0.6 feline anatomy catalog', () => {
  it('emits eight complete-cat bundles with body resource binding and source-free derived slots', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-anatomy-catalog-'))
    roots.push(stagedRoot)
    const catalog = await assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot })
    expect(catalog.anatomyBundles).toHaveLength(8)
    expect(catalog.transitionBridges).toBeUndefined()
    expect(JSON.stringify(catalog)).not.toContain('connectors/')
    for (const bundle of catalog.anatomyBundles!) {
      const body = catalog.parts.find(part => part.id === bundle.derivedSlots.bodyFrame)!
      expect(body.composition).toMatchObject({ mode: 'bundle', bundleId: bundle.id })
      expect(body.pngPath).toBe(bundle.structural.pngPath)
      expect(body.pngSha256).toBe(bundle.structural.pngSha256)
      for (const slot of ['headShape', 'arms', 'legs', 'tail', 'extraAppendage'] as const) {
        const derived = catalog.parts.find(part => part.id === bundle.derivedSlots[slot])!
        expect(derived.assetPath).toBe('')
        expect(derived.composition).toMatchObject({ mode: 'bundle', bundleId: bundle.id, isNone: true })
      }
    }
  }, 120_000)
})
