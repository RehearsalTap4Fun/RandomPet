import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  generateMonster,
  parseCatalog,
  planComposition,
  strongFeatureCount,
  strongNonFacialFeatureCount,
  type Catalog,
  type GenerationMode,
  type ThemeId,
} from '@qmonster/generator-core'
import productionCatalogDocument from '../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import v03ProductionCatalogDocument from '../packages/asset-catalog/catalog/v0.3.0/catalog.json'
import v04ProductionCatalogDocument from '../packages/asset-catalog/catalog/v0.4.0/catalog.json'

const THEMES: readonly ThemeId[] = ['deep-sea', 'fungal', 'shadow']
const OPTIONAL_SLOTS = ['headAppendage', 'tail', 'extraAppendage', 'effect'] as const
type StatisticsCatalogVersion = '0.2.0' | '0.3.0' | '0.4.0'

export function parseCompositionStatisticsArguments(args: readonly string[]): {
  version: StatisticsCatalogVersion
  seedCount: number
  modes: GenerationMode[]
} {
  let version: StatisticsCatalogVersion | undefined
  let seedCount: number | undefined
  let modes: GenerationMode[] | undefined
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const rawValue = args[index + 1]
    if (rawValue === undefined || (flag !== '--version' && flag !== '--seeds' && flag !== '--modes')) {
      throw new Error(`Unknown or incomplete composition statistics argument: ${flag ?? ''}`)
    }
    if (flag === '--version') {
      if (rawValue !== '0.2.0' && rawValue !== '0.3.0' && rawValue !== '0.4.0') {
        throw new Error('--version must be exactly 0.2.0, 0.3.0, or 0.4.0.')
      }
      version = rawValue
    } else if (flag === '--seeds') {
      const value = Number(rawValue)
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error('--seeds must be a positive safe integer.')
      }
      seedCount = value
    } else {
      const values = rawValue.split(/[,\s]+/u)
      if (values.some(value => value !== 'normal' && value !== 'mutation' && value !== 'aberration')) {
        throw new Error('--modes must contain only normal, mutation, and aberration.')
      }
      if (values.length === 0 || new Set(values).size !== values.length) {
        throw new Error('--modes must contain distinct generation modes.')
      }
      modes = values as GenerationMode[]
    }
  }
  if (version === undefined || seedCount === undefined || modes === undefined) {
    throw new Error('Composition statistics require --version, --seeds, and --modes.')
  }
  return { version, seedCount, modes }
}

export function measureCompositionDistribution(
  catalog: Catalog,
  seeds: readonly string[],
  modes: readonly GenerationMode[] = ['normal'],
): {
  optionalNoneRates: Record<typeof OPTIONAL_SLOTS[number], number>
  maximumStrongFeatures: number
  maximumStrongNonFacialFeatures: number
  maximumSurpriseSlots: number
  generationErrorCount: number
  byMode: Record<string, {
    optionalNoneRates: Record<typeof OPTIONAL_SLOTS[number], number>
    maximumStrongFeatures: number
    maximumStrongNonFacialFeatures: number
    maximumSurpriseSlots: number
    generationErrorCount: number
  }>
} {
  if (seeds.length === 0) throw new Error('Composition distribution requires at least one seed.')
  if (modes.length === 0 || new Set(modes).size !== modes.length) {
    throw new Error('Composition distribution requires distinct generation modes.')
  }
  const noneCounts: Record<typeof OPTIONAL_SLOTS[number], number> = {
    headAppendage: 0,
    tail: 0,
    extraAppendage: 0,
    effect: 0,
  }
  let maximumStrongFeatures = 0
  let maximumStrongNonFacialFeatures = 0
  let maximumSurpriseSlots = 0
  let generationErrorCount = 0
  const byMode: Record<string, {
    optionalNoneRates: Record<typeof OPTIONAL_SLOTS[number], number>
    maximumStrongFeatures: number
    maximumStrongNonFacialFeatures: number
    maximumSurpriseSlots: number
    generationErrorCount: number
  }> = {}

  for (const mode of modes) {
    const modeNoneCounts: Record<typeof OPTIONAL_SLOTS[number], number> = {
      headAppendage: 0,
      tail: 0,
      extraAppendage: 0,
      effect: 0,
    }
    let modeMaximumStrongFeatures = 0
    let modeMaximumStrongNonFacialFeatures = 0
    let modeMaximumSurpriseSlots = 0
    let modeGenerationErrorCount = 0

    for (const [index, seed] of seeds.entries()) {
      const themeId = THEMES[index % THEMES.length]!
      const generated = generateMonster({ seed, themeId, mode }, catalog)
      if (generated.blocked || generated.diagnostics.some(item => item.severity === 'error')) {
        modeGenerationErrorCount += 1
        continue
      }
      for (const slotId of OPTIONAL_SLOTS) {
        const selected = generated.spec.visualSlots[slotId]
        const part = catalog.parts.find(candidate => candidate.slotId === slotId && candidate.id === selected.partId)
        if (part?.composition?.isNone === true) {
          modeNoneCounts[slotId] += 1
          noneCounts[slotId] += 1
        }
      }
      modeMaximumStrongFeatures = Math.max(
        modeMaximumStrongFeatures,
        strongFeatureCount(generated.spec, catalog),
      )
      modeMaximumStrongNonFacialFeatures = Math.max(
        modeMaximumStrongNonFacialFeatures,
        strongNonFacialFeatureCount(generated.spec, catalog),
      )
      const rigId = generated.spec.visualSlots.bodyFrame.rigId
      const plan = planComposition(seed, themeId, rigId, catalog)
      const surpriseSlots = (catalog.compositionPolicy?.motifSlots ?? []).filter(slotId => {
        if (plan.motifModes[slotId] !== 'surprise') return false
        const selected = generated.spec.visualSlots[slotId]
        return catalog.parts.find(candidate => candidate.slotId === slotId && candidate.id === selected.partId)
          ?.composition?.isNone === false
      }).length
      modeMaximumSurpriseSlots = Math.max(modeMaximumSurpriseSlots, surpriseSlots)
    }

    byMode[mode] = {
      optionalNoneRates: Object.fromEntries(OPTIONAL_SLOTS.map(slotId => [
        slotId,
        modeNoneCounts[slotId] / seeds.length,
      ])) as Record<typeof OPTIONAL_SLOTS[number], number>,
      maximumStrongFeatures: modeMaximumStrongFeatures,
      maximumStrongNonFacialFeatures: modeMaximumStrongNonFacialFeatures,
      maximumSurpriseSlots: modeMaximumSurpriseSlots,
      generationErrorCount: modeGenerationErrorCount,
    }
    maximumStrongFeatures = Math.max(maximumStrongFeatures, modeMaximumStrongFeatures)
    maximumStrongNonFacialFeatures = Math.max(
      maximumStrongNonFacialFeatures,
      modeMaximumStrongNonFacialFeatures,
    )
    maximumSurpriseSlots = Math.max(maximumSurpriseSlots, modeMaximumSurpriseSlots)
    generationErrorCount += modeGenerationErrorCount
  }

  return {
    optionalNoneRates: Object.fromEntries(OPTIONAL_SLOTS.map(slotId => [
      slotId,
      noneCounts[slotId] / (seeds.length * modes.length),
    ])) as Record<typeof OPTIONAL_SLOTS[number], number>,
    maximumStrongFeatures,
    maximumStrongNonFacialFeatures,
    maximumSurpriseSlots,
    generationErrorCount,
    byMode,
  }
}

