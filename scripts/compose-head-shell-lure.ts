import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'

export interface AiComponentProvenance {
  role: 'head-shell' | 'lure'
  sourceSheetPath: string
  sourceSheetSha256: string
  sourcePath: string
  sourceSha256: string
  processedPath: string
  processedSha256: string
  promptPath: string
  prompt: string
  promptSha256: string
}

export interface HeadShellLureCompositionResult {
  compositionVersion: 'head-shell-lure-composite-v1'
  outputPath: string
  outputSha256: string
  outputSize: { width: number, height: number }
  outputBounds: { left: number, top: number, width: number, height: number }
  attachment: { x: number, y: number }
  lurePlacement: { left: number, top: number, width: number, height: number, scale: number, anchor: 'bottom-center' }
  zOrder: ['head-shell', 'lure']
  componentProvenance: { shell: AiComponentProvenance, lure: AiComponentProvenance }
}

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const SHA256 = /^[0-9a-f]{64}$/

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function sha256File(path: string): Promise<string> {
  return digest(await readFile(path))
}

async function validateProvenance(
  component: AiComponentProvenance,
  expectedRole: AiComponentProvenance['role'],
  expectedProcessedPath: string,
): Promise<void> {
  const fields = [
    'sourceSheetPath',
    'sourceSheetSha256',
    'sourcePath',
    'sourceSha256',
    'processedPath',
    'processedSha256',
    'promptPath',
    'prompt',
    'promptSha256',
  ] as const
  for (const field of fields) {
    if (typeof component[field] !== 'string' || component[field].length === 0) {
      throw new Error(`Incomplete ${expectedRole} provenance: ${field}`)
    }
  }
  if (component.role !== expectedRole) throw new Error(`Expected ${expectedRole} provenance role, received ${component.role}`)
  if (component.processedPath !== expectedProcessedPath) throw new Error(`${expectedRole} processedPath does not match composition input`)
  for (const [field, path] of [
    ['sourceSheetSha256', component.sourceSheetPath],
    ['sourceSha256', component.sourcePath],
    ['processedSha256', component.processedPath],
  ] as const) {
    const recorded = component[field]
    if (!SHA256.test(recorded) || recorded !== await sha256File(path)) {
      throw new Error(`${expectedRole} ${field} does not match ${field.replace('Sha256', 'Path')}`)
    }
  }
  if (!SHA256.test(component.promptSha256) || component.promptSha256 !== digest(component.prompt)) {
    throw new Error(`${expectedRole} promptSha256 does not match prompt`)
  }
  const promptFile = await readFile(component.promptPath, 'utf8')
  if (promptFile.trimEnd() !== component.prompt) throw new Error(`${expectedRole} promptPath does not match prompt`)
}

async function alphaBounds(
  path: string,
  role: AiComponentProvenance['role'],
): Promise<{ left: number, top: number, width: number, height: number, canvasWidth: number, canvasHeight: number }> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) throw new Error(`${role} component has no visible alpha content`)
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    canvasWidth: info.width,
    canvasHeight: info.height,
  }
}

export async function composeHeadShellWithLure(input: {
  shellPath: string
  lurePath: string
  outputPath: string
  attachment: { x: number, y: number }
  lureScale: number
  outputSize: { width: number, height: number }
  componentProvenance: { shell: AiComponentProvenance, lure: AiComponentProvenance }
}): Promise<HeadShellLureCompositionResult> {
  await validateProvenance(input.componentProvenance.shell, 'head-shell', input.shellPath)
  await validateProvenance(input.componentProvenance.lure, 'lure', input.lurePath)
  if (!Number.isFinite(input.lureScale) || input.lureScale <= 0 || input.lureScale > 1) {
    throw new Error('lureScale must preserve content with a value in (0, 1]')
  }

  const shellBounds = await alphaBounds(input.shellPath, 'head-shell')
  const lureBounds = await alphaBounds(input.lurePath, 'lure')
  if (shellBounds.canvasWidth !== input.outputSize.width || shellBounds.canvasHeight !== input.outputSize.height) {
    throw new Error('Head-shell canvas must match outputSize so authored socket coordinates are preserved')
  }
  const lureWidth = Math.max(1, Math.round(lureBounds.width * input.lureScale))
  const lureHeight = Math.max(1, Math.round(lureBounds.height * input.lureScale))
  const lureLeft = Math.round(input.attachment.x - lureWidth / 2)
  const lureTop = Math.round(input.attachment.y - lureHeight + 1)
  if (
    lureLeft < 0
    || lureTop < 0
    || lureLeft + lureWidth > input.outputSize.width
    || lureTop + lureHeight > input.outputSize.height
  ) {
    throw new Error('Lure placement would crop generated content')
  }

  const lure = await sharp(input.lurePath)
    .ensureAlpha()
    .extract({ left: lureBounds.left, top: lureBounds.top, width: lureBounds.width, height: lureBounds.height })
    .resize(lureWidth, lureHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png(PNG_OPTIONS)
    .toBuffer()
  await mkdir(dirname(input.outputPath), { recursive: true })
  await sharp(input.shellPath)
    .ensureAlpha()
    .composite([{ input: lure, left: lureLeft, top: lureTop }])
    .png(PNG_OPTIONS)
    .toFile(input.outputPath)
  const outputBounds = await alphaBounds(input.outputPath, 'head-shell')

  return {
    compositionVersion: 'head-shell-lure-composite-v1',
    outputPath: input.outputPath,
    outputSha256: await sha256File(input.outputPath),
    outputSize: input.outputSize,
    outputBounds: {
      left: outputBounds.left,
      top: outputBounds.top,
      width: outputBounds.width,
      height: outputBounds.height,
    },
    attachment: input.attachment,
    lurePlacement: {
      left: lureLeft,
      top: lureTop,
      width: lureWidth,
      height: lureHeight,
      scale: input.lureScale,
      anchor: 'bottom-center',
    },
    zOrder: ['head-shell', 'lure'],
    componentProvenance: input.componentProvenance,
  }
}
