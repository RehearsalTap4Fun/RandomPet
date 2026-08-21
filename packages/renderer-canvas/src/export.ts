export type ExportMimeType = 'image/png' | 'image/webp'

export interface ExportCapabilities {
  png: true
  webp: boolean
}

export type CanvasProbeFactory = () => HTMLCanvasElement

export type ExportErrorCode = 'PNG_EXPORT_FAILED' | 'WEBP_EXPORT_UNSUPPORTED'

export class CanvasExportError extends Error {
  readonly code: ExportErrorCode

  constructor(code: ExportErrorCode, message: string) {
    super(message)
    this.name = 'CanvasExportError'
    this.code = code
  }
}

let capabilityPromise: Promise<ExportCapabilities> | undefined

function defaultCanvasProbe(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas
}

function blobFromCanvas(canvas: HTMLCanvasElement, mime: ExportMimeType): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, mime))
}

export function detectExportCapabilities(
  createCanvas: CanvasProbeFactory = defaultCanvasProbe,
): Promise<ExportCapabilities> {
  capabilityPromise ??= (async () => {
    const blob = await blobFromCanvas(createCanvas(), 'image/webp')
    return { png: true, webp: blob?.type === 'image/webp' }
  })()
  return capabilityPromise
}

export async function exportCanvas(
  canvas: HTMLCanvasElement,
  mime: ExportMimeType,
): Promise<Blob> {
  const blob = await blobFromCanvas(canvas, mime)
  if (blob !== null && blob.type === mime) return blob

  if (mime === 'image/webp') {
    throw new CanvasExportError(
      'WEBP_EXPORT_UNSUPPORTED',
      'This browser cannot export WebP images.',
    )
  }
  throw new CanvasExportError('PNG_EXPORT_FAILED', 'The canvas could not be exported as PNG.')
}
