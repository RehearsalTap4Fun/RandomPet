import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const outputDirectory = fileURLToPath(new URL(
  '../apps/creator-web/public/render-fixtures/assets/',
  import.meta.url,
))

const pngOptions = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
} as const

function svg(width: number, height: number, body: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  )
}

async function compositePng(
  name: string,
  width: number,
  height: number,
  layers: sharp.OverlayOptions[],
): Promise<void> {
  await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
    .composite(layers)
    .png(pngOptions)
    .toFile(`${outputDirectory}/${name}`)
}

await mkdir(outputDirectory, { recursive: true })

await compositePng('transparent.png', 1, 1, [])

await compositePng('base.png', 640, 720, [{
  input: svg(640, 720, [
    '<ellipse cx="320" cy="390" rx="272" ry="300" fill="#31586f"/>',
    '<ellipse cx="250" cy="275" rx="118" ry="146" fill="#416f86"/>',
    '<ellipse cx="390" cy="265" rx="132" ry="158" fill="#416f86"/>',
    '<ellipse cx="220" cy="535" rx="74" ry="46" fill="#25495f"/>',
    '<ellipse cx="420" cy="535" rx="74" ry="46" fill="#25495f"/>',
  ].join('')),
}])

await compositePng('rear-appendage-source.png', 480, 360, [{
  input: svg(480, 360, [
  '<path d="M36 180 C116 36 330 44 446 180 C330 316 116 324 36 180Z" fill="#ffcf5a"/>',
  '<path d="M54 180 C150 132 260 116 404 180 C260 244 150 228 54 180Z" fill="#e98d3f"/>',
  '<circle cx="392" cy="180" r="24" fill="#5a315e"/>',
  ].join('')),
}])

await compositePng('surface.png', 640, 720, [{
  input: svg(640, 720, [
    '<path d="M128 420 C190 350 450 350 512 420" fill="none" stroke="#ffffff" stroke-opacity="0.42" stroke-width="18" stroke-linecap="round"/>',
    '<circle cx="205" cy="475" r="18" fill="#ffffff" fill-opacity="0.48"/>',
    '<circle cx="438" cy="472" r="13" fill="#ffffff" fill-opacity="0.48"/>',
  ].join('')),
}])

await compositePng('surface-mask-primary.png', 640, 720, [{
  input: svg(640, 720, [
    '<path d="M102 344 C166 208 474 208 538 344 C486 326 450 350 410 332 C366 312 350 278 320 278 C290 278 274 312 230 332 C190 350 154 326 102 344Z" fill="#ffffff" fill-opacity="0.82"/>',
    '<circle cx="166" cy="408" r="28" fill="#ffffff" fill-opacity="0.72"/>',
    '<circle cx="478" cy="410" r="24" fill="#ffffff" fill-opacity="0.72"/>',
  ].join('')),
}])

await compositePng('eyes.png', 320, 160, [{
  input: svg(320, 160, [
    '<ellipse cx="92" cy="80" rx="62" ry="70" fill="#f8fbff" stroke="#203746" stroke-width="12"/>',
    '<ellipse cx="228" cy="80" rx="62" ry="70" fill="#f8fbff" stroke="#203746" stroke-width="12"/>',
    '<circle cx="108" cy="86" r="25" fill="#5a315e"/>',
    '<circle cx="212" cy="86" r="25" fill="#5a315e"/>',
    '<circle cx="116" cy="76" r="8" fill="#ffffff"/>',
    '<circle cx="220" cy="76" r="8" fill="#ffffff"/>',
  ].join('')),
}])

await compositePng('mouth.png', 240, 240, [{
  input: svg(240, 240, [
    '<path d="M28 128 Q120 220 212 128 Q120 178 28 128Z" fill="#542d49" stroke="#203746" stroke-width="12" stroke-linejoin="round"/>',
    '<path d="M72 157 L92 132 L112 166 L132 132 L152 157" fill="#fff6dc"/>',
  ].join('')),
}])

console.log(`Created deterministic render fixtures in ${outputDirectory}`)
