import type { MonsterSpec } from '@qmonster/generator-core'
import { exportCanvas, type ExportMimeType } from '@qmonster/renderer-canvas'

export async function downloadRenderedImage(
  canvas: HTMLCanvasElement,
  spec: MonsterSpec,
  mime: ExportMimeType,
): Promise<void> {
  const blob = await exportCanvas(canvas, mime)
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
