import { z } from 'zod'
import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type ParseResult,
} from './contracts.js'

const ThemeIdSchema = z.enum(['deep-sea', 'fungal', 'shadow'])
const RigIdSchema = z.enum(['blob', 'biped', 'floating'])
const VisualSlotIdSchema = z.enum(VISUAL_SLOT_IDS)
const SemanticSlotIdSchema = z.enum(SEMANTIC_SLOT_IDS)
const RenderLayerSchema = z.enum([
  'groundShadow', 'rearAppendage', 'body', 'surface', 'pattern',
  'frontAppendage', 'head', 'faceAndHeadwear', 'foregroundEffect',
])
const coordinate = z.number().finite().min(0).max(2048)
const weight = z.number().finite().min(0)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i)
const LegacyApprovedTransformSchema = z.object({
  scale: z.number().finite().positive(),
  mirrorX: z.boolean(),
})
const CompositionTransformSchema = z.object({
  scale: z.number().finite().positive(),
  mirrorX: z.boolean(),
}).strict()
const Point2DSchema = z.object({ x: coordinate, y: coordinate }).strict()
const RectSchema = z.object({
  x: coordinate,
  y: coordinate,
  width: z.number().finite().positive().max(2048),
  height: z.number().finite().positive().max(2048),
}).strict().refine(rect => rect.x + rect.width <= 2048 && rect.y + rect.height <= 2048, {
  message: 'Rectangle must fit inside the 2048px local canvas.',
})
const RenderNodeDefinitionSchema = z.object({
  id: z.string().min(1),
  connectorId: z.string().min(1).optional(),
  assetPath: z.string().min(1),
  pngPath: z.string().min(1).optional(),
  assetSha256: sha256.optional(),
  pngSha256: sha256.optional(),
  parentSlot: VisualSlotIdSchema.nullable(),
  socket: z.string().min(1).nullable(),
  origin: Point2DSchema,
  transform: CompositionTransformSchema,
  layer: RenderLayerSchema,
  compatibleRigs: z.array(RigIdSchema).min(1),
  clipPolicy: z.enum(['none', 'body', 'protect-face']),
}).strict()
const CompositionGeometrySchema = z.object({
  sockets: z.record(z.string().min(1), Point2DSchema),
  faceSafeZone: RectSchema.optional(),
}).strict()
const CompositionMetadataSchema = {
  isNone: z.boolean(),
  motifTags: z.array(ThemeIdSchema),
  visualIntensity: z.enum(['quiet', 'strong']),
}
const AttachmentPartCompositionSchema = z.object({
  mode: z.literal('attachment').optional(),
  ...CompositionMetadataSchema,
  renderNodes: z.array(RenderNodeDefinitionSchema),
  geometryByRig: z.partialRecord(RigIdSchema, CompositionGeometrySchema),
}).strict()
const vector = z.object({
  x: z.number().finite().min(-1).max(1),
  y: z.number().finite().min(-1).max(1),
}).strict()
const boundedRange = z.object({
  min: z.number().finite(),
  max: z.number().finite(),
}).strict().refine(range => range.min <= range.max, {
  message: 'Range minimum must not exceed its maximum.',
})
const ConnectorProfileSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['receiver', 'plug']),
  connectorClass: z.enum(['neck', 'shoulder', 'hip', 'tail', 'extra']),
  rigId: RigIdSchema,
  origin: Point2DSchema,
  tangent: vector,
  outwardNormal: vector,
  width: z.number().finite().positive(),
  depth: z.number().finite().positive(),
  contourMaskPath: z.string().min(1),
  contourMaskSha256: sha256,
  foregroundMaskPath: z.string().min(1),
  foregroundMaskSha256: sha256,
  backgroundMaskPath: z.string().min(1),
  backgroundMaskSha256: sha256,
  materialSampleRegion: RectSchema,
  warpLimits: z.object({
    widthRatio: boundedRange,
    depthRatio: boundedRange,
    rotationDegrees: boundedRange,
  }).strict(),
}).strict()
const StructuralVariantDefinitionSchema = z.object({
  rigId: RigIdSchema,
  materialFamily: z.enum(['short-fur', 'mushroom-velvet', 'soft-skin']),
  renderNodes: z.array(RenderNodeDefinitionSchema),
  connectors: z.array(ConnectorProfileSchema),
  faceSafeZones: z.array(RectSchema).optional(),
  featureSockets: z.record(z.string().min(1), Point2DSchema).optional(),
}).strict()
const InterfacePartCompositionSchema = z.object({
  mode: z.literal('interface'),
  ...CompositionMetadataSchema,
  variantsByRig: z.partialRecord(RigIdSchema, StructuralVariantDefinitionSchema),
}).strict()
const PartCompositionSchema = z.union([
  AttachmentPartCompositionSchema,
  InterfacePartCompositionSchema,
])
const CompositionPolicySchema = z.object({
  motifSlots: z.array(VisualSlotIdSchema),
  surpriseRatio: z.literal(0.3),
  maxStrongFeatures: z.literal(2),
  optionalNoneRate: z.object({ min: z.literal(0.35), max: z.literal(0.5) }).strict(),
  frameBounds: RectSchema,
  faceInsideRatio: z.literal(0.8),
  faceVisibleRatio: z.literal(0.85),
}).strict()
const TransitionBridgeDefinitionSchema = z.object({
  id: z.string().min(1),
  rigId: RigIdSchema,
  connectorClass: z.enum(['neck', 'shoulder', 'hip', 'tail', 'extra']),
  materialFamilies: z.array(z.enum(['short-fur', 'mushroom-velvet', 'soft-skin'])).min(1),
  neutralAssetPath: z.string().min(1),
  neutralPngPath: z.string().min(1),
  neutralAssetSha256: sha256,
  neutralPngSha256: sha256,
  frontMaskPath: z.string().min(1),
  frontMaskSha256: sha256,
  backMaskPath: z.string().min(1),
  backMaskSha256: sha256,
}).strict()
const displayMetadata = {
  displayName: z.string().min(1).optional(),
  flavorText: z.string().min(1).optional(),
}
const productionMetadata = {
  ...displayMetadata,
  rarity: z.enum(['N', 'R', 'L']).optional(),
  themeBoosts: z.partialRecord(ThemeIdSchema, weight).optional(),
  excludes: z.array(z.string().min(1)).optional(),
  boosts: z.record(z.string().min(1), weight).optional(),
  visualMapping: z.record(z.string().min(1), z.unknown()).optional(),
}

