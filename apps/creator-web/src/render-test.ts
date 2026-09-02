import {
  parseMonsterSpec,
  type ApprovedTransform,
  type Catalog,
  type MonsterSpec,
  type VisualPartDefinition,
  type VisualSlotId,
} from '@qmonster/generator-core'
import {
  makeInterfaceCatalogFixture,
  makeValidCompositionSpecFixture,
} from '@qmonster/generator-core/test-fixtures'
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
  version: '0.1.0',
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

// TASK8_STABLE_BEGIN:render-test-interface-variant
type InterfaceVariant = 'baseline' | 'foreground-hole' | 'background-hole' | 'transition-hole' | 'shifted-contour' | 'curved-head-split' | 'misaligned-occlusion-masks'
// TASK8_STABLE_END:render-test-interface-variant

function raster(
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D asset context unavailable')
  draw(context)
  return canvas
}

function opaqueRect(
  x: number,
  y: number,
  width: number,
  height: number,
  color = '#ffffff',
): HTMLCanvasElement {
  return raster(2048, 2048, context => {
    context.fillStyle = color
    context.fillRect(x, y, width, height)
  })
}

function interfaceFixture(variant: InterfaceVariant): { catalog: Catalog; spec: MonsterSpec } {
  const interfaceCatalog = makeInterfaceCatalogFixture()
  const spec = makeValidCompositionSpecFixture(interfaceCatalog)
  spec.catalogVersion = '0.3.0'
  spec.rendererVersion = '0.3.0'
  spec.seed = 'real-raster-causal-isolation'
  for (const slotId of ['arms', 'legs', 'tail', 'extraAppendage'] as const) {
    const selected = interfaceCatalog.parts.find(candidate => (
      candidate.id === spec.visualSlots[slotId].partId && candidate.slotId === slotId
    ))
    if (selected?.composition === undefined) throw new Error(`Missing selected ${slotId} fixture`)
    selected.composition.isNone = true
  }
  const oralDetail = interfaceCatalog.parts.find(candidate => (
    candidate.id === spec.visualSlots.oralDetail.partId && candidate.slotId === 'oralDetail'
  ))
  if (oralDetail?.composition === undefined) throw new Error('Missing selected oral-detail fixture')
  oralDetail.composition.isNone = true
  const body = interfaceCatalog.parts.find(candidate => candidate.slotId === 'bodyFrame')
  const head = interfaceCatalog.parts.find(candidate => candidate.slotId === 'headShape')
  if (body?.composition?.mode !== 'interface' || head?.composition?.mode !== 'interface') {
    throw new Error('Expected interface body/head fixtures')
  }
  const receiver = body.composition.variantsByRig.blob!.connectors.find(item => item.id === 'neck')!
  const plug = head.composition.variantsByRig.blob!.connectors.find(item => item.id === 'neck')!
  const assignRolePaths = (profile: typeof receiver, role: 'receiver' | 'plug') => {
    const root = `assets/v0.3.0/connectors/blob/neck-${role}`
    profile.contourMaskPath = `${root}-contour.png`
    profile.foregroundMaskPath = `${root}-foreground.png`
    profile.backgroundMaskPath = `${root}-background.png`
  }
  assignRolePaths(receiver, 'receiver')
  assignRolePaths(plug, 'plug')
  if (variant === 'curved-head-split') {
    receiver.outwardNormal = { x: 0, y: -1 }
    plug.outwardNormal = { x: 0, y: 1 }
  } else plug.outwardNormal = { x: 0, y: -1 }
  head.composition.variantsByRig.blob!.faceSafeZones = [
    { x: 850, y: 750, width: 250, height: 250 },
  ]
  return { catalog: interfaceCatalog, spec }
}

