import { dirname, resolve } from 'node:path'
import { validateV09CandidatePointer } from './v09-production-validation.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

export async function runV09ValidationCli(args = process.argv.slice(2)): Promise<number> {
  const index = args.indexOf('--release-pointer')
  const releasePointer = index >= 0 ? args[index + 1] : undefined
  if (releasePointer === undefined) {
    process.stderr.write('Missing required --release-pointer.\n')
    return 2
  }
  const pointer = resolve(releasePointer)
  const diagnostics = await validateV09CandidatePointer({ root: resolve(dirname(pointer), '..'), releasePointer: pointer })
  for (const item of diagnostics) process.stderr.write(`${item.code} ${item.path.join('.')} ${item.message}\n`)
  return diagnostics.length === 0 ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) process.exitCode = await runV09ValidationCli()
