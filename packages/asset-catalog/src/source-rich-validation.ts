import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Diagnostic } from '@qmonster/generator-core'

function portableSourcePrefix(sourceIndex: unknown): string | null {
  const version = record(sourceIndex)?.catalogVersion
  if (version === undefined) return 'asset-source/v0.1.0/'
  return typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)
    ? `asset-source/v${version}/`
    : null
}

interface FileClaim {
  path: string
  sha256: string
  diagnosticPath: string[]
  prompt?: string
  canonicalText?: boolean
}

export interface SourceRichValidationResult {
  diagnostics: Diagnostic[]
  referencesChecked: number
  uniqueFilesChecked: number
}

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function record(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null
}

function collectProductionSourceClaims(sourceIndex: unknown): { claims: FileClaim[]; diagnostics: Diagnostic[] } {
  const claims: FileClaim[] = []
  const diagnostics: Diagnostic[] = []
  const root = record(sourceIndex)
  const sources = Array.isArray(root?.sources) ? root.sources : []

  function add(
    owner: Record<string, any>,
    pathField: string,
    shaField: string,
    diagnosticPath: string[],
    promptField?: string,
    canonicalText = false,
  ): void {
    const path = owner[pathField]
    const sha256 = owner[shaField]
    if (path == null && sha256 == null) return
    if (typeof path !== 'string' || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
      diagnostics.push(error(
        'PRODUCTION_SOURCE_FILE_CLAIM_INVALID',
        diagnosticPath,
        `${pathField}/${shaField} must be a portable source path paired with a SHA-256.`,
      ))
      return
    }
    const prompt = promptField === undefined ? undefined : owner[promptField]
    if (promptField !== undefined && typeof prompt !== 'string') {
      diagnostics.push(error('PRODUCTION_SOURCE_FILE_CLAIM_INVALID', [...diagnosticPath, promptField], 'Prompt file claims need the exact recorded prompt text.'))
      return
    }
    claims.push({ path, sha256, diagnosticPath, ...(prompt === undefined ? {} : { prompt }), ...(canonicalText ? { canonicalText: true } : {}) })
  }

  function addExtraction(value: unknown, path: string[]): void {
    const extraction = record(value)
    if (extraction === null) return
    add(extraction, 'sourcePath', 'sourceSha256', [...path, 'sourcePath'])
    add(extraction, 'processedPath', 'processedSha256', [...path, 'processedPath'])
  }

  function addComponent(value: unknown, path: string[]): void {
    const component = record(value)
    if (component === null) return
    add(component, 'sourceSheetPath', 'sourceSheetSha256', [...path, 'sourceSheetPath'])
    add(component, 'sourcePath', 'sourceSha256', [...path, 'sourcePath'])
    add(component, 'processedPath', 'processedSha256', [...path, 'processedPath'])
    add(component, 'promptPath', 'promptSha256', [...path, 'promptPath'], 'prompt')
  }

  function addComposition(value: unknown, path: string[]): void {
    const composition = record(value)
    if (composition === null) return
    add(composition, 'outputPath', 'outputSha256', [...path, 'outputPath'])
    const provenance = record(composition.componentProvenance)
    if (provenance === null) return
    addComponent(provenance.shell, [...path, 'componentProvenance', 'shell'])
    addComponent(provenance.lure, [...path, 'componentProvenance', 'lure'])
  }

  for (const [sourceIndexPosition, value] of sources.entries()) {
    const source = record(value)
    if (source === null) continue
    const sourcePath = ['sources', String(source.sourceId ?? sourceIndexPosition)]
    const interfacePromptCatalog = source.kind === 'interface-structural' || source.kind === 'interface-bridge'
    add(
      source,
      'promptPath',
      'promptSha256',
      [...sourcePath, 'promptPath'],
      interfacePromptCatalog ? undefined : 'prompt',
      interfacePromptCatalog,
    )
    add(source, 'sheetPath', 'sheetSha256', [...sourcePath, 'sheetPath'])
    add(source, 'masterPath', 'masterSha256', [...sourcePath, 'masterPath'])
    add(source, 'sourcePngPath', 'sourcePngSha256', [...sourcePath, 'sourcePngPath'])
    if (Array.isArray(source.sourceResources)) {
      for (const [index, resource] of source.sourceResources.entries()) {
        const sourceResource = record(resource)
        if (sourceResource !== null) add(sourceResource, 'path', 'sha256', [...sourcePath, 'sourceResources', String(index)])
      }
    }

    if (Array.isArray(source.candidateEvaluations)) {
      for (const [index, candidateValue] of source.candidateEvaluations.entries()) {
        const candidate = record(candidateValue)
        if (candidate === null) continue
        const candidatePath = [...sourcePath, 'candidateEvaluations', String(index)]
        addExtraction(candidate, candidatePath)
        addComposition(candidate.composition, [...candidatePath, 'composition'])
      }
    }
    const componentEvaluations = record(source.componentEvaluations)
    if (componentEvaluations !== null) {
      for (const [role, evaluations] of Object.entries(componentEvaluations)) {
        if (!Array.isArray(evaluations)) continue
        for (const [index, evaluationValue] of evaluations.entries()) {
          const evaluation = record(evaluationValue)
          addExtraction(evaluation?.extraction, [...sourcePath, 'componentEvaluations', role, String(index), 'extraction'])
        }
      }
    }
    addComposition(source.composition, [...sourcePath, 'composition'])
  }
  return { claims, diagnostics }
}

