import type { MonsterSpec } from '@qmonster/generator-core'
import { CanvasExportError, exportCanvas, type ExportMimeType } from '@qmonster/renderer-canvas'

function snapshotRenderedCanvas(canvas: HTMLCanvasElement, mime: ExportMimeType): HTMLCanvasElement {
  const snapshot = canvas.ownerDocument.createElement('canvas')
  snapshot.width = canvas.width
  snapshot.height = canvas.height
  const context = snapshot.getContext('2d')
  if (context === null) {
    throw new CanvasExportError(
      mime === 'image/webp' ? 'WEBP_EXPORT_UNSUPPORTED' : 'PNG_EXPORT_FAILED',
      'The preview canvas could not be snapshotted for export.',
    )
  }
  context.drawImage(canvas, 0, 0)
  return snapshot
}

export async function downloadRenderedImage(
  canvas: HTMLCanvasElement,
  spec: MonsterSpec,
  mime: ExportMimeType,
): Promise<void> {
  const snapshot = snapshotRenderedCanvas(canvas, mime)
  const blob = await exportCanvas(snapshot, mime)
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `qmonster-${spec.themeId}-${spec.seed}.${mime === 'image/png' ? 'png' : 'webp'}`
    anchor.click()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
