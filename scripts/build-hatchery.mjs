import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
const root = path.resolve(import.meta.dirname, '..')
const snapshot = JSON.parse(await fs.readFile(path.join(root, 'docs/integration/feline-combination-snapshot.json'), 'utf8'))
for (const [file, expected] of Object.entries(snapshot.sourceHashes)) {
  const hash = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')
  assert.equal(hash, expected, `Snapshot changed: ${file}. Review and update the snapshot explicitly.`)
}
const output = path.join(root, 'dist/hatchery')
for (const resource of snapshot.resources) {
  assert.equal(createHash('sha256').update(await fs.readFile(path.join(root, resource.path))).digest('hex'), resource.sha256, resource.id)
}
await fs.mkdir(output, { recursive: true })
await build({ absWorkingDir: root, entryPoints: ['packages/incubator-adapter/src/index.ts'], outfile: path.join(output, 'qmonster.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true })
for (const file of [snapshot.catalogFile, ...snapshot.resources.map(resource => resource.path)]) {
  const destination = path.join(output, file)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(path.join(root, file), destination)
}
await fs.copyFile(path.join(root, 'docs/integration/feline-combination-snapshot.json'), path.join(output, 'snapshot.json'))
console.log(`Built dist/hatchery: qmonster.js, snapshot.json, catalog and ${snapshot.resources.length} PNG resources.`)
