import type { V09ResourceResolver } from '@qmonster/renderer-canvas'
import { createProductionV09ResourceResolver } from './components/PreviewCanvas.js'
import { loadLatestProductionCatalog } from './production-catalog.js'
import {
  loadActiveProductionRelease,
  ProductionReleaseError,
  type ProductionV09Release,
} from './v09-production-release.js'

export type ProductionBootstrapTarget =
  | { kind: 'legacy'; catalog: ReturnType<typeof loadLatestProductionCatalog> }
  | { kind: 'v09'; release: ProductionV09Release; resolver: V09ResourceResolver }

/** Missing means not activated yet; every present-but-invalid pointer remains fail-closed. */
export async function loadProductionBootstrap(
  loadRelease: () => Promise<ProductionV09Release> = loadActiveProductionRelease,
): Promise<ProductionBootstrapTarget> {
  try {
    return { kind: 'v09', release: await loadRelease(), resolver: createProductionV09ResourceResolver() }
  } catch (error) {
    if (error instanceof ProductionReleaseError && error.code === 'ACTIVE_RELEASE_MISSING') {
      return { kind: 'legacy', catalog: loadLatestProductionCatalog() }
    }
    throw error
  }
}
