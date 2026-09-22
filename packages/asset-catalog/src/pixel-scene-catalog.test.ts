import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import {
  requirePixelSceneCatalogV1,
  requireSceneSubjectCompatibility,
  resolveBackdrop,
  verifyPixelSceneCatalogV1,
} from './pixel-scene-catalog.js'

const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

function validCatalog() {
  const content = {
    schemaVersion: 'pixel-scene-catalog-v1',
    sceneVersion: '1.0.0-candidate.1',
    rendererVersion: 'pixel-scene-rgba-v1',
    canvas: { width: 96, height: 64 },
    subject: {
      schemaVersion: 'feline-phenotype-v2',
      catalogSchemaVersion: 'pixel-art-catalog-v3',
      rendererVersion: 'pixel-rgba-v1',
      width: 64,
      height: 64,
      anchor: { x: 16, y: 0 },
    },
    outline: {
      owner: 'scene-renderer', neighborhood: 'four', width: 1,
      color: 'adjacent-mean-darken', factor: 0.36,
    },
    resources: {
      'scene-a': { path: 'assets/a.png', sha256: 'a'.repeat(64), width: 96, height: 64 },
      'scene-b': { path: 'assets/b.png', sha256: 'b'.repeat(64), width: 96, height: 64 },
      'scene-c': { path: 'assets/c.png', sha256: 'c'.repeat(64), width: 96, height: 64 },
    },
    backdrops: {
      'doodle-horizon': { resourceId: 'scene-a', rarity: 'N', growthRank: 1, review: 'pending' },
      'doodle-leaf-shadow': { resourceId: 'scene-b', rarity: 'R', growthRank: 2, review: 'pending' },
      'doodle-rainbow-trail': { resourceId: 'scene-c', rarity: 'L', growthRank: 3, review: 'pending' },
    },
    growth: { slot: 'backdrop', order: ['doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'] },
    validatedSubject: { artVersion: '1.6.1', revision: 'd'.repeat(64) },
    generatable: [],
    evidence: { 'docs/qa/approval.json': 'e'.repeat(64) },
  }
  return { ...content, revision: sha(canonicalJson(content)) }
}

describe('pixel-scene-catalog-v1', () => {
  it('validates references, growth order and candidate review state', async () => {
    const catalog = await verifyPixelSceneCatalogV1(validCatalog())
    expect(catalog.canvas).toEqual({ width: 96, height: 64 })
    expect(catalog.growth.order).toEqual(['doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'])
    expect(resolveBackdrop({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' }, catalog)).toBeNull()
    expect(resolveBackdrop({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'doodle-horizon' }, catalog)?.resourceId).toBe('scene-a')
  })

  it.each([
    (catalog: any) => { catalog.canvas.width = 64 },
    (catalog: any) => { catalog.subject.anchor.x = 0 },
    (catalog: any) => { catalog.outline.factor = 0.5 },
    (catalog: any) => { catalog.growth.order.reverse() },
    (catalog: any) => { catalog.backdrops['doodle-horizon'].resourceId = 'missing' },
    (catalog: any) => { catalog.generatable = ['doodle-horizon'] },
  ])('rejects invalid scene contracts', mutate => {
    const input = validCatalog()
    mutate(input)
    expect(() => requirePixelSceneCatalogV1(input)).toThrow()
  })

  it('accepts compatible future art and rejects incompatible subject contracts', () => {
    const scene = requirePixelSceneCatalogV1(validCatalog())
    expect(() => requireSceneSubjectCompatibility(scene, {
      schemaVersion: 'pixel-art-catalog-v3', rendererVersion: 'pixel-rgba-v1', size: 64,
      artVersion: '2.0.0', revision: 'f'.repeat(64),
    })).not.toThrow()
    for (const subject of [
      { schemaVersion: 'pixel-art-catalog-v2', rendererVersion: 'pixel-rgba-v1', size: 64 },
      { schemaVersion: 'pixel-art-catalog-v3', rendererVersion: 'pixel-rgba-v2', size: 64 },
      { schemaVersion: 'pixel-art-catalog-v3', rendererVersion: 'pixel-rgba-v1', size: 96 },
    ]) expect(() => requireSceneSubjectCompatibility(scene, subject as any)).toThrow(/subject/i)
  })

  it('rejects duplicate resource mappings and changed revisions', async () => {
    const duplicate = validCatalog()
    duplicate.backdrops['doodle-rainbow-trail'].resourceId = 'scene-a'
    expect(() => requirePixelSceneCatalogV1(duplicate)).toThrow(/duplicate/i)
    const changed = validCatalog()
    changed.sceneVersion = '1.0.1-candidate.1'
    await expect(verifyPixelSceneCatalogV1(changed)).rejects.toThrow(/revision/i)
  })
})