function interfaceResolver(variant: InterfaceVariant): ImageResolver {
  const cache = new Map<string, CanvasImageSource>()
  return {
    async resolve(assetPath) {
      const cached = cache.get(assetPath)
      if (cached !== undefined) return cached
      let source: CanvasImageSource
      if (/bridges\/blob\/neck\.webp$/.test(assetPath)) {
        source = raster(4, 4, context => {
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, 4, 4)
        })
      } else if (/bridges\/blob\/neck-(front|back)\.png$/.test(assetPath)) {
        source = raster(4, 4, context => {
          context.fillStyle = '#ffffff'
          // TASK8_STABLE_BEGIN:render-test-transition-hole-bridge
          if (variant === 'transition-hole') {
            return
          } else if (variant === 'misaligned-occlusion-masks') {
          // TASK8_STABLE_END:render-test-transition-hole-bridge
            context.fillRect(assetPath.endsWith('-front.png') ? 0 : 2, 0, 2, 4)
          } else context.fillRect(0, 0, 4, 4)
        })
      } else if (assetPath.includes('/connectors/') && assetPath.endsWith('-contour.png')) {
        const receiver = assetPath.includes('-receiver-')
        const x = variant === 'shifted-contour' && !receiver ? 998 : 990
        source = opaqueRect(x, receiver ? 999 : 1050, 69, 1)
      } else if (
        variant === 'curved-head-split'
        && assetPath.includes('-plug-foreground.png')
      ) {
        source = raster(2048, 2048, context => {
          context.fillStyle = '#ffffff'
          context.beginPath()
          context.moveTo(900, 900)
          context.lineTo(1148, 900)
          context.lineTo(1148, 1020)
          context.quadraticCurveTo(1024, 1100, 900, 1020)
          context.closePath()
          context.fill()
        })
      } else if (
        variant === 'curved-head-split'
        && assetPath.includes('-plug-background.png')
      ) {
        source = raster(2048, 2048, context => {
          context.fillStyle = '#ffffff'
          context.fillRect(995, 1040, 58, 100)
          context.globalCompositeOperation = 'destination-out'
          context.beginPath()
          context.moveTo(900, 900)
          context.lineTo(1148, 900)
          context.lineTo(1148, 1020)
          context.quadraticCurveTo(1024, 1100, 900, 1020)
          context.closePath()
          context.fill()
        })
      } else if (assetPath.includes('/connectors/') && assetPath.endsWith('-foreground.png')) {
        source = raster(2048, 2048, context => {
          context.fillStyle = '#ffffff'
          context.fillRect(1024, 980, 66, 90)
          if (variant === 'foreground-hole') context.clearRect(1040, 1020, 8, 11)
        })
      } else if (assetPath.includes('/connectors/') && assetPath.endsWith('-background.png')) {
        source = raster(2048, 2048, context => {
          context.fillStyle = '#ffffff'
          context.fillRect(980, 980, 44, 90)
          if (variant === 'background-hole') context.clearRect(1001, 1006, 9, 9)
        })
      } else if (variant === 'curved-head-split' && assetPath === 'nodes/body_blob_0.webp') {
        source = opaqueRect(850, 1000, 348, 180, '#0040ff')
      } else if (assetPath === 'nodes/body_blob_0.webp') {
        source = raster(2048, 2048, context => {
          context.fillStyle = '#ff2000'
          context.fillRect(900, 900, 100, 100)
          context.fillStyle = '#0040ff'
          context.fillRect(990, 980, 69, 19)
          context.fillRect(980, 1020, 110, 11)
        })
      } else if (variant === 'curved-head-split' && assetPath === 'nodes/head_round_0.webp') {
        source = raster(2048, 2048, context => {
          context.fillStyle = '#ff2000'
          context.beginPath()
          context.moveTo(900, 900)
          context.lineTo(1148, 900)
          context.lineTo(1148, 1020)
          context.quadraticCurveTo(1024, 1100, 900, 1020)
          context.closePath()
          context.fill()
          context.fillRect(995, 1040, 58, 100)
        })
      } else if (assetPath === 'nodes/head_round_0.webp') {
        source = raster(2048, 2048, context => {
          context.fillStyle = '#ff2000'
          context.fillRect(900, 900, 100, 100)
          context.fillRect(980, 980, 110, 90)
        })
      } else if (assetPath.includes('eyes_asymmetric')) {
        source = opaqueRect(900, 800, 40, 20, '#111111')
      } else if (assetPath.includes('mouth_wide')) {
        source = opaqueRect(900, 900, 40, 20, '#111111')
      } else {
        source = raster(1, 1, () => undefined)
      }
      cache.set(assetPath, source)
      return source
    },
  }
}