export async function validateProductionSourceFiles(
  sourceIndex: unknown,
  sourceRoot: string,
): Promise<SourceRichValidationResult> {
  const { claims, diagnostics } = collectProductionSourceClaims(sourceIndex)
  const sourcePrefix = portableSourcePrefix(sourceIndex)
  if (sourcePrefix === null) {
    return {
      diagnostics: [...diagnostics, error('PRODUCTION_SOURCE_VERSION_INVALID', ['catalogVersion'], 'Source-rich validation needs a strict catalogVersion.')],
      referencesChecked: claims.length,
      uniqueFilesChecked: 0,
    }
  }
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(resolve(sourceRoot))
  } catch {
    return {
      diagnostics: [...diagnostics, error('PRODUCTION_SOURCE_ROOT_INVALID', ['sourceRoot'], 'Source-rich root does not exist or cannot be resolved.')],
      referencesChecked: claims.length,
      uniqueFilesChecked: 0,
    }
  }

  const unique = new Map<string, FileClaim>()
  for (const claim of claims) {
    const portable = claim.path.replaceAll('\\', '/')
    if (isAbsolute(claim.path) || !portable.startsWith(sourcePrefix)) {
      diagnostics.push(error('PRODUCTION_SOURCE_FILE_PATH_INVALID', claim.diagnosticPath, `Source path must stay below ${sourcePrefix}.`))
      continue
    }
    const suffix = portable.slice(sourcePrefix.length)
    const unresolved = resolve(canonicalRoot, suffix)
    const rootRelative = relative(canonicalRoot, unresolved)
    if (suffix === '' || rootRelative.startsWith('..') || isAbsolute(rootRelative)) {
      diagnostics.push(error('PRODUCTION_SOURCE_FILE_PATH_INVALID', claim.diagnosticPath, 'Source path escapes the injected source root.'))
      continue
    }
    const previous = unique.get(unresolved)
    if (previous !== undefined && (
      previous.sha256 !== claim.sha256
      || previous.prompt !== claim.prompt
      || previous.canonicalText !== claim.canonicalText
    )) {
      diagnostics.push(error('PRODUCTION_SOURCE_FILE_CLAIM_CONFLICT', claim.diagnosticPath, 'The same source file has conflicting provenance claims.'))
      continue
    }
    unique.set(unresolved, claim)
  }

  for (const [unresolved, claim] of unique) {
    let canonicalFile: string
    let bytes: Buffer
    try {
      canonicalFile = await realpath(unresolved)
      const rootRelative = relative(canonicalRoot, canonicalFile)
      if (rootRelative.startsWith('..') || isAbsolute(rootRelative)) throw new Error('resolved path escaped root')
      bytes = await readFile(canonicalFile)
    } catch {
      diagnostics.push(error('PRODUCTION_SOURCE_FILE_MISSING', claim.diagnosticPath, `Cannot resolve/read source-rich file ${claim.path}.`))
      continue
    }

    if (claim.prompt !== undefined) {
      const observedPrompt = bytes.toString('utf8').trimEnd()
      if (observedPrompt !== claim.prompt) {
        diagnostics.push(error('PRODUCTION_SOURCE_PROMPT_CONTENT_MISMATCH', claim.diagnosticPath, `Prompt file ${claim.path} differs from the canonical recorded prompt.`))
      }
      const observedHash = createHash('sha256').update(observedPrompt).digest('hex')
      if (observedHash !== claim.sha256) {
        diagnostics.push(error('PRODUCTION_SOURCE_FILE_HASH_MISMATCH', claim.diagnosticPath, `Prompt source hash differs for ${claim.path}.`))
      }
    } else {
      const hashInput = claim.canonicalText
        ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
        : bytes
      const observedHash = createHash('sha256').update(hashInput).digest('hex')
      if (observedHash !== claim.sha256) {
        diagnostics.push(error('PRODUCTION_SOURCE_FILE_HASH_MISMATCH', claim.diagnosticPath, `Source file hash differs for ${claim.path}.`))
      }
    }
  }

  return { diagnostics, referencesChecked: claims.length, uniqueFilesChecked: unique.size }
}
