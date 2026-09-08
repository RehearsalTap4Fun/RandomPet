import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { validateV08RasterContract } from '../packages/asset-catalog/src/v08-raster-contract.js'
import {
  buildCompleteV08Inventory,
  validateV08SourceInventory,
  type V08TraitInventory,
  type V08TraitSourceRecord,
} from './assemble-v08-catalog.js'
import { V08_REGION_GUIDE_FILENAMES } from './prepare-v08-feline-assets.js'
import { V08_CANONICAL_GEOMETRY } from './v08-canonical-geometry.js'

const SIZE = 2048
const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

function stableNumber(value: string): number {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16)
}

function palette(trait: V08TraitSourceRecord): { primary: string; secondary: string; accent: string } {
  const seed = stableNumber(trait.id)
  const hue = seed % 360
  const rareSaturation = trait.rarity === 'N' ? 48 : trait.rarity === 'R' ? 68 : 82
  return {
    primary: `hsl(${hue} ${rareSaturation}% 64%)`,
    secondary: `hsl(${(hue + 42) % 360} ${rareSaturation}% 48%)`,
    accent: `hsl(${(hue + 180) % 360} 88% 78%)`,
  }
}

function particles(seed: number, count: number): string {
  return Array.from({ length: count }, (_unused, index) => {
    const x = 180 + ((seed * (index + 3) * 37) % 1688)
    const y = 140 + ((seed * (index + 5) * 53) % 1768)
    const radius = 6 + ((seed + index * 11) % 20)
    return `<circle cx="${x}" cy="${y}" r="${radius}"/>`
  }).join('')
}

function effectArtwork(concept: string, seed: number, accent: string, secondary: string): string {
  const softGlow = (body: string) => `<g fill="${accent}" opacity=".62" filter="url(#soft)">${body}</g>`
  const spark = (x: number, y: number, scale = 1) => (
    `<path d="M${x} ${y - 34 * scale} L${x + 9 * scale} ${y - 9 * scale} L${x + 34 * scale} ${y} L${x + 9 * scale} ${y + 9 * scale} L${x} ${y + 34 * scale} L${x - 9 * scale} ${y + 9 * scale} L${x - 34 * scale} ${y} L${x - 9 * scale} ${y - 9 * scale}Z"/>`
  )
  switch (concept) {
    case 'none': return ''
    case 'paw-glow': return `${softGlow('<ellipse cx="760" cy="1775" rx="185" ry="155"/><ellipse cx="1288" cy="1775" rx="185" ry="155"/>')}<g fill="#fff">${spark(760, 1770)}${spark(1288, 1770)}</g>`
    case 'tail-spark': return `${softGlow('<ellipse cx="1630" cy="1380" rx="245" ry="330"/>')}<g fill="#fff">${spark(1540, 1220)}${spark(1680, 1420, 1.3)}${spark(1585, 1620, .8)}</g>`
    case 'ear-glint': return `${softGlow('<ellipse cx="625" cy="245" rx="270" ry="220"/><ellipse cx="1423" cy="245" rx="270" ry="220"/>')}<g fill="#fff">${spark(620, 225, 1.2)}${spark(1425, 225, 1.2)}</g>`
    case 'floor-spark': return `${softGlow('<ellipse cx="1024" cy="1920" rx="600" ry="75"/>')}<g fill="#fff">${spark(610, 1900, .8)}${spark(1015, 1940)}${spark(1435, 1905, .8)}</g>`
    case 'breath-mist': return `<g fill="${accent}" opacity=".42" filter="url(#soft)"><ellipse cx="780" cy="875" rx="145" ry="70"/><ellipse cx="655" cy="835" rx="85" ry="42"/></g>`
    case 'tiny-hearts': return `<g fill="${accent}"><path d="M390 870 C330 790 230 870 390 1030 C550 870 450 790 390 870Z"/><path d="M1658 870 C1598 790 1498 870 1658 1030 C1818 870 1718 790 1658 870Z"/></g>`
    case 'moon-motes': return `<g fill="${accent}"><path d="M300 780 A120 120 0 1 0 455 620 A95 95 0 1 1 300 780Z"/><path d="M1748 1080 A85 85 0 1 0 1848 965 A68 68 0 1 1 1748 1080Z"/></g>`
    case 'star-trail': return `<g fill="${accent}">${spark(300, 1250)}${spark(470, 1090, .8)}${spark(1570, 920, .9)}${spark(1760, 750, 1.2)}</g>`
    case 'orbiting-stardust': return `<g fill="none" stroke="${secondary}" stroke-width="18" opacity=".7"><ellipse cx="1024" cy="1100" rx="790" ry="640"/></g><g fill="${accent}">${spark(275, 890, 1.4)}${spark(1745, 1310, 1.4)}${spark(995, 1740)}</g>`
    default: return `<g fill="${accent}" opacity=".72">${particles(seed, concept === 'firefly-drift' ? 14 : 9)}</g>`
  }
}