async function renderInterfaceFixture(variant: InterfaceVariant): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#render-target')
  if (canvas === null) throw new Error('Missing #render-target canvas')
  canvas.width = 2048
  canvas.height = 2048
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D context unavailable')
  const { catalog: interfaceCatalog, spec } = interfaceFixture(variant)
  const result = await renderMonster(context, spec, interfaceCatalog, interfaceResolver(variant), {
    width: 2048,
    height: 2048,
    includeGroundShadow: true,
  })
  document.body.dataset.interfaceResult = JSON.stringify({
    specJson: JSON.stringify(spec),
    catalogJson: JSON.stringify(interfaceCatalog),
    diagnostics: result.diagnostics,
    connectorMetrics: result.connectorMetrics,
  })
  document.body.dataset.renderComplete = 'true'
}

async function renderBipedSliceFixture(inputUrl: string): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#render-target')
  if (canvas === null) throw new Error('Missing #render-target canvas')
  canvas.width = 2048
  canvas.height = 2048
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D context unavailable')
  const response = await fetch(inputUrl)
  if (!response.ok) throw new Error(`Could not load biped slice input: ${response.status}`)
  // TASK8_STABLE_BEGIN:render-test-diagnostic-input
  const input = await response.json() as {
    catalog: Catalog
    spec: MonsterSpec
    diagnosticScope?: {
      id: string
      activeVisualSlots: VisualSlotId[]
      activeConnectorIds: string[]
    }
    applyPaletteMasks?: boolean
    connectorMetricProjection?: 'task8-task9-neutral-bridge-v1'
    bridgeRoleProjection?: 'task8-task9-cross-product-v1'
  }
  // TASK8_STABLE_END:render-test-diagnostic-input
  const resolvedAssetPaths: string[] = []
  const trackedResolver: ImageResolver = {
    async resolve(assetPath) {
      resolvedAssetPaths.push(assetPath)
      return imageResolver.resolve(assetPath)
    },
  }
  const result = await renderMonster(context, input.spec, input.catalog, trackedResolver, {
    width: 2048,
    height: 2048,
    includeGroundShadow: false,
    // TASK8_STABLE_BEGIN:render-test-diagnostic-option
    ...(input.diagnosticScope === undefined ? {} : { diagnosticScope: input.diagnosticScope }),
    ...(input.applyPaletteMasks === undefined ? {} : { applyPaletteMasks: input.applyPaletteMasks }),
    ...(input.connectorMetricProjection === undefined ? {} : {
      connectorMetricProjection: input.connectorMetricProjection,
    }),
    ...(input.bridgeRoleProjection === undefined ? {} : {
      bridgeRoleProjection: input.bridgeRoleProjection,
    }),
    // TASK8_STABLE_END:render-test-diagnostic-option
  })
  document.body.dataset.interfaceResult = JSON.stringify({
    diagnostics: result.diagnostics,
    connectorMetrics: result.connectorMetrics,
    compositionMetrics: result.compositionMetrics,
    // TASK8_STABLE_BEGIN:render-test-diagnostic-result
    diagnosticScope: result.diagnosticScope,
    // TASK8_STABLE_END:render-test-diagnostic-result
    resolvedAssetPaths,
  })
  document.body.dataset.renderComplete = 'true'
}

const search = new URLSearchParams(location.search)
const requestedInterfaceVariant = search.get('interfaceVariant')
const requestedBipedSlice = search.get('bipedSlice')
const pendingRender = requestedBipedSlice !== null
  ? renderBipedSliceFixture(requestedBipedSlice)
  : requestedInterfaceVariant === 'baseline'
  || requestedInterfaceVariant === 'foreground-hole'
  || requestedInterfaceVariant === 'background-hole'
  // TASK8_STABLE_BEGIN:render-test-transition-hole-route
  || requestedInterfaceVariant === 'transition-hole'
  // TASK8_STABLE_END:render-test-transition-hole-route
  || requestedInterfaceVariant === 'shifted-contour'
  || requestedInterfaceVariant === 'curved-head-split'
  || requestedInterfaceVariant === 'misaligned-occlusion-masks'
  ? renderInterfaceFixture(requestedInterfaceVariant)
  : renderFixture()

void pendingRender.catch((error: unknown) => {
  document.body.dataset.renderError = error instanceof Error ? error.message : String(error)
})
