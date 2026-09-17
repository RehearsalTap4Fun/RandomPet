import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { buildHatcheryBundle } from './build-hatchery.mjs'

const root = path.resolve(import.meta.dirname, '..')
export async function verifyHatcheryBundle() {
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'docs/integration/feline-combination-snapshot.json')))
  const bundle = await buildHatcheryBundle(snapshot)
  const inputs = Object.keys(bundle.metafile.inputs).map(file => file.replaceAll('\\', '/'))
    .filter(file => file.startsWith('packages/')).sort()
  assert.deepEqual(inputs.filter(file => !(file in snapshot.sourceHashes)), [], 'Every local runtime input must be snapshot-pinned')
  assert.deepEqual(inputs.filter(file => /\/(feline-phenotype|pixel-art-catalog)(-v2)?\.ts$/.test(file)), [],
    'Legacy SDK must not include pixel schemas')
  assert.deepEqual(Object.values(bundle.metafile.outputs)[0].exports,
    ['createFelineHatchery', 'generateFelineCombination', 'mutationSelectionsFromList', 'parseFelineCombinationSpec'],
    'Legacy SDK public exports remain available')
  // Removing a real transitive dependency must fail the production gate even though
  // all remaining snapshot hashes still match. Do not alter the checked-in snapshot.
  const incomplete = structuredClone(snapshot)
  delete incomplete.sourceHashes['packages/generator-core/src/prng.ts']
  await assert.rejects(() => buildHatcheryBundle(incomplete),
    /Unpinned hatchery runtime inputs:\n  packages\/generator-core\/src\/prng\.ts/)
  const repeated = await buildHatcheryBundle(snapshot)
  assert.deepEqual(bundle.outputFiles[0].contents, repeated.outputFiles[0].contents, 'Repeated SDK builds must be byte-identical')
  assert.deepEqual(Buffer.from(bundle.outputFiles[0].contents), await fs.readFile(path.join(root, 'dist/hatchery/qmonster.js')),
    'Packaged SDK must match the verified build')
  return { localInputs: inputs, bundleSha256: createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex'),
    checks: ['all local runtime inputs pinned', 'pixel schemas excluded', 'legacy exports preserved',
      'unpinned transitive dependency rejected', 'repeated builds byte-identical', 'packaged SDK matches verified build'] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyHatcheryBundle(), null, 2))
}
