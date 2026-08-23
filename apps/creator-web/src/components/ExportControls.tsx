import { useRef, type ChangeEvent, type RefObject } from 'react'
import { CatalogRegistry } from '@qmonster/asset-catalog'
import { CanvasExportError, type ExportMimeType } from '@qmonster/renderer-canvas'
import type { Diagnostic, MonsterSpec } from '@qmonster/generator-core'
import type { CreatorSession } from '../state/contracts.js'
import { downloadRenderedImage } from '../io/image-file.js'
import { downloadSpec, parseSpecFile } from '../io/spec-file.js'

export interface ExportControlsProps {
  session: CreatorSession
  registry: CatalogRegistry
  canvasRef: RefObject<HTMLCanvasElement | null>
  onImportComplete: (spec: MonsterSpec) => void
  onOperationDiagnostics: (diagnostics: Diagnostic[]) => void
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
}: ExportControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const exportsBlocked = session.blocked

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file === undefined) return
    onOperationDiagnostics([])
    const result = await parseSpecFile(file, registry)
    input.value = ''
    if (!result.ok) {
      onOperationDiagnostics(result.diagnostics)
      return
    }
    onOperationDiagnostics(result.diagnostics)
    onImportComplete(result.value.spec)
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
        title={session.exportCapabilities.webp ? undefined : '当前浏览器不支持 WebP 编码。'}
        onClick={() => void exportImage('image/webp')}
      >
        导出透明 WebP
      </button>
    </div>
  )
}
