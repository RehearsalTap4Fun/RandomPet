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
      const iris = 70 + seed % 26
      const pupil = trait.provenance.concept.includes('sleepy') ? 20 : 39
      artwork = `<g>
        <rect width="2048" height="2048" fill="url(#g)"/>
        <ellipse cx="738" cy="636" rx="${iris}" ry="${iris + 16}" fill="${colors.primary}"/>
        <ellipse cx="1310" cy="636" rx="${iris}" ry="${iris + 16}" fill="${colors.secondary}"/>
        <ellipse cx="738" cy="650" rx="${pupil}" ry="${pupil + 18}" fill="#17151e"/>
        <ellipse cx="1310" cy="650" rx="${pupil}" ry="${pupil + 18}" fill="#17151e"/>
        <circle cx="713" cy="615" r="18" fill="#fff"/><circle cx="1285" cy="615" r="18" fill="#fff"/>
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
      const x = 730 + seed % 590
      artwork = `<g fill="url(#g)" stroke="${colors.accent}" stroke-width="10">
        <path d="M${x} 250 C${x - 90} 170 ${x - 150} 300 ${x - 40} 340 L${x} 305 L${x + 40} 340 C${x + 150} 300 ${x + 90} 170 ${x} 250Z"/>
        <circle cx="${x}" cy="285" r="34" fill="${colors.accent}"/>
      </g>`
      break
    }
    case 'extraAppendage': {
      const side = seed % 2 === 0 ? 365 : 1683
      artwork = `<g fill="url(#g)" stroke="${colors.secondary}" stroke-width="12">
        <path d="M${side} 1040 C${side - 90} 970 ${side - 105} 1145 ${side} 1210 C${side + 105} 1145 ${side + 90} 970 ${side} 1040Z"/>
        <circle cx="${side}" cy="1120" r="42" fill="${colors.accent}"/>
      </g>`
      break
    }
    case 'effect': {
      artwork = trait.provenance.concept === 'none'
        ? ''
        : `<g fill="${colors.accent}" filter="url(#soft)" opacity=".9">${particles(seed, trait.rarity === 'N' ? 10 : trait.rarity === 'R' ? 18 : 28)}</g>
          <g fill="#fff">${particles(seed + 17, trait.rarity === 'N' ? 6 : trait.rarity === 'R' ? 10 : 16)}</g>`
      break
    }
    case 'pattern': {
      const spacing = 120 - (seed % 35)
      artwork = `<rect width="2048" height="2048" fill="${colors.primary}" opacity=".12"/>
        <g fill="none" stroke="${colors.secondary}" stroke-width="${18 * tierScale}" opacity=".62">
          ${Array.from({ length: 22 }, (_unused, index) => `<path d="M${-300 + index * spacing} 100 Q${index * spacing} 900 ${-100 + index * spacing} 1948"/>`).join('')}
        </g>`
      break
    }
    case 'surfaceMaterial': {
      artwork = `<rect width="2048" height="2048" fill="${colors.primary}" opacity=".2"/>
        <g stroke="${colors.accent}" stroke-width="${3 * tierScale}" opacity=".35">
          ${Array.from({ length: 42 }, (_unused, index) => `<path d="M0 ${index * 50 + seed % 31} Q1024 ${index * 43 % 1800} 2048 ${index * 50 + 25}"/>`).join('')}
        </g>`
      break
    }
    case 'colorScheme':
      artwork = `<rect width="2048" height="2048" fill="url(#g)" opacity=".92"/><circle cx="820" cy="650" r="560" fill="${colors.accent}" opacity=".16"/>`
      break
    default:
      artwork = `<rect width="2048" height="2048" fill="url(#g)" opacity=".18"/>
        <path d="M240 ${500 + seed % 500} Q1024 ${250 + seed % 650} 1808 ${500 + seed % 500}" fill="none" stroke="${colors.accent}" stroke-width="${18 * tierScale}" opacity=".72"/>`
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
      if (!(await exists(outputPath))) await renderV08TraitSource(trait, ownerMaskPath, outputPath)
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
