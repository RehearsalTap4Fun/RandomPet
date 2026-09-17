import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const qa = 'docs/qa/pixel-standard-small-fangs-coverage'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const baseline = JSON.parse(await fs.readFile(path.join(root, qa, 'baseline.json'), 'utf8'))
const retainedBytes = await fs.readFile(path.join(root, qa, 'reproducibility.json'))
assert.equal(sha(retainedBytes), '0e78662ad23af676e9f7a164beb73837f42e4c2aaaa374329ec74ed9f9179fc1', 'Historical candidate reproducibility evidence changed')
const retained = JSON.parse(retainedBytes)
const snapshot = async () => {
  const files = {}
  // The historical report fixes this candidate's scope. Later release directories
  // and consumer pages must never be folded into its approval-bound evidence.
  for (const file of Object.keys(retained.files)) files[file] = sha(await fs.readFile(path.join(root, file)))
  return files
}
const before = await snapshot()
assert.deepEqual(before, retained.files, 'Historical candidate artifact drift')
for (const [file, hash] of Object.entries(baseline.files)) assert.equal(before[file], hash, `Historical artifact drift: ${file}`)
for (let run = 0; run < 2; run++) {
  for (const script of ['build-pixel-art.mjs', 'build-pixel-art-v2.mjs', 'build-pixel-art-v2-coverage.mjs', 'review-pixel-art-v2-coverage.mjs']) execFileSync(process.execPath, [`scripts/${script}`], { cwd: root, stdio: 'inherit' })
  assert.deepEqual(await snapshot(), before, `Rebuild ${run + 1} changed bytes`)
}
const report = { schemaVersion: 'pixel-coverage-reproducibility-v1', status: 'passed', runs: 2, byteIdentical: true, historicalFileCount: Object.keys(baseline.files).length, historicalByteIdentical: true, files: before }
assert.ok(Buffer.from(JSON.stringify(report, null, 2) + '\n').equals(retainedBytes), 'Historical candidate report drift')
console.log(`Reproducibility passed: ${Object.keys(before).length} files, two rebuilds; ${Object.keys(baseline.files).length} historical artifacts unchanged.`)
