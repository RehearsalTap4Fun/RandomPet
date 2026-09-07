import {
  resolveAnatomyBundle,
  type AnatomyBundleDefinition,
  type Catalog,
  type MonsterSpec,
  type Rect,
  type RenderNodeDefinition,
  type ResourceRef,
} from '@qmonster/generator-core'

export interface AnatomyBundleRenderPlan {
  bundle: AnatomyBundleDefinition
  structuralNode: RenderNodeDefinition
  faceSafeZones: Rect[]
  localClipMask: ResourceRef
  bridges: []
}

function isExactV06BundleTuple(spec: MonsterSpec, catalog: Catalog): boolean {
  return catalog.version === '0.6.0'
    && spec.catalogVersion === '0.6.0'
    && spec.rendererVersion === '0.6.0'
    && spec.schemaVersion === '0.2.0'
    && spec.archetypeId === 'feline'
}

export function resolveAnatomyBundleRenderPlan(
  spec: MonsterSpec,
  catalog: Catalog,
): AnatomyBundleRenderPlan | null {
  if (!isExactV06BundleTuple(spec, catalog)) return null
  const bundle = resolveAnatomyBundle(spec, catalog)
  if (bundle === null) return null
  const bodyPart = catalog.parts.find(part => (
    part.slotId === 'bodyFrame' && part.id === bundle.derivedSlots.bodyFrame
  ))
  const structuralNode = bodyPart?.composition?.mode === 'bundle'
    && bodyPart.composition.bundleId === bundle.id
    ? bodyPart.composition.renderNodes.find(node => node.assetPath === bundle.structural.assetPath)
    : undefined
  if (structuralNode === undefined) return null

  return {
    bundle,
    structuralNode,
    faceSafeZones: [bundle.faceSafeZone],
    localClipMask: bundle.clip,
    bridges: [],
  }
}
