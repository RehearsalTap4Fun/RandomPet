import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { BACKDROP_DEFINITIONS, renderBackdrop, validateBackdrop } from './lib/pixel-backdrop-art.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'docs/qa/pixel-backdrop-batch/layers')

await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })

for (const definition of BACKDROP_DEFINITIONS) {
  const pixels = renderBackdrop(definition)
  validateBackdrop(definition, pixels)
  await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } })
    .png({ palette: true, colours: 16, dither: 0 })
    .toFile(path.join(output, `${definition.id}.png`))
}

console.log(`Built ${BACKDROP_DEFINITIONS.length} pixel backdrops in docs/qa/pixel-backdrop-batch/layers`)
