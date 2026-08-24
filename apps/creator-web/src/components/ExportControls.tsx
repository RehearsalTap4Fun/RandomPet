import { useEffect, useRef, type ChangeEvent, type RefObject } from 'react'
import type { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import { CanvasExportError, type ExportMimeType } from '@qmonster/renderer-canvas'
import type { Catalog, Diagnostic, MonsterSpec } from '@qmonster/generator-core'
import type { CreatorSession } from '../state/contracts.js'
import { downloadRenderedImage } from '../io/image-file.js'
import { downloadSpec, parseSpecFile } from '../io/spec-file.js'

export interface ExportControlsProps {
  session: CreatorSession
  registry: CatalogRegistry
  canvasRef: RefObject<HTMLCanvasElement | null>
  onImportComplete: (payload: { spec: MonsterSpec; catalog: Catalog }) => void
  onOperationDiagnostics: (diagnostics: Diagnostic[]) => void
  parseSpecFile?: typeof parseSpecFile
}

function operationDiagnostic(
  severity: Diagnostic['severity'],
  code: string,
  message: string,
): Diagnostic {
  return { severity, code, path: [], message }
}

function exportFailure(error: unknown): Diagnostic {
  if (error instanceof CanvasExportError && error.code === 'WEBP_EXPORT_UNSUPPORTED') {
    return operationDiagnostic(
      'warning',
      error.code,
      '当前浏览器不支持 WebP 编码，请改用 PNG。',
    )
  }
  const code = error instanceof CanvasExportError ? error.code : 'EXPORT_FAILED'
  return operationDiagnostic('error', code, '导出失败，请重试。')
}

export function ExportControls({
  session,
  registry,
  canvasRef,
  onImportComplete,
  onOperationDiagnostics,
  parseSpecFile: parseImportedSpec = parseSpecFile,
}: ExportControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importRequestId = useRef(0)
  const mounted = useRef(true)
  const exportsBlocked = session.blocked

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      importRequestId.current += 1
    }
  }, [])

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file === undefined) return
    const requestId = ++importRequestId.current
    onOperationDiagnostics([])
    const result = await parseImportedSpec(file, registry)
    if (!mounted.current || requestId !== importRequestId.current) return
    input.value = ''
    if (!result.ok) {
      onOperationDiagnostics(result.diagnostics)
      return
    }
    onOperationDiagnostics(result.diagnostics)
    onImportComplete(result.value)
  }

  const exportJson = () => {
    onOperationDiagnostics([])
    try {
      downloadSpec(session.spec)
    } catch (error) {
      onOperationDiagnostics([exportFailure(error)])
    }
  }

  const exportImage = async (mime: ExportMimeType) => {
    onOperationDiagnostics([])
    const canvas = canvasRef.current
    if (canvas === null) {
      onOperationDiagnostics([operationDiagnostic(
        'error',
        'PREVIEW_CANVAS_UNAVAILABLE',
        '当前预览尚不可用于导出。',
      )])
      return
    }
    try {
      await downloadRenderedImage(canvas, session.spec, mime)
    } catch (error) {
      onOperationDiagnostics([exportFailure(error)])
    }
  }

  return (
    <div className="topbar__actions" role="toolbar" aria-label="数据与导出">
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="application/json,.json"
        aria-label="选择要导入的 JSON 文件"
        onChange={event => void importFile(event)}
      />
      <button type="button" onClick={() => fileInputRef.current?.click()}>导入 JSON</button>
      <button type="button" disabled={exportsBlocked} onClick={exportJson}>导出 JSON</button>
      <button
        type="button"
        disabled={exportsBlocked || !session.exportCapabilities.png}
        onClick={() => void exportImage('image/png')}
      >
        导出透明 PNG
      </button>
      <button
        type="button"
        disabled={exportsBlocked || !session.exportCapabilities.webp}
        aria-describedby={session.exportCapabilities.webp ? undefined : 'webp-export-unavailable'}
        onClick={() => void exportImage('image/webp')}
      >
        导出透明 WebP
      </button>
      {!session.exportCapabilities.webp && (
        <p className="export-capability-warning" id="webp-export-unavailable" role="status">
          当前浏览器不支持 WebP 编码，请改用 PNG。
        </p>
      )}
    </div>
  )
}