export function buildCompositionStatisticsEvidence(
  catalog: Catalog,
  seedCount: number,
  modes: readonly GenerationMode[],
) {
  if (!Number.isSafeInteger(seedCount) || seedCount <= 0) {
    throw new Error('Composition statistics seed count must be a positive safe integer.')
  }
  const versionTag = catalog.version.split('.').slice(0, 2).join('')
  const seeds = Array.from({ length: seedCount }, (_, index) => (
    `v${versionTag}-composition-${String(index).padStart(5, '0')}`
  ))
  const measured = measureCompositionDistribution(catalog, seeds, modes)
  return {
    schemaVersion: `qmonster-v${catalog.version.split('.').slice(0, 2).join('.')}-composition-statistics-v1`,
    catalogVersion: catalog.version,
    seedCountPerMode: seedCount,
    totalSampleCount: seedCount * modes.length,
    seedPattern: `v${versionTag}-composition-{${String(0).padStart(5, '0')}..${String(seedCount - 1).padStart(5, '0')}}`,
    themeCycle: THEMES,
    modes: [...modes],
    maximumStrongFeaturesLimit: catalog.compositionPolicy?.maxStrongFeatures ?? Number.MAX_SAFE_INTEGER,
    maximumStrongNonFacialFeaturesLimit:
      catalog.compositionPolicy?.maxStrongNonFacialFeatures ?? Number.MAX_SAFE_INTEGER,
    ...measured,
  }
}

function statisticsCatalogDocument(version: StatisticsCatalogVersion): unknown {
  if (version === '0.4.0') return v04ProductionCatalogDocument
  return version === '0.3.0' ? v03ProductionCatalogDocument : productionCatalogDocument
}

async function main(): Promise<void> {
  const { version, seedCount, modes } = parseCompositionStatisticsArguments(process.argv.slice(2))
  const parsedCatalog = parseCatalog(statisticsCatalogDocument(version))
  if (!parsedCatalog.ok) throw new Error(`Statistics catalog is invalid: ${JSON.stringify(parsedCatalog.diagnostics)}`)
  const evidence = buildCompositionStatisticsEvidence(parsedCatalog.value, seedCount, modes)
  if (
    evidence.generationErrorCount !== 0
    || evidence.maximumStrongFeatures > evidence.maximumStrongFeaturesLimit
    || evidence.maximumStrongNonFacialFeatures > evidence.maximumStrongNonFacialFeaturesLimit
  ) {
    throw new Error(`Composition statistics failed machine budgets: ${JSON.stringify(evidence)}`)
  }
  const auditRoot = resolve(process.cwd(), 'packages', 'asset-catalog', 'audit', `v${version}`)
  await mkdir(auditRoot, { recursive: true })
  const evidencePath = resolve(auditRoot, 'task7-composition-statistics.json')
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  await writeFile(evidencePath, serialized)
  console.log(JSON.stringify({
    evidencePath,
    evidenceSha256: createHash('sha256').update(serialized).digest('hex'),
    totalSampleCount: evidence.totalSampleCount,
    maximumStrongFeatures: evidence.maximumStrongFeatures,
    maximumStrongNonFacialFeatures: evidence.maximumStrongNonFacialFeatures,
    generationErrorCount: evidence.generationErrorCount,
    byMode: evidence.byMode,
  }))
}

const invokedModule = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href
if (invokedModule === import.meta.url) {
  void main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