function patternArtwork(concept: string, seed: number, secondary: string): string {
  if (concept === 'plain') return `<rect width="2048" height="2048" fill="${secondary}" opacity=".04"/>`
  if (concept.includes('spot') || concept.includes('dapple') || concept.includes('constellation')) {
    return `<g fill="${secondary}" opacity=".5">${particles(seed, concept.includes('constellation') ? 18 : 12)}</g>`
  }
  if (concept.includes('socks') || concept.includes('points')) {
    return `<g fill="${secondary}" opacity=".46"><ellipse cx="720" cy="1790" rx="210" ry="190"/><ellipse cx="1328" cy="1790" rx="210" ry="190"/><ellipse cx="1024" cy="755" rx="175" ry="105"/></g>`
  }
  if (concept.includes('forehead') || concept.includes('moon') || concept.includes('aurora')) {
    return `<path d="M1024 300 C930 450 950 585 1024 690 C1098 585 1118 450 1024 300Z" fill="${secondary}" opacity=".52"/>`
  }
  return `<g fill="none" stroke="${secondary}" stroke-width="32" stroke-linecap="round" opacity=".48">
    <path d="M850 330 Q900 470 950 550"/><path d="M1024 300 L1024 540"/><path d="M1198 330 Q1148 470 1098 550"/>
    <path d="M1460 1060 Q1570 1160 1650 1280"/><path d="M1490 1190 Q1590 1280 1660 1390"/>
  </g>`
}

