import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const result = await build({ root: path.join(root, 'apps/creator-web'), configFile: path.join(root, 'apps/creator-web/vite.config.ts'),
  logLevel: 'silent', build: { write: false, emptyOutDir: false } })
const chunks = result.output.filter(item => item.type === 'chunk')
const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]))
const entry = chunks.find(chunk => chunk.isEntry)
assert.ok(entry, 'A browser entry must be emitted')
function staticGraph(chunk, found = new Set()) {
  if (found.has(chunk.fileName)) return found
  found.add(chunk.fileName)
  for (const dependency of chunk.imports) if (byFile.has(dependency)) staticGraph(byFile.get(dependency), found)
  return found
}
const startup = staticGraph(entry)
for (const name of ['pixel-workbench.tsx', 'feline-workbench.tsx']) {
  const route = chunks.find(chunk => Object.keys(chunk.modules).some(file => file.replaceAll('\\', '/').endsWith(`/src/${name}`)))
  assert.ok(route, `${name} must be included in the build`)
  assert.ok(!startup.has(route.fileName), `${name} must load only after its route is selected`)
}
for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk.code) < 500_000, `${chunk.fileName} exceeds the 500 kB chunk budget`)
console.log(JSON.stringify({ passed: true, startupJsBytes: [...startup].reduce((sum, file) => sum + Buffer.byteLength(byFile.get(file).code), 0),
  chunks: chunks.map(chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), startup: startup.has(chunk.fileName) })) }, null, 2))
