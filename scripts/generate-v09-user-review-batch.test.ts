import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { canonicalJsonSha256 } from '@qmonster/asset-catalog'
import { V09_COMPOSITION_NODE_IDS } from '@qmonster/generator-core'
import { buildV09AcceptancePlan, writeAcceptanceAttempt, replaceActivePointer, validateSealedAttemptForActivation, withPreactivationGateLock } from './generate-v09-user-review-batch.js'

const hash = 'a'.repeat(64)
const plan = () => buildV09AcceptancePlan(hash, '2026-09-10T00:00:00.000Z')
const gate = () => ({ codeSha256: 'b'.repeat(64), browserBuildSha256: 'c'.repeat(64), results: [] })
const sealedAttempt = () => {
  const frozenPlan = plan(), currentGate = gate()
  return {
    schemaVersion: 'qmonster-acceptance-attempt-v1', status: 'sealed', attemptId: `attempt-${hash}`,
    planSha256: canonicalJsonSha256(frozenPlan), releaseManifestSha256: hash,
    gateSha256: canonicalJsonSha256(currentGate), codeSha256: currentGate.codeSha256,
    browserBuildSha256: currentGate.browserBuildSha256,
    generationPolicy: { callsPerSeed: 1, rendersPerSeed: 1, retries: 0, replacements: 0, subjectiveFiltering: false },
    entries: frozenPlan.seeds.map(seed => ({ seed, releaseManifestSha256: hash,
      trace: [...V09_COMPOSITION_NODE_IDS], identityTransforms: true,
      incubator: { seed, visualExtension: { releaseManifestSha256: hash } } })),
  }
}
it('freezes the prescribed ordered seeds and rejects an invalid release identity', () => {
  expect(plan().seeds).toEqual(['qmonster-v09-review-001', 'qmonster-v09-review-002', 'qmonster-v09-review-003', 'qmonster-v09-review-004', 'qmonster-v09-review-005', 'qmonster-v09-review-006', 'qmonster-v09-review-007', 'qmonster-v09-review-008', 'qmonster-v09-review-009', 'qmonster-v09-review-010'])
  expect(() => buildV09AcceptancePlan('../wrong')).toThrow()
})

it('binds a sealed attempt to the exact frozen plan and current gate identities', () => {
  const frozenPlan = plan(), currentGate = gate(), attempt = sealedAttempt()
  expect(() => validateSealedAttemptForActivation(attempt, frozenPlan, currentGate, hash)).not.toThrow()
  for (const mutate of [
    (value: any) => { value.gateSha256 = 'd'.repeat(64) },
    (value: any) => { value.codeSha256 = 'd'.repeat(64) },
    (value: any) => { value.browserBuildSha256 = 'd'.repeat(64) },
    (value: any) => { value.generationPolicy.retries = 1 },
    (value: any) => { value.entries[1].seed = value.entries[0].seed },
    (value: any) => { value.entries[0].trace = value.entries[0].trace.slice(1) },
    (value: any) => { value.entries[0].identityTransforms = false },
    (value: any) => { value.entries[0].incubator.visualExtension.releaseManifestSha256 = 'd'.repeat(64) },
  ]) {
    const changed = structuredClone(attempt)
    mutate(changed)
    expect(() => validateSealedAttemptForActivation(changed, frozenPlan, currentGate, hash)).toThrow(/identity|contract/u)
  }
  const changedPlan = structuredClone(frozenPlan)
  changedPlan.seeds.reverse()
  expect(() => validateSealedAttemptForActivation(attempt, changedPlan, currentGate, hash)).toThrow(/contract/u)
})

it('publishes all ten outputs once and refuses a second attempt without invoking a seed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v09-attempt-'))
  const calls: string[] = []
  const run = () => writeAcceptanceAttempt(root, plan(), async (seed, staging) => {
    calls.push(seed)
    await writeFile(join(staging, `${seed}.json`), seed)
    return { seed }
  }, async () => ({ browserVersion: 'test' }))
  const result = await run()
  expect(calls).toEqual(plan().seeds)
  expect(JSON.parse(await readFile(join(result.directory, 'attempt.json'), 'utf8')).entries).toHaveLength(10)
  await expect(run()).rejects.toThrow(/already exists/)
  expect(calls).toHaveLength(10)
})

it('keeps an objective failure non-authoritative and never retries or renders later seeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v09-failed-'))
  const calls: string[] = []
  const run = () => writeAcceptanceAttempt(root, plan(), async seed => {
    calls.push(seed)
    if (calls.length === 2) throw new Error('objective decoder failure')
    return { seed }
  }, async () => ({}))
  await expect(run()).rejects.toThrow('objective decoder failure')
  expect(calls).toEqual(plan().seeds.slice(0, 2))
  expect((await readdir(root)).filter(name => name.startsWith('attempt-'))).toEqual([])
  expect((await readdir(root)).filter(name => name.endsWith('.failure.json'))).toHaveLength(1)
  await expect(run()).rejects.toThrow(/already exists/)
  expect(calls).toHaveLength(2)
})

it('rejects concurrent creation before either process can duplicate a seed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v09-concurrent-'))
  let resume!: () => void
  let entered!: () => void
  const enteredPromise = new Promise<void>(resolve => { entered = resolve })
  const pause = new Promise<void>(resolve => { resume = resolve })
  const first = writeAcceptanceAttempt(root, plan(), async seed => { entered(); await pause; return { seed } }, async () => ({}))
  await enteredPromise
  await expect(writeAcceptanceAttempt(root, plan(), async () => { throw new Error('must not render') }, async () => ({}))).rejects.toThrow(/already exists|locked/)
  resume()
  await first
})

it('allows only one preactivation gate to own the shared receipt and logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v09-gate-lock-'))
  const lock = join(root, '.gate.lock')
  let resume!: () => void
  let entered!: () => void
  const enteredPromise = new Promise<void>(resolve => { entered = resolve })
  const pause = new Promise<void>(resolve => { resume = resolve })
  const first = withPreactivationGateLock(lock, async () => { entered(); await pause })
  await enteredPromise
  await expect(withPreactivationGateLock(lock, async () => { throw new Error('must not run') })).rejects.toThrow(/already running/)
  resume()
  await first
  await expect(withPreactivationGateLock(lock, async () => 'next')).resolves.toBe('next')
})

it('rolls back its pointer if immediate production loading fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v09-activation-'))
  const path = join(root, 'active-release.json')
  await writeFile(path, 'original pointer')
  await expect(replaceActivePointer(path, hash, async () => { throw new Error('loader failed') })).rejects.toThrow('loader failed')
  expect(await readFile(path, 'utf8')).toBe('original pointer')
})

it('preserves a foreign replacement when validation fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v09-foreign-'))
  const path = join(root, 'active-release.json')
  await writeFile(path, 'original pointer')
  await expect(replaceActivePointer(path, hash, async () => {
    await writeFile(path, 'foreign replacement')
    throw new Error('loader failed')
  })).rejects.toThrow('loader failed')
  expect(await readFile(path, 'utf8')).toBe('foreign replacement')
})

it('writes only the minimal pointer and validates after it becomes visible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v09-active-'))
  const path = join(root, 'active-release.json')
  await replaceActivePointer(path, hash, async () => {
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: hash })
  })
  expect(await readdir(root)).toEqual(['active-release.json'])
})
