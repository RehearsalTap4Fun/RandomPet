import { z } from 'zod'
import {
  SEMANTIC_SLOT_IDS,
  V08_BLEND_MODES,
  V08_EXPRESSION_KINDS,
  V08_REGION_IDS,
  VISUAL_SLOT_IDS,
  isStructuralSlot,
  type Catalog,
  type Diagnostic,
  type ParseResult,
} from './contracts.js'

const ThemeIdSchema = z.enum(['deep-sea', 'fungal', 'shadow'])
const RigIdSchema = z.enum(['blob', 'biped', 'floating', 'feline-sit'])
const AnimalArchetypeIdSchema = z.enum(['feline', 'canine', 'lagomorph'])
const SpecialFeatureAnchorSchema = z.enum(['ear', 'back', 'tailTip'])
const VisualSlotIdSchema = z.enum(VISUAL_SLOT_IDS)
const SemanticSlotIdSchema = z.enum(SEMANTIC_SLOT_IDS)
const RenderLayerSchema = z.enum([
  'groundShadow', 'rearAppendage', 'body', 'surface', 'pattern',
  'frontAppendage', 'head', 'faceAndHeadwear', 'foregroundEffect',
])
const coordinate = z.number().finite().min(0).max(2048)
const weight = z.number().finite().min(0)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i)
const nonBlankString = z.string().refine(value => value.trim().length > 0, {
  message: 'Expected a non-blank string.',
})
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
  assetPath: nonBlankString,
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
const BundlePartCompositionSchema = z.object({
  mode: z.literal('bundle'),
  ...CompositionMetadataSchema,
  bundleId: nonBlankString,
  renderNodes: z.array(RenderNodeDefinitionSchema),
  geometryByRig: z.partialRecord(RigIdSchema, CompositionGeometrySchema),
}).strict()
const V08ExpressionKindSchema = z.enum(V08_EXPRESSION_KINDS)
const SpeciesRigPartCompositionSchema = z.object({
  mode: z.literal('species-rig'),
  ...CompositionMetadataSchema,
  speciesRigId: nonBlankString,
  rigVersion: nonBlankString,
  sourceMasterSha256: sha256,
  expressionKind: V08ExpressionKindSchema,
  ownerRegionId: z.enum(V08_REGION_IDS),
  blendMode: z.enum(V08_BLEND_MODES),
  opacity: z.number().finite().min(0).max(1),
}).strict()
const PartCompositionSchema = z.union([
  AttachmentPartCompositionSchema,
  InterfacePartCompositionSchema,
  BundlePartCompositionSchema,
  SpeciesRigPartCompositionSchema,
])
const CompositionPolicySchema = z.object({
  motifSlots: z.array(VisualSlotIdSchema),
  surpriseRatio: z.literal(0.3),
  maxStrongFeatures: z.literal(2),
  maxStrongNonFacialFeatures: z.literal(1).optional(),
  optionalNoneRate: z.object({ min: z.literal(0.35), max: z.literal(0.5) }).strict(),
  frameBounds: RectSchema,
  faceInsideRatio: z.union([z.literal(0.8), z.literal(0.84)]),
  faceVisibleRatio: z.union([z.literal(0.84), z.literal(0.85)]),
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

const AnimalArchetypeDefinitionSchema = z.object({
  id: AnimalArchetypeIdSchema,
  displayName: z.string().min(1),
  rigIds: z.array(RigIdSchema).min(1),
  defaultRigId: RigIdSchema,
  requiredVisibleSlots: z.array(VisualSlotIdSchema),
  integratedSlots: z.array(VisualSlotIdSchema),
  specialFeatureSlots: z.array(VisualSlotIdSchema),
}).strict().superRefine((archetype, context) => {
  if (!archetype.rigIds.includes(archetype.defaultRigId)) {
    context.addIssue({
      code: 'custom',
      path: ['defaultRigId'],
      message: 'Archetype default rig must be one of its supported rigs.',
    })
  }
})

const ResourceRefSchema = z.object({
  assetPath: nonBlankString,
  assetSha256: sha256,
  pngPath: nonBlankString,
  pngSha256: sha256,
}).strict()
const V08RegionResourcesSchema = z.object(Object.fromEntries(
  V08_REGION_IDS.map(regionId => [regionId, ResourceRefSchema]),
) as Record<typeof V08_REGION_IDS[number], typeof ResourceRefSchema>).strict()
const V08AllowedSlotExpressionsSchema = z.object(Object.fromEntries(
  VISUAL_SLOT_IDS.map(slotId => [slotId, V08ExpressionKindSchema]),
) as unknown as Record<typeof VISUAL_SLOT_IDS[number], typeof V08ExpressionKindSchema>).strict()
const SpeciesRigContractSchema = z.object({
  schemaVersion: z.literal('qmonster-species-rig-v1'),
  id: nonBlankString,
  rigVersion: nonBlankString,
  archetypeId: AnimalArchetypeIdSchema,
  rigId: RigIdSchema,
  poseId: nonBlankString,
  canvas: z.object({ width: z.literal(2048), height: z.literal(2048) }).strict(),
  coordinatePolicy: z.literal('fixed-canvas-no-trim'),
  sourceMasterSha256: sha256,
  regions: V08RegionResourcesSchema,
  layerOrder: z.array(VisualSlotIdSchema).length(VISUAL_SLOT_IDS.length),
  allowedSlotExpressions: V08AllowedSlotExpressionsSchema,
}).strict().superRefine((speciesRig, context) => {
  if (new Set(speciesRig.layerOrder).size !== VISUAL_SLOT_IDS.length) {
    context.addIssue({
      code: 'custom',
      path: ['layerOrder'],
      message: 'Species rig layer order must contain each visual slot exactly once.',
    })
  }
})
const AnatomyBundleBaseSchema = z.object({
  id: nonBlankString,
  archetypeId: AnimalArchetypeIdSchema,
  rigId: RigIdSchema,
  poseId: nonBlankString,
  rarity: z.enum(['N', 'R', 'L']),
  baseWeight: weight,
  structural: ResourceRefSchema,
  alpha: ResourceRefSchema,
  clip: ResourceRefSchema,
  faceSafeZone: RectSchema,
  featureSockets: z.record(z.string().min(1), Point2DSchema),
  mutationAnchors: z.record(z.string().min(1), RectSchema),
  speciesRigId: nonBlankString.optional(),
  sourceMasterSha256: sha256.optional(),
})
const AnatomyBundleDefinitionSchema = AnatomyBundleBaseSchema.extend({
  derivedSlots: z.object({
    bodyFrame: nonBlankString,
    headShape: nonBlankString,
    arms: nonBlankString,
    legs: nonBlankString,
    tail: nonBlankString,
    extraAppendage: nonBlankString,
  }).strict(),
  allowedTraitPools: z.object({
    eyes: z.array(nonBlankString).min(1),
    mouthShape: z.array(nonBlankString).min(1),
    oralDetail: z.array(nonBlankString).min(1),
    headAppendage: z.array(nonBlankString).min(1),
    surfaceMaterial: z.array(nonBlankString).min(1),
    pattern: z.array(nonBlankString).min(1),
    colorScheme: z.array(nonBlankString).min(1),
    effect: z.array(nonBlankString).min(1),
  }).strict(),
}).strict()
const IndependentPartAnatomyBundleDefinitionSchema = AnatomyBundleBaseSchema.extend({
  partPools: z.object({
    bodyFrame: z.array(nonBlankString).min(1),
    headShape: z.array(nonBlankString).min(1),
    eyes: z.array(nonBlankString).min(1),
    mouthShape: z.array(nonBlankString).min(1),
    oralDetail: z.array(nonBlankString).min(1),
    headAppendage: z.array(nonBlankString).min(1),
    arms: z.array(nonBlankString).min(1),
    legs: z.array(nonBlankString).min(1),
    tail: z.array(nonBlankString).min(1),
    extraAppendage: z.array(nonBlankString).min(1),
    surfaceMaterial: z.array(nonBlankString).min(1),
    pattern: z.array(nonBlankString).min(1),
    colorScheme: z.array(nonBlankString).min(1),
    effect: z.array(nonBlankString).min(1),
  }).strict(),
}).strict()
const V07AnatomyBundleDefinitionSchema = AnatomyBundleDefinitionSchema.extend({
  partPools: IndependentPartAnatomyBundleDefinitionSchema.shape.partPools,
}).strict()
const V08AnatomyBundleDefinitionSchema = IndependentPartAnatomyBundleDefinitionSchema.extend({
  speciesRigId: nonBlankString,
  sourceMasterSha256: sha256,
}).strict()

const VisualPartDefinitionSchema = z.object({
  id: z.string().min(1),
  slotId: VisualSlotIdSchema,
  rarity: z.enum(['N', 'R', 'L']),
  baseWeight: weight,
  themeIds: z.array(ThemeIdSchema).min(1),
  themeWeights: z.partialRecord(ThemeIdSchema, weight),
  compatibleRigs: z.array(RigIdSchema).min(1),
  assetPath: z.string(),
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
  archetypeIds: z.array(AnimalArchetypeIdSchema).min(1).optional(),
  featureTier: z.enum(['base', 'special']).optional(),
  specialFeatureAnchor: SpecialFeatureAnchorSchema.optional(),
}).superRefine((part, context) => {
  const resourceEmptyNone = part.composition?.isNone === true && part.assetPath === ''
  if (!resourceEmptyNone && part.assetPath.trim().length === 0) {
    context.addIssue({ code: 'custom', path: ['assetPath'], message: 'Visible parts require an asset path.' })
  }
  if (resourceEmptyNone && (
    part.assetSha256 !== undefined || part.pngPath !== undefined || part.pngSha256 !== undefined
  )) {
    context.addIssue({ code: 'custom', path: ['assetPath'], message: 'Resource-empty none parts must not declare runtime hashes or PNG paths.' })
  }
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
  archetypes: z.array(AnimalArchetypeDefinitionSchema).min(1).optional(),
  anatomyBundles: z.array(z.union([
    AnatomyBundleDefinitionSchema,
    IndependentPartAnatomyBundleDefinitionSchema,
    V07AnatomyBundleDefinitionSchema,
    V08AnatomyBundleDefinitionSchema,
  ])).min(1).optional(),
  speciesRigs: z.array(SpeciesRigContractSchema).min(1).optional(),
}).superRefine((catalog, context) => {
  const isInterfaceCatalog = catalog.version === '0.3.0' || catalog.version === '0.4.0' || catalog.version === '0.5.0' || catalog.version === '0.7.0'
  if (catalog.version === '0.6.0') {
    if (catalog.anatomyBundles === undefined || catalog.anatomyBundles.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['anatomyBundles'],
        message: 'Catalog 0.6.0 requires at least one anatomy bundle.',
      })
    }
    if (catalog.transitionBridges !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['transitionBridges'],
        message: 'Catalog 0.6.0 cannot define transition bridges.',
      })
    }
    if (catalog.archetypes === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['archetypes'],
        message: 'Catalog 0.6.0 requires archetype definitions.',
      })
    } else if (
      catalog.archetypes.length !== 1
      || catalog.archetypes[0]?.id !== 'feline'
      || catalog.archetypes[0].defaultRigId !== 'feline-sit'
      || catalog.archetypes[0].rigIds.length !== 1
      || catalog.archetypes[0].rigIds[0] !== 'feline-sit'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['archetypes'],
        message: 'Catalog 0.6.0 supports only the feline-sit archetype.',
      })
    }
    if (catalog.rigs.length !== 1 || catalog.rigs[0]?.id !== 'feline-sit') {
      context.addIssue({
        code: 'custom',
        path: ['rigs'],
        message: 'Catalog 0.6.0 requires exactly one feline-sit rig.',
      })
    }
    for (const [index, bundle] of (catalog.anatomyBundles ?? []).entries()) {
      if (!('derivedSlots' in bundle) || !('allowedTraitPools' in bundle)) {
        context.addIssue({
          code: 'custom',
          path: ['anatomyBundles', index],
          message: 'Catalog 0.6.0 anatomy bundles require derived slots and allowed trait pools.',
        })
      }
    }
    for (const [index, part] of catalog.parts.entries()) {
      if (part.archetypeIds === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'archetypeIds'],
          message: 'Catalog 0.6.0 parts require archetype compatibility.',
        })
      } else if (part.archetypeIds.length !== 1 || part.archetypeIds[0] !== 'feline') {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'archetypeIds'],
          message: 'Catalog 0.6.0 parts support only the feline archetype.',
        })
      }
      if (isStructuralSlot(part.slotId) && part.composition?.mode === 'interface') {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'composition', 'mode'],
          message: 'Catalog 0.6.0 structural parts cannot use interface composition metadata.',
        })
      }
    }
  }
  if (catalog.version === '0.7.0') {
    if (catalog.anatomyBundles === undefined || catalog.anatomyBundles.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['anatomyBundles'],
        message: 'Catalog 0.7.0 requires at least one independent-part anatomy bundle.',
      })
    }
    if (
      catalog.archetypes === undefined
      || catalog.archetypes.length !== 1
      || catalog.archetypes[0]?.id !== 'feline'
      || catalog.archetypes[0].rigIds.length !== 1
      || catalog.archetypes[0].rigIds[0] !== 'feline-sit'
      || catalog.archetypes[0].defaultRigId !== 'feline-sit'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['archetypes'],
        message: 'Catalog 0.7.0 supports only the feline-sit archetype.',
      })
    }
    if (catalog.rigs.length !== 1 || catalog.rigs[0]?.id !== 'feline-sit') {
      context.addIssue({
        code: 'custom',
        path: ['rigs'],
        message: 'Catalog 0.7.0 requires exactly one feline-sit rig.',
      })
    }
    for (const [index, bundle] of (catalog.anatomyBundles ?? []).entries()) {
      if (!('partPools' in bundle) || bundle.archetypeId !== 'feline' || bundle.rigId !== 'feline-sit') {
        context.addIssue({
          code: 'custom',
          path: ['anatomyBundles', index],
          message: 'Catalog 0.7.0 anatomy bundles require feline-sit independent part pools.',
        })
      }
    }
    for (const [index, part] of catalog.parts.entries()) {
      if (part.archetypeIds?.length !== 1 || part.archetypeIds[0] !== 'feline') {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'archetypeIds'],
          message: 'Catalog 0.7.0 parts support only the feline archetype.',
        })
      }
    }
  }
  if (catalog.version === '0.8.0') {
    if (catalog.speciesRigs === undefined || catalog.speciesRigs.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['speciesRigs'],
        message: 'Catalog 0.8.0 requires at least one species rig.',
      })
    }
    if (catalog.anatomyBundles === undefined || catalog.anatomyBundles.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['anatomyBundles'],
        message: 'Catalog 0.8.0 requires at least one species-rig anatomy bundle.',
      })
    }
    if (catalog.transitionBridges !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['transitionBridges'],
        message: 'Catalog 0.8.0 cannot define transition bridges.',
      })
    }
    if (
      catalog.archetypes === undefined
      || catalog.archetypes.length !== 1
      || catalog.archetypes[0]?.id !== 'feline'
      || catalog.archetypes[0].rigIds.length !== 1
      || catalog.archetypes[0].rigIds[0] !== 'feline-sit'
      || catalog.archetypes[0].defaultRigId !== 'feline-sit'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['archetypes'],
        message: 'Catalog 0.8.0 supports only the feline-sit archetype.',
      })
    }
    if (catalog.rigs.length !== 1 || catalog.rigs[0]?.id !== 'feline-sit') {
      context.addIssue({
        code: 'custom',
        path: ['rigs'],
        message: 'Catalog 0.8.0 requires exactly one feline-sit rig.',
      })
    }
    for (const [index, bundle] of (catalog.anatomyBundles ?? []).entries()) {
      if (
        !('partPools' in bundle)
        || bundle.speciesRigId === undefined
        || bundle.sourceMasterSha256 === undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['anatomyBundles', index],
          message: 'Catalog 0.8.0 anatomy bundles require a species rig, master hash, and complete part pools.',
        })
      }
    }
    for (const [index, part] of catalog.parts.entries()) {
      if (part.composition?.mode !== 'species-rig') {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'composition', 'mode'],
          message: 'Catalog 0.8.0 parts require species-rig composition metadata.',
        })
      }
    }
  }
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
      } else if (part.composition.mode === 'interface' || part.composition.mode === 'bundle') {
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
  if ((catalog.version === '0.4.0' || catalog.version === '0.5.0') && catalog.compositionPolicy?.maxStrongNonFacialFeatures === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['compositionPolicy', 'maxStrongNonFacialFeatures'],
      message: 'Catalog 0.4.0 and 0.5.0 require a maximum of one strong non-facial feature.',
    })
  }
  if (!isInterfaceCatalog) return
  if (catalog.transitionBridges === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['transitionBridges'],
      message: `Catalog ${catalog.version} requires transition bridge definitions.`,
    })
  }
  const bridgeIds = (catalog.transitionBridges ?? []).map(bridge => bridge.id)
  if (new Set(bridgeIds).size !== bridgeIds.length) {
    context.addIssue({ code: 'custom', path: ['transitionBridges'], message: `Catalog ${catalog.version} transition bridge IDs must be unique.` })
  }
  for (const [index, part] of catalog.parts.entries()) {
    if (!isStructuralSlot(part.slotId) || part.composition?.isNone) continue
    const composition = part.composition
    if (composition?.mode !== 'interface') {
      context.addIssue({
        code: 'custom',
        path: ['parts', index, 'composition'],
        message: `Catalog ${catalog.version} structural parts require interface composition metadata.`,
      })
      continue
    }
    for (const rigId of part.compatibleRigs) {
      const variant = composition.variantsByRig[rigId]
      if (variant === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'composition', 'variantsByRig', rigId],
          message: `Catalog ${catalog.version} structural part ${part.id} requires an exact ${rigId} variant.`,
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
