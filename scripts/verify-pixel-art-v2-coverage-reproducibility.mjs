import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const qa = 'docs/qa/pixel-standard-small-fangs-coverage'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const baseline = JSON.parse(await fs.readFile(path.join(root, qa, 'baseline.json'), 'utf8'))
const snapshot = async () => {
  const files = {}
  async function walk(directory) {
    for (const entry of (await fs.readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${directory}/${entry.name}`
      if (entry.isDirectory()) await walk(relative)
      else files[relative] = sha(await fs.readFile(path.join(root, relative)))
    }
  }
  for (const directory of ['packages/asset-catalog/pixel/v1', 'packages/asset-catalog/pixel/v2', 'dist/pixel-art', `${qa}/renders`]) await walk(directory)
  for (const file of [`${qa}/report.json`, `${qa}/gallery.html`]) files[file] = sha(await fs.readFile(path.join(root, file)))
  return files
}
const before = await snapshot()
for (const [file, hash] of Object.entries(baseline.files)) assert.equal(before[file], hash, `Historical artifact drift: ${file}`)
for (let run = 0; run < 2; run++) {
  for (const script of ['build-pixel-art.mjs', 'build-pixel-art-v2.mjs', 'build-pixel-art-v2-coverage.mjs', 'review-pixel-art-v2-coverage.mjs']) execFileSync(process.execPath, [`scripts/${script}`], { cwd: root, stdio: 'inherit' })
  assert.deepEqual(await snapshot(), before, `Rebuild ${run + 1} changed bytes`)
}
const report = { schemaVersion: 'pixel-coverage-reproducibility-v1', status: 'passed', runs: 2, byteIdentical: true, historicalFileCount: Object.keys(baseline.files).length, historicalByteIdentical: true, files: before }
await fs.writeFile(path.join(root, qa, 'reproducibility.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`Reproducibility passed: ${Object.keys(before).length} files, two rebuilds; ${Object.keys(baseline.files).length} historical artifacts unchanged.`)
