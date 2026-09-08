import { useCallback, useMemo, useState } from 'react'
import {
  generateMonster,
  selectVisualPart,
  type Catalog,
  type Diagnostic,
} from '@qmonster/generator-core'
import type { ImageResolver } from '@qmonster/renderer-canvas'
import { PreviewCanvas, type PreviewRenderer } from './PreviewCanvas.js'

export interface TraitPreviewCanvasProps {
  catalog: Catalog
  bundleId: string
  partId: string
  renderer?: PreviewRenderer
  resolver?: ImageResolver
}

export function TraitPreviewCanvas({
  catalog,
  bundleId,
  partId,
  renderer,
  resolver,
}: TraitPreviewCanvasProps) {
  const [renderDiagnostics, setRenderDiagnostics] = useState<Diagnostic[]>([])
  const selection = useMemo(() => {
    const bundle = catalog.anatomyBundles?.find(candidate => candidate.id === bundleId)
    const part = catalog.parts.find(candidate => candidate.id === partId)
    if (bundle === undefined || part === undefined) return null
    const generated = generateMonster({
      seed: `catalog-report:${bundleId}:${partId}`,
      themeId: 'fungal',
      mode: 'normal',
      archetypeId: bundle.archetypeId,
    }, catalog)
    if (generated.blocked || generated.spec.anatomyBundleId !== bundleId) return null
    const selected = selectVisualPart({
      spec: generated.spec,
      slotId: part.slotId,
      partId,
      locks: {},
      catalog,
    })
    return selected.blocked ? null : { spec: selected.spec, name: part.displayName ?? part.id }
  }, [bundleId, catalog, partId])
  const onDiagnosticsChange = useCallback((diagnostics: Diagnostic[]) => {
    setRenderDiagnostics(diagnostics)
  }, [])

  if (selection === null) return <span className="trait-preview__unavailable">完整形象暂不可用</span>
  return (
    <div className="trait-preview" role="img" aria-label={`${selection.name} 完整形象预览`}>
      <PreviewCanvas
        spec={selection.spec}
        catalog={catalog}
        onDiagnosticsChange={onDiagnosticsChange}
        {...(renderer === undefined ? {} : { renderer })}
        {...(resolver === undefined ? {} : { resolver })}
      />
      {renderDiagnostics.some(item => item.severity === 'error') && (
        <span className="trait-preview__error">{renderDiagnostics.find(item => item.severity === 'error')!.code}</span>
      )}
    </div>
  )
}