function svgForTrait(trait: V08TraitSourceRecord): Buffer {
  const colors = palette(trait)
  const seed = stableNumber(trait.id)
  const tierScale = trait.rarity === 'N' ? 1 : trait.rarity === 'R' ? 1.3 : 1.65
  const definitions = `<defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors.primary}"/><stop offset="1" stop-color="${colors.secondary}"/></linearGradient>
    <radialGradient id="shine"><stop stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="${colors.accent}" stop-opacity="0"/></radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="${8 * tierScale}"/></filter>
  </defs>`
  let artwork: string
  switch (trait.slotId) {
    case 'eyes': {
      const { left, right } = V08_CANONICAL_GEOMETRY.eyes
      const iris = 70 + seed % 26
      const pupil = trait.provenance.concept.includes('sleepy') ? 20 : 39
      artwork = `<g>
        <ellipse cx="${left.x}" cy="${left.y}" rx="${iris}" ry="${iris + 16}" fill="${colors.primary}"/>
        <ellipse cx="${right.x}" cy="${right.y}" rx="${iris}" ry="${iris + 16}" fill="${colors.secondary}"/>
        <ellipse cx="${left.x}" cy="${left.y + 14}" rx="${pupil}" ry="${pupil + 18}" fill="#17151e"/>
        <ellipse cx="${right.x}" cy="${right.y + 14}" rx="${pupil}" ry="${pupil + 18}" fill="#17151e"/>
        <circle cx="${left.x - 25}" cy="${left.y - 21}" r="18" fill="#fff"/><circle cx="${right.x - 25}" cy="${right.y - 21}" r="18" fill="#fff"/>
      </g>`
      break
    }
    case 'mouthShape': {
      const lift = (seed % 45) - 22
      artwork = `<g fill="none" stroke="${colors.secondary}" stroke-width="${20 * tierScale}" stroke-linecap="round">
        <path d="M1024 822 C940 ${900 - lift} 855 ${900 + lift} 790 850"/>
        <path d="M1024 822 C1108 ${900 - lift} 1193 ${900 + lift} 1258 850"/>
        <path d="M980 796 Q1024 832 1068 796" fill="${colors.primary}" stroke-width="12"/>
      </g>`
      break
    }
    case 'oralDetail': {
      const tongue = trait.provenance.concept.includes('tongue')
      artwork = tongue
        ? `<path d="M930 858 Q1024 970 1118 858 Q1100 952 1024 974 Q948 952 930 858Z" fill="url(#g)"/>`
        : `<path d="M950 850 L1000 940 L1042 850Z M1048 850 L1090 940 L1140 850Z" fill="${colors.accent}" stroke="${colors.secondary}" stroke-width="8"/>`
      break
    }
    case 'headAppendage': {
      const x = seed % 2 === 0 ? 650 : 1398
      artwork = `<g fill="url(#g)" stroke="${colors.accent}" stroke-width="10">
        <path d="M${x - 150} 420 Q${x} 245 ${x + 150} 420" fill="none" stroke-width="28"/>
        <path d="M${x} 300 C${x - 90} 215 ${x - 145} 350 ${x - 42} 405 L${x} 370 L${x + 42} 405 C${x + 145} 350 ${x + 90} 215 ${x} 300Z"/>
        <circle cx="${x}" cy="352" r="34" fill="${colors.accent}"/>
      </g>`
      break
    }
    case 'extraAppendage': {
      const { centerX, topY, charmY } = V08_CANONICAL_GEOMETRY.collar
      artwork = `<g fill="url(#g)" stroke="${colors.secondary}" stroke-width="12">
        <path d="M760 ${topY} Q${centerX} 1205 1288 ${topY}" fill="none" stroke-width="34"/>
        <path d="M${centerX} 1160 L${centerX} ${charmY}" fill="none" stroke-width="26"/>
        <path d="M${centerX} ${charmY - 55} C${centerX - 92} ${charmY - 120} ${centerX - 120} ${charmY + 35} ${centerX} ${charmY + 110} C${centerX + 120} ${charmY + 35} ${centerX + 92} ${charmY - 120} ${centerX} ${charmY - 55}Z"/>
        <circle cx="${centerX}" cy="${charmY + 10}" r="34" fill="${colors.accent}"/>
      </g>`
      break
    }
    case 'effect': {
      artwork = effectArtwork(trait.provenance.concept, seed, colors.accent, colors.secondary)
      break
    }
    case 'pattern': {
      artwork = patternArtwork(trait.provenance.concept, seed, colors.secondary)
      break
    }
    case 'surfaceMaterial': {
      artwork = `<rect width="2048" height="2048" fill="${colors.primary}" opacity=".12"/>
        <g stroke="${colors.accent}" stroke-width="${3 * tierScale}" stroke-linecap="round" opacity=".28">
          ${Array.from({ length: 180 }, (_unused, index) => {
            const x = 430 + ((seed + index * 83) % 1190)
            const y = 180 + ((seed * 3 + index * 127) % 1690)
            return `<path d="M${x} ${y} l${12 + index % 15} ${-8 - index % 9}"/>`
          }).join('')}
        </g>`
      break
    }
    case 'colorScheme':
      artwork = `<rect width="2048" height="2048" fill="url(#g)" opacity=".92"/><circle cx="820" cy="650" r="560" fill="${colors.accent}" opacity=".16"/>`
      break
    case 'bodyFrame':
      artwork = `<ellipse cx="1024" cy="1320" rx="360" ry="430" fill="url(#g)" opacity=".18"/><path d="M820 1110 Q1024 1280 1228 1110" fill="none" stroke="${colors.accent}" stroke-width="${20 * tierScale}" opacity=".38"/>`
      break
    case 'headShape':
      artwork = `<g fill="${colors.primary}" opacity=".2"><ellipse cx="660" cy="790" rx="155" ry="100"/><ellipse cx="1388" cy="790" rx="155" ry="100"/></g>`
      break
    case 'arms':
      artwork = `<g fill="${colors.primary}" opacity=".34"><ellipse cx="760" cy="1680" rx="160" ry="220"/><ellipse cx="1288" cy="1680" rx="160" ry="220"/></g>`
      break
    case 'legs':
      artwork = `<g fill="${colors.secondary}" opacity=".3"><ellipse cx="650" cy="1880" rx="190" ry="90"/><ellipse cx="1398" cy="1880" rx="190" ry="90"/></g>`
      break
    case 'tail':
      artwork = `<g fill="none" stroke="${colors.accent}" stroke-width="${22 * tierScale}" opacity=".56"><path d="M1460 1180 Q1650 1290 1710 1510"/><path d="M1500 1320 Q1650 1410 1690 1600"/></g>`
      break
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">${definitions}${artwork}</svg>`)
}

export async function renderV08TraitSource(
  trait: V08TraitSourceRecord,
  ownerMaskPath: string,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  const transparent = sharp({ create: {
    width: SIZE, height: SIZE, channels: 4, background: '#00000000',
  } })
  const artwork = svgForTrait(trait)
  const composites = trait.slotId === 'effect' && trait.provenance.concept === 'none'
    ? []
    : [{ input: artwork }, { input: ownerMaskPath, blend: 'dest-in' as const }]
  await transparent.composite(composites).png(PNG_OPTIONS).toFile(outputPath)
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function ensureV08TraitSourceWorkspace(
  sourceRootInput: string,
  onProgress: (completed: number, total: number) => void = () => {},
  options: { force?: boolean } = {},
): Promise<V08TraitInventory> {
  const sourceRoot = resolve(sourceRootInput)
  const masterPath = join(sourceRoot, 'master', 'feline-sit-v1.png')
  const sourceMasterSha256 = hash(await readFile(masterPath))
  const inventoryPath = join(sourceRoot, 'trait-inventory.json')
  let inventory: V08TraitInventory
  if (await exists(inventoryPath)) {
    inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as V08TraitInventory
  } else {
    inventory = buildCompleteV08Inventory(sourceMasterSha256)
    await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' })
  }
  const inventoryDiagnostics = validateV08SourceInventory(inventory)
  if (inventoryDiagnostics.length > 0) throw new Error(inventoryDiagnostics.join('\n'))

  const rejections: Array<{ id: string; diagnostics: unknown[] }> = []
  const concurrency = 8
  for (let start = 0; start < inventory.traits.length; start += concurrency) {
    await Promise.all(inventory.traits.slice(start, start + concurrency).map(async trait => {
      const outputPath = join(sourceRoot, trait.sourcePath)
      const ownerMaskPath = join(
        sourceRoot, 'master', 'masks', V08_REGION_GUIDE_FILENAMES[trait.ownerRegionId],
      )
      if (options.force === true || !(await exists(outputPath))) {
        await renderV08TraitSource(trait, ownerMaskPath, outputPath)
      }
      const diagnostics = await validateV08RasterContract({
        sourcePath: outputPath,
        role: 'trait',
        ownerMaskPath,
        allowEmpty: trait.slotId === 'effect' && trait.provenance.concept === 'none',
      })
      if (diagnostics.some(item => item.severity === 'error')) rejections.push({ id: trait.id, diagnostics })
    }))
    onProgress(Math.min(start + concurrency, inventory.traits.length), inventory.traits.length)
  }
  if (rejections.length > 0) {
    await writeFile(join(sourceRoot, 'rejections.json'), `${JSON.stringify(rejections, null, 2)}\n`)
    throw new Error(`V08_TRAIT_SOURCE_REJECTED:${rejections[0]!.id}`)
  }
  return inventory
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 2 || args[0] !== '--source-root') {
    throw new Error('Usage: tsx scripts/prepare-v08-feline-traits.ts --source-root <source-root>')
  }
  const inventory = await ensureV08TraitSourceWorkspace(args[1]!, (completed, total) => {
    process.stdout.write(`prepared ${completed}/${total}\n`)
  })
  process.stdout.write(`inventory ${inventory.traits.length}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main(process.argv.slice(2))
}
