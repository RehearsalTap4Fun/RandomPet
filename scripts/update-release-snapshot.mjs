import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
const root = path.resolve(import.meta.dirname, '..')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const catalogFile = 'packages/asset-catalog/catalog/v0.10.0/catalog.json'
const catalogBytes = await fs.readFile(path.join(root, catalogFile))
const catalog = JSON.parse(catalogBytes)
const sources = [catalogFile, 'package-lock.json', 'docs/releases/v0.10.0/previous-snapshot.json', 'docs/releases/v0.10.0/mutation-batch1/previous-snapshot.json']
sources.push('docs/releases/v0.10.0/mutation-batch1/review-snapshot.json', 'docs/releases/v0.10.0/mutation-batch1/approval.json')
sources.push('docs/releases/v0.10.0/body-batch1/previous-snapshot.json')
sources.push('docs/releases/v0.10.0/body-batch1/mane-fix-previous-snapshot.json')
for (const name of ['generator-core', 'asset-catalog', 'renderer-canvas', 'incubator-adapter']) {
  const directory = `packages/${name}/src`
  for (const file of await fs.readdir(path.join(root, directory))) {
    if (/\.(ts|json)$/.test(file) && !file.endsWith('.test.ts')) sources.push(`${directory}/${file}`)
  }
}
const sourceHashes = {}
for (const file of sources.sort()) sourceHashes[file] = digest(await fs.readFile(path.join(root, file)))
const snapshot = {
  schemaVersion: 'qmonster-feline-integration-snapshot-v1',
  releaseDirectory: 'v0.10.0', catalogVersion: catalog.catalogVersion, templateVersion: catalog.templateVersion,
  catalogFile, catalogSha256: digest(catalogBytes), runtimeRevision: digest(JSON.stringify(sourceHashes)), sourceHashes,
  resources: Object.values(catalog.resources).map(({ id, path, sha256 }) => ({ id, path, sha256 })),
  migrationRecord: 'docs/releases/v0.10.0/migration.json',
}
await fs.writeFile(path.join(root, 'docs/integration/feline-combination-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n')
console.log(`Pinned ${snapshot.resources.length} resources; runtime ${snapshot.runtimeRevision}`)
