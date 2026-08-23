import {
  parseMonsterSpec,
  type ApprovedTransform,
  type Catalog,
  type MonsterSpec,
  type VisualPartDefinition,
  type VisualSlotId,
} from '@qmonster/generator-core'
import { renderMonster, type ImageResolver } from '@qmonster/renderer-canvas'

const assetRoot = '/render-fixtures/assets'

function part(
  id: string,
  slotId: VisualSlotId,
  layer: VisualPartDefinition['layer'],
  assetName: string,
  origin: { x: number; y: number },
  socket: string | null,
  maskPaths: VisualPartDefinition['maskPaths'] = {},
  approvedTransforms?: ApprovedTransform[],
): VisualPartDefinition {
  return {
    id,
    slotId,
    rarity: 'N',
    baseWeight: 1,
    themeIds: ['fungal'],
    themeWeights: { fungal: 1 },
    compatibleRigs: ['blob'],
    assetPath: `${assetRoot}/${assetName}`,
    maskPaths,
    origin,
    socket,
    layer,
    semanticTraitId: null,
    semanticPriority: 0,
    excludes: [],
    boosts: {},
    ...(approvedTransforms === undefined ? {} : { approvedTransforms }),
  }
}

const catalog: Catalog = {
  version: 'synthetic-0.1.0',
  themes: [{
    id: 'fungal',
    palette: { primary: '#4dd6b3', secondary: '#8f63e9', accent: '#ffcf5a' },
  }],
  rigs: [{
    id: 'blob',
    sockets: {
      head: { x: 1024, y: 720 },
      armLeft: { x: 730, y: 1100 },
      legLeft: { x: 850, y: 1370 },
      tail: { x: 1430, y: 1110 },
      wingLeft: { x: 690, y: 930 },
    },
  }],
  parts: [
    part('synthetic_body', 'bodyFrame', 'body', 'base.png', { x: 320, y: 360 }, null),
    part('synthetic_head', 'headShape', 'head', 'transparent.png', { x: 0, y: 0 }, 'head'),
    part('synthetic_eyes', 'eyes', 'faceAndHeadwear', 'eyes.png', { x: 160, y: 80 }, 'head'),
    part('synthetic_mouth', 'mouthShape', 'faceAndHeadwear', 'mouth.png', { x: 120, y: 0 }, 'head'),
    part('synthetic_oral', 'oralDetail', 'faceAndHeadwear', 'transparent.png', { x: 0, y: 0 }, 'head'),
    part('synthetic_headwear', 'headAppendage', 'faceAndHeadwear', 'transparent.png', { x: 0, y: 0 }, 'head'),
    part('synthetic_arms', 'arms', 'frontAppendage', 'transparent.png', { x: 0, y: 0 }, 'armLeft'),
    part('synthetic_legs', 'legs', 'frontAppendage', 'transparent.png', { x: 0, y: 0 }, 'legLeft'),
    part('synthetic_tail', 'tail', 'rearAppendage', 'transparent.png', { x: 0, y: 0 }, 'tail'),
    part(
      'synthetic_rear_mirrored',
      'extraAppendage',
      'rearAppendage',
      'rear-appendage-source.png',
      { x: 402, y: 180 },
      'wingLeft',
      {},
      [{ scale: 1, mirrorX: true }],
    ),
    part(
      'synthetic_surface',
      'surfaceMaterial',
      'surface',
      'surface.png',
      { x: 320, y: 360 },
      null,
      { primary: `${assetRoot}/surface-mask-primary.png` },
    ),
    part('synthetic_pattern', 'pattern', 'pattern', 'transparent.png', { x: 0, y: 0 }, null),
    part('synthetic_color', 'colorScheme', 'pattern', 'transparent.png', { x: 0, y: 0 }, null),
    part('synthetic_effect', 'effect', 'foregroundEffect', 'transparent.png', { x: 0, y: 0 }, null),
  ],
  semanticTraits: [
    { id: 'synthetic_frame', semanticSlotId: 'frame' },
    { id: 'synthetic_appendage', semanticSlotId: 'appendage' },
    { id: 'synthetic_head', semanticSlotId: 'headAndEyes' },
    { id: 'synthetic_mouth', semanticSlotId: 'mouth' },
    { id: 'synthetic_surface', semanticSlotId: 'surface' },
    { id: 'synthetic_pattern', semanticSlotId: 'pattern' },
    { id: 'synthetic_calm', semanticSlotId: 'personality' },
    { id: 'synthetic_mirrored', semanticSlotId: 'quirk' },
  ],
  modifiers: [],
  dependencies: {},
}

const imageResolver: ImageResolver = {
  async resolve(assetPath) {
    const image = new Image()
    image.src = assetPath
    await image.decode()
    return image
  },
}

function requestedSize(): 1024 | 2048 {
  return new URLSearchParams(location.search).get('size') === '2048' ? 2048 : 1024
}

async function loadSpec(): Promise<MonsterSpec> {
  const response = await fetch('/render-fixtures/synthetic-spec.json')
  if (!response.ok) throw new Error(`Could not load synthetic spec: ${response.status}`)
  const parsed = parseMonsterSpec(await response.json())
  if (!parsed.ok) throw new Error(`Invalid synthetic spec: ${JSON.stringify(parsed.diagnostics)}`)
  return parsed.value
}

async function renderFixture(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#render-target')
  if (canvas === null) throw new Error('Missing #render-target canvas')
  const size = requestedSize()
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D context unavailable')
  const result = await renderMonster(context, await loadSpec(), catalog, imageResolver, {
    width: size,
    height: size,
    includeGroundShadow: true,
  })
  if (result.diagnostics.length > 0) {
    throw new Error(`Synthetic render failed: ${JSON.stringify(result.diagnostics)}`)
  }
  document.body.dataset.renderComplete = 'true'
}

void renderFixture().catch((error: unknown) => {
  document.body.dataset.renderError = error instanceof Error ? error.message : String(error)
})
