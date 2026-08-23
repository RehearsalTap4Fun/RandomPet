import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Catalog,
  type MonsterSpec,
  type RigDefinition,
  type VisualPartDefinition,
  type VisualSlotId,
} from '@qmonster/generator-core'
import { renderMonster, type ImageResolver } from '@qmonster/renderer-canvas'

const transparentAsset = '/render-fixtures/assets/transparent.png'

function transparentPart(slotId: VisualSlotId, rigId: RigDefinition['id']): VisualPartDefinition {
  return {
    id: `review_none_${slotId}`,
    slotId,
    rarity: 'N',
    baseWeight: 1,
    themeIds: ['deep-sea', 'fungal', 'shadow'],
    themeWeights: { 'deep-sea': 1, fungal: 1, shadow: 1 },
    compatibleRigs: [rigId],
    assetPath: transparentAsset,
    maskPaths: {},
    origin: { x: 0, y: 0 },
    socket: null,
    layer: slotId === 'effect' ? 'foregroundEffect' : 'pattern',
    semanticTraitId: null,
    semanticPriority: 0,
    excludes: [],
    boosts: {},
  }
}

function lockedRigPart(rig: RigDefinition): VisualPartDefinition {
  return {
    ...transparentPart('bodyFrame', rig.id),
    id: `review_locked_${rig.id}`,
    assetPath: `/production-assets/rigs/base_${rig.id}_v1.png`,
    origin: { x: 512, y: 512 },
    layer: 'body',
  }
}

function reviewBundle(production: Catalog, rig: RigDefinition, target?: VisualPartDefinition): {
  catalog: Catalog
  spec: MonsterSpec
} {
  const selectedParts = VISUAL_SLOT_IDS.map(slotId => {
    if (target?.slotId === slotId) return target
    if (slotId === 'bodyFrame') return lockedRigPart(rig)
    return transparentPart(slotId, rig.id)
  })
  const theme = production.themes.find(candidate => target?.themeIds.includes(candidate.id)) ?? production.themes[0]!
  const catalog: Catalog = {
    version: production.version,
    themes: production.themes,
    rigs: [rig],
    parts: selectedParts,
    semanticTraits: production.semanticTraits,
    modifiers: [],
    dependencies: {},
  }
  const visualSlots = Object.fromEntries(selectedParts.map(part => [
    part.slotId,
    { partId: part.id, rigId: rig.id },
  ])) as MonsterSpec['visualSlots']
  const slotRolls = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [slotId, 0])) as MonsterSpec['slotRolls']
  const semanticTraits = {} as MonsterSpec['semanticTraits']
  for (const slotId of SEMANTIC_SLOT_IDS) {
    const primaryTrait = production.semanticTraits.find(trait => trait.semanticSlotId === slotId)
    if (primaryTrait === undefined) {
      throw new Error(`Production catalog has no semantic trait for ${slotId}`)
    }
    semanticTraits[slotId] = { primaryTraitId: primaryTrait.id, detailTraitIds: [] }
  }
  return {
    catalog,
    spec: {
      schemaVersion: '0.1.0',
      catalogVersion: catalog.version,
      rendererVersion: '0.1.0',
      seed: `review-${rig.id}-${target?.id ?? 'base'}`,
      themeId: theme.id,
      palette: { ...theme.palette },
      slotRolls,
      visualSlots,
      semanticTraits,
      mutation: null,
      aberrations: [],
    },
  }
}

const imageResolver: ImageResolver = {
  async resolve(assetPath) {
    const image = new Image()
    image.src = assetPath.startsWith('/') ? assetPath : `/production-assets/${assetPath}`
    await image.decode()
    return image
  },
}

async function draw(canvas: HTMLCanvasElement, bundle: ReturnType<typeof reviewBundle>): Promise<void> {
  canvas.width = 2048
  canvas.height = 2048
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D context unavailable')
  const result = await renderMonster(context, bundle.spec, bundle.catalog, imageResolver, {
    width: 2048,
    height: 2048,
    includeGroundShadow: true,
  })
  if (result.diagnostics.length > 0) throw new Error(JSON.stringify(result.diagnostics))
}

async function renderProductionReview(): Promise<void> {
  const query = new URLSearchParams(location.search)
  if (query.get('contact') === '1') document.body.classList.add('contact')
  const rigId = query.get('rig')
  const partId = query.get('part')
  if (rigId === null || partId === null) throw new Error('rig and part query parameters are required')
  const response = await fetch('/production-catalog.json')
  if (!response.ok) throw new Error(`Production catalog failed: ${response.status}`)
  const production = await response.json() as Catalog
  const rig = production.rigs.find(candidate => candidate.id === rigId)
  const target = production.parts.find(candidate => candidate.id === partId)
  if (rig === undefined || target === undefined || !target.compatibleRigs.includes(rig.id)) {
    throw new Error(`Incompatible production review target: ${partId}/${rigId}`)
  }
  await draw(document.querySelector<HTMLCanvasElement>('#base-target')!, reviewBundle(production, rig))
  await draw(document.querySelector<HTMLCanvasElement>('#render-target')!, reviewBundle(production, rig, target))
  document.body.dataset.renderComplete = 'true'
}

void renderProductionReview().catch((error: unknown) => {
  document.body.dataset.renderError = error instanceof Error ? error.message : String(error)
})
