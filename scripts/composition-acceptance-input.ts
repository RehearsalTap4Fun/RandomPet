import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const V02_COMPOSITION_ACCEPTANCE_PATH = 'artifacts/acceptance/v0.2/acceptance-set.json'

export interface CompositionAcceptanceInput {
  entries: unknown[]
  [key: string]: unknown
}

export async function loadCompositionAcceptanceInput(repositoryRoot: string): Promise<CompositionAcceptanceInput> {
  let bytes: Buffer
  try {
    bytes = await readFile(resolve(repositoryRoot, V02_COMPOSITION_ACCEPTANCE_PATH))
  } catch {
    throw new Error(`V02_ACCEPTANCE_INPUT_MISSING:${V02_COMPOSITION_ACCEPTANCE_PATH}`)
  }
  let document: unknown
  try {
    document = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`V02_ACCEPTANCE_INPUT_INVALID:${V02_COMPOSITION_ACCEPTANCE_PATH}`)
  }
  if (document === null || typeof document !== 'object' || !Array.isArray((document as { entries?: unknown }).entries)) {
    throw new Error(`V02_ACCEPTANCE_INPUT_INVALID:${V02_COMPOSITION_ACCEPTANCE_PATH}`)
  }
  return document as CompositionAcceptanceInput
}
