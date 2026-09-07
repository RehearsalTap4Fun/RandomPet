import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ANATOMY_BUNDLE_SOURCES, assembleV06Catalog } from './assemble-v06-catalog.js'
import type { AnatomyBundleSource } from './prepare-v06-anatomy-bundles.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const exactFinalPrompt = (primaryRequest: string): string => [
  'Use case: stylized-concept',
  'Asset type: 2048x2048 game anatomy bundle source',
  `Primary request: ${primaryRequest}`,
  'Scene/backdrop: genuinely transparent background.',
  'Composition/framing: centered full silhouette with generous transparent margin, entirely in canvas.',
  'Constraints: exactly one continuous cat silhouette; no separate parts; no props, floor, shadow, text, watermark, extra limbs, duplicate head, wings, fish tail, fan tail, cropped body.',
].join('\n')
const expectedFinalPrompts: Record<string, string> = {
  'feline-sit-saffron-longtail': exactFinalPrompt('one complete front-facing seated feline, from head and two ears through neck and torso into exactly four paws and one conventional long curved cat tail, saffron orange with cream muzzle, friendly bright 3D plush-toy style.'),
  'feline-sit-silver-curl': exactFinalPrompt('one complete front-facing seated feline, head with two rounded triangular ears continuous through neck and torso to four paws and exactly one naturally curled C-shaped cat tail, soft silver gray and pale lavender accents, bright friendly 3D plush-toy style.'),
  'feline-sit-midnight-longtail': exactFinalPrompt('one complete front-facing seated feline, small pointed ears, head and neck continuous into a compact torso, four clear paws and exactly one conventional long sweeping cat tail, midnight navy with tiny teal inner-ear color, friendly bright 3D plush-toy style.'),
  'feline-sit-moss-curl': exactFinalPrompt('one complete front-facing seated feline, modest fluffy cheek tufts and two ears, continuous head neck torso, exactly four paws and one conventional curled cat tail, moss green plush fur with warm amber belly accent, friendly bright 3D plush-toy style.'),
  'feline-sit-rose-longtail': exactFinalPrompt('one complete front-facing seated feline with broad soft ears, head and neck visibly continuous into a rounded torso, four paws and exactly one conventional long gently hooked cat tail, dusty rose and cream plush fabric, friendly bright 3D plush-toy style.'),
  'feline-sit-umber-curl': exactFinalPrompt('one complete front-facing seated feline with small lynx-like ear tufts attached to its head, a continuous neck and torso, four paws and exactly one conventional curled cat tail, warm umber brown with creamy chest, friendly bright 3D plush-toy style.'),
  'feline-sit-ivory-longtail': exactFinalPrompt('one complete front-facing seated feline, tall triangular ears, head through neck continuous into torso, exactly four paws and one conventional long curved cat tail, ivory plush fur with coral pink ears and paws, friendly bright 3D plush-toy style.'),
  'feline-sit-violet-curl': exactFinalPrompt('one complete front-facing seated feline, rounded cat ears and a small fluffy forehead tuft, head neck torso all continuous, exactly four paws and one conventional curled cat tail, violet and smoky plum plush texture, friendly bright 3D plush-toy style.'),
}

describe('assemble v0.6 feline anatomy catalog', () => {
  it('emits eight complete-cat bundles with body resource binding and source-free derived slots', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-anatomy-catalog-'))
    roots.push(stagedRoot)
    const catalog = await assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot })
    expect(catalog.anatomyBundles).toHaveLength(8)
    expect(catalog.anatomyBundles!.map(bundle => [bundle.id, bundle.rarity])).toEqual([
      ['feline-sit-saffron-longtail', 'N'],
      ['feline-sit-silver-curl', 'N'],
      ['feline-sit-midnight-longtail', 'N'],
      ['feline-sit-moss-curl', 'N'],
      ['feline-sit-rose-longtail', 'R'],
      ['feline-sit-umber-curl', 'R'],
      ['feline-sit-ivory-longtail', 'N'],
      ['feline-sit-violet-curl', 'L'],
    ])
    expect(catalog.anatomyBundles!.every(bundle => bundle.baseWeight === 1)).toBe(true)
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

  it('preserves each generated source final prompt in the anatomy manifest', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-anatomy-prompts-'))
    roots.push(stagedRoot)
    await assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot })
    const manifest = JSON.parse(await readFile(join(
      stagedRoot, 'asset-source', 'v0.6.0', 'anatomy-bundles', 'manifest.json',
    ), 'utf8'))

    expect(manifest.bundles.map((bundle: { id: string, prompt: string }) => ({
      id: bundle.id,
      prompt: bundle.prompt,
    }))).toEqual(ANATOMY_BUNDLE_SOURCES.map(source => ({
      id: source.id,
      prompt: (source as AnatomyBundleSource & { prompt?: string }).prompt,
    })))
    expect(Object.fromEntries(ANATOMY_BUNDLE_SOURCES.map(source => [source.id, source.prompt]))).toEqual(expectedFinalPrompts)
    expect(manifest.bundles.find((bundle: { id: string }) => bundle.id === 'feline-sit-violet-curl')?.rarity).toBe('L')
  }, 120_000)
})
