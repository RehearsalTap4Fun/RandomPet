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

async function blobFromOffscreenCanvas(
  canvas: HTMLCanvasElement,
  mime: ExportMimeType,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return blobFromCanvas(canvas, mime)
  const offscreen = new OffscreenCanvas(canvas.width, canvas.height)
  const context = offscreen.getContext('2d')
  if (context === null) return blobFromCanvas(canvas, mime)
  context.drawImage(canvas, 0, 0)
  return offscreen.convertToBlob({ type: mime })
}

interface PreparedCanvasExport {
  revision: number
  readyRevision: number
  readyBlob: Blob | null
  inFlight: Promise<Blob | null> | null
}

const preparedCanvasExports = new WeakMap<
  HTMLCanvasElement,
  Map<ExportMimeType, PreparedCanvasExport>
>()

function preparedState(
  canvas: HTMLCanvasElement,
  mime: ExportMimeType,
): PreparedCanvasExport | undefined {
  return preparedCanvasExports.get(canvas)?.get(mime)
}

function encodeLatestRevision(
  canvas: HTMLCanvasElement,
  mime: ExportMimeType,
  state: PreparedCanvasExport,
): Promise<Blob | null> {
  state.inFlight ??= (async () => {
    while (state.readyRevision !== state.revision) {
      const revision = state.revision
      const blob = await blobFromOffscreenCanvas(canvas, mime)
      if (revision !== state.revision) continue
      state.readyBlob = blob
      state.readyRevision = revision
    }
    return state.readyBlob
  })().finally(() => {
    state.inFlight = null
  })
  return state.inFlight
}

export function primeCanvasExport(
  canvas: HTMLCanvasElement,
  mime: ExportMimeType,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return Promise.resolve(null)
  let mimeStates = preparedCanvasExports.get(canvas)
  if (mimeStates === undefined) {
    mimeStates = new Map()
    preparedCanvasExports.set(canvas, mimeStates)
  }
  let state = mimeStates.get(mime)
  if (state === undefined) {
    state = { revision: 0, readyRevision: -1, readyBlob: null, inFlight: null }
    mimeStates.set(mime, state)
  }
  state.revision += 1
  state.readyBlob = null
  return encodeLatestRevision(canvas, mime, state)
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
  const state = preparedState(canvas, mime)
  const blob = state === undefined
    ? await blobFromOffscreenCanvas(canvas, mime)
    : state.readyRevision === state.revision
      ? state.readyBlob
      : await encodeLatestRevision(canvas, mime, state)
  if (blob !== null && blob.type === mime) return blob

  if (mime === 'image/webp') {
    throw new CanvasExportError(
      'WEBP_EXPORT_UNSUPPORTED',
      'This browser cannot export WebP images.',
    )
  }
  throw new CanvasExportError('PNG_EXPORT_FAILED', 'The canvas could not be exported as PNG.')
}
