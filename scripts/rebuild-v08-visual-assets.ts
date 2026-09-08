import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assembleV08Catalog } from './assemble-v08-catalog.js'
import { ensureV08TraitSourceWorkspace } from './prepare-v08-feline-traits.js'
import { writeV08CanonicalGeometry } from './v08-canonical-geometry.js'

function assertChild(root: string, target: string, label: string): void {
  const relation = relative(root, target)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label}:${target}`)
  }
}

async function rebuild(repositoryRootInput: string): Promise<void> {
  const repositoryRoot = resolve(repositoryRootInput)
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as { name?: string }
  if (packageJson.name !== 'qmonster-creator') throw new Error('V08_REBUILD_REPOSITORY_INVALID')

  const sourceRoot = join(repositoryRoot, 'asset-source', 'v0.8.0', 'feline')
  const temporaryRoot = join(repositoryRoot, '.tmp', 'v08-visual-rebuild')
  assertChild(repositoryRoot, temporaryRoot, 'V08_REBUILD_TEMPORARY_ROOT_INVALID')
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })

  try {
    await writeV08CanonicalGeometry(sourceRoot)
    await ensureV08TraitSourceWorkspace(sourceRoot, (completed, total) => {
      process.stdout.write(`rendered ${completed}/${total}\n`)
    }, { force: true })

    await assembleV08Catalog({
      repositoryRoot: temporaryRoot,
      sourceRoot,
      stagedRoot: join(temporaryRoot, '.stage'),
      onProgress: (completed, total) => process.stdout.write(`packaged ${completed}/${total}\n`),
    })

    const paths = [
      ['packages/asset-catalog/assets/v0.8.0', 'packages/asset-catalog/assets/v0.8.0'],
      ['packages/asset-catalog/catalog/v0.8.0', 'packages/asset-catalog/catalog/v0.8.0'],
      ['packages/asset-catalog/source-index-v0.8.0.json', 'packages/asset-catalog/source-index-v0.8.0.json'],
      ['packages/asset-catalog/audit/v0.8.0/evidence-manifest.json', 'packages/asset-catalog/audit/v0.8.0/evidence-manifest.json'],
    ] as const
    for (const [source, destination] of paths) {
      const destinationPath = join(repositoryRoot, destination)
      assertChild(repositoryRoot, destinationPath, 'V08_REBUILD_DESTINATION_INVALID')
      await cp(join(temporaryRoot, source), destinationPath, { recursive: true, force: true })
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await rebuild(process.cwd())
}
