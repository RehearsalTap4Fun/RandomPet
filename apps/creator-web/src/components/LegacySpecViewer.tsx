import { useRef, useState } from 'react'
import type { Catalog, Diagnostic, MonsterSpec } from '@qmonster/generator-core'
import type { ExportMimeType } from '@qmonster/renderer-canvas'
import { downloadRenderedImage } from '../io/image-file.js'
import { downloadSpec } from '../io/spec-file.js'
import { DiagnosticsPanel } from './DiagnosticsPanel.js'
import { PreviewCanvas } from './PreviewCanvas.js'

interface LegacySpecViewerProps {
  spec: MonsterSpec
  catalog: Catalog
  exportCapabilities: { png: boolean; webp: boolean }
  onReturn: () => void
}

function operationDiagnostic(code: string, message: string): Diagnostic {
  return { severity: 'error', code, path: [], message }
}

export function LegacySpecViewer({
  spec,
  catalog,
  exportCapabilities,
  onReturn,
}: LegacySpecViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])

  const exportJson = () => {
    try {
      downloadSpec(spec)
      setDiagnostics([])
    } catch {
      setDiagnostics([operationDiagnostic('EXPORT_FAILED', '导出失败，请重试。')])
    }
  }
  const exportImage = async (mime: ExportMimeType) => {
    const canvas = canvasRef.current
    if (canvas === null) {
      setDiagnostics([operationDiagnostic('PREVIEW_CANVAS_UNAVAILABLE', '当前预览尚不可用于导出。')])
      return
    }
    try {
      await downloadRenderedImage(canvas, spec, mime)
      setDiagnostics([])
    } catch {
      setDiagnostics([operationDiagnostic('EXPORT_FAILED', '导出失败，请重试。')])
    }
  }

  return (
    <div className="creator-app legacy-spec-viewer">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <div>
            <p className="eyebrow">EXACT LEGACY SPECIMEN</p>
            <h1>旧版标本 · 只读查看</h1>
          </div>
        </div>
        <div className="topbar__actions" role="toolbar" aria-label="旧版标本导出">
          <button type="button" onClick={exportJson}>导出 JSON</button>
          <button type="button" disabled={!exportCapabilities.png} onClick={() => void exportImage('image/png')}>导出透明 PNG</button>
          <button type="button" disabled={!exportCapabilities.webp} onClick={() => void exportImage('image/webp')}>导出透明 WebP</button>
          <button type="button" onClick={onReturn}>返回新版生成器</button>
        </div>
      </header>
      <main className="legacy-spec-viewer__main">
        <section className="legacy-spec-viewer__preview" aria-labelledby="legacy-preview-title">
          <p className="eyebrow">READ ONLY · EXACT CATALOG</p>
          <h2 id="legacy-preview-title">目录 v{catalog.version}</h2>
          <p>此标本使用原目录精确渲染；返回后不会改动新版生成器。</p>
          <div className="preview-stage" data-observation-background="studio">
            <PreviewCanvas
              ref={canvasRef}
              spec={spec}
              catalog={catalog}
              onDiagnosticsChange={setDiagnostics}
            />
          </div>
          <DiagnosticsPanel diagnostics={diagnostics} />
        </section>
      </main>
    </div>
  )
}