const PaletteSchema = z.object({
  primary: z.string().min(1),
  secondary: z.string().min(1),
  accent: z.string().min(1),
})

const ModifierOverridesSchema = z.object({
  palette: PaletteSchema.optional(),
  duplicateLayerGroup: z.literal('head').optional(),
  relocateSlot: z.literal('eyes').optional(),
  socket: z.string().min(1).optional(),
}).strict().superRefine((overrides, context) => {
  if (
    (overrides.duplicateLayerGroup !== undefined || overrides.relocateSlot !== undefined)
    && overrides.socket === undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['socket'],
      message: 'Behavioral modifier overrides require a destination socket.',
    })
  }
})

const RigDefinitionSchema = z.object({
  id: RigIdSchema,
  sockets: z.record(z.string().min(1), z.object({ x: coordinate, y: coordinate })),
  sourceId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
})

const VisualPartDefinitionSchema = z.object({
  id: z.string().min(1),
  slotId: VisualSlotIdSchema,
  rarity: z.enum(['N', 'R', 'L']),
  baseWeight: weight,
  themeIds: z.array(ThemeIdSchema).min(1),
  themeWeights: z.partialRecord(ThemeIdSchema, weight),
  compatibleRigs: z.array(RigIdSchema).min(1),
  assetPath: z.string().min(1),
  assetSha256: sha256.optional(),
  pngPath: z.string().min(1).optional(),
  pngSha256: sha256.optional(),
  approvedTransforms: z.array(LegacyApprovedTransformSchema).optional(),
  maskPaths: z.object({ primary: z.string().min(1).optional(), secondary: z.string().min(1).optional() }),
  maskSha256: z.object({ primary: z.string().regex(/^[a-f0-9]{64}$/i).optional(), secondary: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).optional(),
  rigMaskPaths: z.partialRecord(RigIdSchema, z.object({
    primary: z.string().min(1),
    secondary: z.string().min(1),
    accent: z.string().min(1),
  })).optional(),
  rigMaskSha256: z.partialRecord(RigIdSchema, z.object({
    primary: sha256,
    secondary: sha256,
    accent: sha256,
  })).optional(),
  origin: z.object({ x: coordinate, y: coordinate }),
  socket: z.string().min(1).nullable(),
  layer: RenderLayerSchema,
  semanticTraitId: z.string().min(1).nullable(),
  semanticPriority: z.number().finite(),
  excludes: z.array(z.string().min(1)),
  boosts: z.record(z.string().min(1), weight),
  ...displayMetadata,
  description: z.string().min(1).optional(),
  composition: PartCompositionSchema.optional(),
})

export const CatalogSchema = z.object({
  version: z.string().min(1),
  themes: z.array(z.object({ id: ThemeIdSchema, palette: PaletteSchema, ...displayMetadata })),
  rigs: z.array(RigDefinitionSchema),
  parts: z.array(VisualPartDefinitionSchema),
  semanticTraits: z.array(z.object({
    id: z.string().min(1),
    semanticSlotId: SemanticSlotIdSchema,
    ...productionMetadata,
  })),
  modifiers: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['mutation', 'aberration']),
    baseWeight: weight,
    requiresMutation: z.boolean(),
    overrides: ModifierOverridesSchema,
    ...productionMetadata,
  })),
  dependencies: z.partialRecord(VisualSlotIdSchema, z.array(VisualSlotIdSchema)),
  compositionPolicy: CompositionPolicySchema.optional(),
  transitionBridges: z.array(TransitionBridgeDefinitionSchema).optional(),
}).superRefine((catalog, context) => {
  if (catalog.version === '0.2.0') {
    if (catalog.compositionPolicy === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['compositionPolicy'],
        message: 'Catalog 0.2.0 requires composition metadata.',
      })
    }
    for (const [index, part] of catalog.parts.entries()) {
      if (part.composition === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'composition'],
          message: 'Catalog 0.2.0 requires composition metadata for every part.',
        })
      } else if (part.composition.mode === 'interface') {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'composition', 'mode'],
          message: 'Catalog 0.2.0 supports attachment composition metadata only.',
        })
      }
    }
  }
  if (catalog.version === '0.1.0' && catalog.compositionPolicy !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['compositionPolicy'],
      message: 'Catalog 0.1.0 does not support composition policy metadata.',
    })
  }
  if (catalog.version !== '0.3.0') return
  if (catalog.transitionBridges === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['transitionBridges'],
      message: 'Catalog 0.3.0 requires transition bridge definitions.',
    })
  }
  const bridgeIds = (catalog.transitionBridges ?? []).map(bridge => bridge.id)
  if (new Set(bridgeIds).size !== bridgeIds.length) {
    context.addIssue({ code: 'custom', path: ['transitionBridges'], message: 'Catalog 0.3.0 transition bridge IDs must be unique.' })
  }
  const structuralSlots = new Set(['bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage'])
  for (const [index, part] of catalog.parts.entries()) {
    if (!structuralSlots.has(part.slotId) || part.composition?.isNone) continue
    const composition = part.composition
    if (composition?.mode !== 'interface') {
      context.addIssue({
        code: 'custom',
        path: ['parts', index, 'composition'],
        message: 'Catalog 0.3.0 structural parts require interface composition metadata.',
      })
      continue
    }
    for (const rigId of part.compatibleRigs) {
      const variant = composition.variantsByRig[rigId]
      if (variant === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'composition', 'variantsByRig', rigId],
          message: `Catalog 0.3.0 structural part ${part.id} requires an exact ${rigId} variant.`,
        })
        continue
      }
      const plugIds = variant.connectors
        .filter(connector => connector.role === 'plug')
        .map(connector => connector.id)
      if (plugIds.length === 0) continue
      const nodeConnectorIds = variant.renderNodes.map(node => node.connectorId)
      const hasOneNodePerPlug = nodeConnectorIds.length === plugIds.length
        && nodeConnectorIds.every((id): id is string => id !== undefined)
        && new Set(nodeConnectorIds).size === nodeConnectorIds.length
        && plugIds.every(id => nodeConnectorIds.includes(id))
      if (!hasOneNodePerPlug) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'composition', 'variantsByRig', rigId, 'renderNodes'],
          message: 'Every plug connector requires exactly one render node with the same connectorId.',
        })
      }
    }
  }
})

function toDiagnostic(issue: z.core.$ZodIssue): Diagnostic {
  return {
    severity: 'error',
    code: `CATALOG_SCHEMA_${issue.code.toUpperCase()}`,
    path: issue.path.map(String),
    message: issue.message,
  }
}

export function parseCatalog(input: unknown): ParseResult<Catalog> {
  const parsed = CatalogSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, diagnostics: parsed.error.issues.map(toDiagnostic) }
  }

  return { ok: true, value: parsed.data as Catalog }
}
