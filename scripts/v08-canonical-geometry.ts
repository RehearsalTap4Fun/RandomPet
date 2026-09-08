import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'

const SIZE = 2048
const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

export const V08_CANONICAL_GEOMETRY = {
  eyes: {
    left: { x: 804, y: 630 },
    right: { x: 1244, y: 630 },
    maskRadiusX: 126,
    maskRadiusY: 132,
  },
  collar: {
    centerX: 1024,
    topY: 1110,
    charmY: 1225,
  },
} as const

function canvas(): sharp.Sharp {
  return sharp({ create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: '#00000000',
  } })
}

function svg(markup: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">${markup}</svg>`)
}

async function writeMask(path: string, composites: sharp.OverlayOptions[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const bytes = await canvas().composite(composites).png(PNG_OPTIONS).toBuffer()
  await writeFile(path, bytes)
}

/**
 * Rebuilds the two masks whose geometry defines visual coherence rather than style.
 * Both are derived from the canonical master masks, so later trait art cannot drift
 * away from the eye sockets or place a wearable in detached side panels.
 */
export async function writeV08CanonicalGeometry(sourceRootInput: string): Promise<void> {
  const sourceRoot = resolve(sourceRootInput)
  const masksRoot = join(sourceRoot, 'master', 'masks')
  const { eyes, collar } = V08_CANONICAL_GEOMETRY

  await writeMask(join(masksRoot, 'eyes-region.png'), [
    { input: svg(`<g fill="#fff">
      <ellipse cx="${eyes.left.x}" cy="${eyes.left.y}" rx="${eyes.maskRadiusX}" ry="${eyes.maskRadiusY}"/>
      <ellipse cx="${eyes.right.x}" cy="${eyes.right.y}" rx="${eyes.maskRadiusX}" ry="${eyes.maskRadiusY}"/>
    </g>`) },
    { input: join(masksRoot, 'face-safe-zone.png'), blend: 'dest-in' },
  ])

  await writeMask(join(masksRoot, 'mutation-back.png'), [
    { input: svg(`<g fill="#fff">
      <path d="M700 ${collar.topY} Q${collar.centerX} 1240 1348 ${collar.topY} L1300 1210 Q${collar.centerX} 1350 748 1210Z"/>
      <ellipse cx="${collar.centerX}" cy="1320" rx="300" ry="210"/>
    </g>`) },
    { input: join(masksRoot, 'body-surface.png'), blend: 'dest-in' },
    { input: join(masksRoot, 'face-protection.png'), blend: 'dest-out' },
  ])
}
