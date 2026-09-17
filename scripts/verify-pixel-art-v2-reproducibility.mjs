import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const root = path.resolve(import.meta.dirname, '..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const historical = JSON.parse(await fs.readFile(path.join(root, 'docs/qa/flat-source-trial/stage3/reproducibility.json'), 'utf8'))
const snapshot = async () => {
  const files = {}
  async function walk(directory) {
    for (const entry of (await fs.readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${directory}/${entry.name}`
      if (entry.isDirectory()) await walk(relative)
      else files[relative] = sha(await fs.readFile(path.join(root, relative)))
    }
  }
  for (const directory of ['packages/asset-catalog/pixel/v2', 'dist/pixel-art/v2-candidate', 'dist/pixel-art/v2-approved']) await walk(directory)
  return files
}
const before = await snapshot()
for (const [file, hash] of Object.entries(historical.files)) assert.equal(before[file], hash, `Historical candidate drift: ${file}`)
const runs = []
for (let run = 0; run < 2; run++) {
  execFileSync(process.execPath, ['scripts/build-pixel-art-v2.mjs'], { cwd: root, stdio: 'inherit' })
  runs.push(await snapshot())
}
assert.deepEqual(runs[0], before, 'First rebuild changed release bytes')
assert.deepEqual(runs[1], runs[0], 'Second rebuild changed release bytes')
const catalog = JSON.parse(await fs.readFile(path.join(root, 'packages/asset-catalog/pixel/v2/catalog.approved.json'), 'utf8'))
const report = { schemaVersion: 'pixel-art-v2-promotion-reproducibility-v1', artVersion: catalog.artVersion, catalogRevision: catalog.revision,
  runs: 2, byteIdentical: true, candidateByteIdentical: true, candidateRevision: historical.catalogRevision, files: runs[1] }
await fs.writeFile(path.join(root, 'docs/qa/flat-source-trial/stage3/reproducibility-approved.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`Reproducibility passed: ${Object.keys(report.files).length} files, two builds, candidate bytes unchanged.`)
