import {
  V08_CATALOG_VERSION,
  V08_RENDERER_VERSION,
  V08_SPEC_SCHEMA_VERSION,
  type Catalog,
  type MonsterSpec,
  type SpeciesRigContract,
  type V08SpeciesRigCatalog,
} from './contracts.js'

export function isSpeciesRigCatalog(catalog: Catalog): catalog is V08SpeciesRigCatalog {
  return catalog.version === V08_CATALOG_VERSION
    && Array.isArray(catalog.speciesRigs)
    && catalog.speciesRigs.length > 0
    && Array.isArray(catalog.anatomyBundles)
    && catalog.anatomyBundles.length > 0
    && catalog.anatomyBundles.every(bundle => (
      typeof bundle.speciesRigId === 'string'
      && typeof bundle.sourceMasterSha256 === 'string'
      && bundle.partPools !== undefined
    ))
}

export function resolveSpeciesRig(
  spec: MonsterSpec,
  catalog: Catalog,
): SpeciesRigContract | null {
  if (!isSpeciesRigCatalog(catalog)) return null
  if (
    spec.schemaVersion !== V08_SPEC_SCHEMA_VERSION
    || spec.catalogVersion !== V08_CATALOG_VERSION
    || spec.rendererVersion !== V08_RENDERER_VERSION
    || spec.archetypeId === undefined
    || spec.anatomyBundleId === undefined
    || spec.speciesRigId === undefined
  ) return null

  const bundle = catalog.anatomyBundles.find(candidate => candidate.id === spec.anatomyBundleId)
  const speciesRig = catalog.speciesRigs.find(candidate => candidate.id === spec.speciesRigId)
  if (bundle === undefined || speciesRig === undefined) return null
  if (
    bundle.speciesRigId !== speciesRig.id
    || bundle.sourceMasterSha256 !== speciesRig.sourceMasterSha256
    || bundle.archetypeId !== spec.archetypeId
    || speciesRig.archetypeId !== spec.archetypeId
    || bundle.rigId !== speciesRig.rigId
    || bundle.poseId !== speciesRig.poseId
  ) return null
  if (Object.values(spec.visualSlots).some(selection => selection.rigId !== speciesRig.rigId)) return null

  return speciesRig
}
