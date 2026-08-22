import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test } from 'vitest'
import { validateProductionSourceFiles } from './source-rich-validation.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function fixture(): Promise<{ root: string; sourceIndex: Record<string, unknown> }> {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-source-rich-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'prompts'), { recursive: true })
  await mkdir(join(root, 'generation'), { recursive: true })
  await mkdir(join(root, 'parts'), { recursive: true })
  await writeFile(join(root, 'prompts', 'sample.txt'), 'exact prompt\n')
  await writeFile(join(root, 'generation', 'sheet.png'), 'sheet bytes')
  await writeFile(join(root, 'generation', 'source.png'), 'source bytes')
  await writeFile(join(root, 'generation', 'processed.png'), 'processed bytes')
  await writeFile(join(root, 'parts', 'master.png'), 'master bytes')
  return {
    root,
    sourceIndex: {
      sources: [{
        sourceId: 'sample',
        promptPath: 'asset-source/v0.1.0/prompts/sample.txt',
        prompt: 'exact prompt',
        promptSha256: sha256('exact prompt'),
        sheetPath: 'asset-source/v0.1.0/generation/sheet.png',
        sheetSha256: sha256('sheet bytes'),
        optionalAbsentSheetPath: null,
        optionalAbsentSheetSha256: null,
        masterPath: 'asset-source/v0.1.0/parts/master.png',
        masterSha256: sha256('master bytes'),
        candidateEvaluations: [{
          sourcePath: 'asset-source/v0.1.0/generation/source.png',
          sourceSha256: sha256('source bytes'),
          processedPath: 'asset-source/v0.1.0/generation/processed.png',
          processedSha256: sha256('processed bytes'),
        }],
      }, {
        sourceId: 'explicit_none',
        sheetPath: null,
        sheetSha256: null,
      }],
    },
  }
}

test('rehashes every source-rich claim under an injected safe root', async () => {
  const { root, sourceIndex } = await fixture()
  await expect(validateProductionSourceFiles(sourceIndex, root)).resolves.toEqual({
    diagnostics: [],
    referencesChecked: 5,
    uniqueFilesChecked: 5,
  })
})

test('rejects a missing, drifted, or escaping source-rich claim', async () => {
  const { root, sourceIndex } = await fixture()
  const source = (sourceIndex.sources as Array<Record<string, any>>)[0]!
  source.masterSha256 = 'f'.repeat(64)
  source.sheetPath = 'asset-source/v0.1.0/generation/missing.png'
  source.candidateEvaluations[0].processedPath = 'asset-source/v0.1.0/../outside.png'
  source.candidateEvaluations[0].sourcePath = 'C:/Users/example/generated/source.png'

  const result = await validateProductionSourceFiles(sourceIndex, root)
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_SOURCE_FILE_HASH_MISMATCH' }))
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_SOURCE_FILE_MISSING' }))
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_SOURCE_FILE_PATH_INVALID' }))
})

test('rejects a prompt file whose normalized content differs from the recorded prompt', async () => {
  const { root, sourceIndex } = await fixture()
  const source = (sourceIndex.sources as Array<Record<string, any>>)[0]!
  source.prompt = 'attacker replacement'
  source.promptSha256 = sha256(source.prompt)

  const result = await validateProductionSourceFiles(sourceIndex, root)
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'PRODUCTION_SOURCE_PROMPT_CONTENT_MISMATCH' }))
})
