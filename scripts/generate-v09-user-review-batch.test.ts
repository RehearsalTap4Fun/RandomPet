import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { canonicalJsonSha256 } from '@qmonster/asset-catalog'
import { V09_COMPOSITION_NODE_IDS } from '@qmonster/generator-core'
import { buildV09AcceptancePlan, normalizedSourceDigest, writeAcceptanceAttempt, replaceActivePointer, validateReplayComparison, validateSealedAttemptForActivation, withPreactivationGateLock } from './generate-v09-user-review-batch.js'

const hash = 'a'.repeat(64)
const plan = () => buildV09AcceptancePlan(hash, '2026-09-10T00:00:00.000Z')
const gate = () => ({ codeSha256: 'b'.repeat(64), browserBuildSha256: 'c'.repeat(64), results: [] })
const ref = (letter: string) => ({ resourceId: `sha256:${letter.repeat(64)}`, sha256: letter.repeat(64), mediaType: 'application/qmonster-manifest-v1+json' })
const replayContract = () => ({
  rendererBuildSha256: 'd'.repeat(64),
  assemblyTemplates: [ref('1'), ref('2')],
  assemblyApprovals: [{ sha256: '3'.repeat(64), approval: { status: 'approved' } }],
  traitApprovals: [ref('4')],
  entries: plan().seeds.map((seed, index) => ({
    seed,
    specFile: `${String(index + 1).padStart(3, '0')}.json`,
    pngFile: `${String(index + 1).padStart(3, '0')}.png`,
    specSha256: '5'.repeat(64),
    pngSha256: '6'.repeat(64),
    decodedPngSha256: '7'.repeat(64),
    specDocument: { seed, catalogVersion: '0.9.0', generatorVersion: '0.9.0', schemaVersion: '0.4.0' },
    trace: [...V09_COMPOSITION_NODE_IDS],
    identityTransforms: true,
    resourceIds: [`sha256:${'8'.repeat(64)}`],
    incubator: { seed, visualExtension: { seed, catalogVersion: '0.9.0', generatorVersion: '0.9.0', schemaVersion: '0.4.0', releaseManifestSha256: hash } },
  })),
})
const sealedAttempt = () => {
  const frozenPlan = plan(), currentGate = gate(), replay = replayContract()
  return {
    schemaVersion: 'qmonster-acceptance-attempt-v1', status: 'sealed', attemptId: `attempt-${hash}`,
    planSha256: canonicalJsonSha256(frozenPlan), releaseManifestSha256: hash,
    gateSha256: canonicalJsonSha256(currentGate), codeSha256: currentGate.codeSha256,
    browserBuildSha256: currentGate.browserBuildSha256,
    rendererBuildSha256: replay.rendererBuildSha256,
    assemblyTemplates: replay.assemblyTemplates,
    assemblyApprovals: replay.assemblyApprovals,
    traitApprovals: replay.traitApprovals,
    generationPolicy: { callsPerSeed: 1, rendersPerSeed: 1, retries: 0, replacements: 0, subjectiveFiltering: false },
    entries: frozenPlan.seeds.map((seed, index) => ({ seed, releaseManifestSha256: hash,
      spec: replay.entries[index]!.specFile, specSha256: replay.entries[index]!.specSha256,
      png: replay.entries[index]!.pngFile, pngSha256: replay.entries[index]!.pngSha256,
      decodedPngSha256: replay.entries[index]!.decodedPngSha256,
      trace: [...V09_COMPOSITION_NODE_IDS], identityTransforms: true,
      resourceIds: replay.entries[index]!.resourceIds,
      incubator: replay.entries[index]!.incubator })),
  }
}
it('uses a host-independent LF projection for the rebuildable source manifest', () => {
  expect(normalizedSourceDigest(Buffer.from('first\r\nsecond\r\n'))).toBe(normalizedSourceDigest(Buffer.from('first\nsecond\n')))
  expect(normalizedSourceDigest(Buffer.from('first\nchanged\n'))).not.toBe(normalizedSourceDigest(Buffer.from('first\nsecond\n')))
})
it('freezes the prescribed ordered seeds and rejects an invalid release identity', () => {
  expect(plan().seeds).toEqual(['qmonster-v09-review-001', 'qmonster-v09-review-002', 'qmonster-v09-review-003', 'qmonster-v09-review-004', 'qmonster-v09-review-005', 'qmonster-v09-review-006', 'qmonster-v09-review-007', 'qmonster-v09-review-008', 'qmonster-v09-review-009', 'qmonster-v09-review-010'])
  expect(() => buildV09AcceptancePlan('../wrong')).toThrow()
})

it('binds a sealed attempt to the exact frozen plan and current gate identities', () => {
  const frozenPlan = plan(), currentGate = gate(), attempt = sealedAttempt()
  expect(() => validateSealedAttemptForActivation(attempt, frozenPlan, currentGate, hash, replayContract())).not.toThrow()
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
    expect(() => validateSealedAttemptForActivation(changed, frozenPlan, currentGate, hash, replayContract())).toThrow(/identity|contract/u)
  }
  const changedPlan = structuredClone(frozenPlan)
  changedPlan.seeds.reverse()
  expect(() => validateSealedAttemptForActivation(attempt, changedPlan, currentGate, hash, replayContract())).toThrow(/contract/u)
})

it('rejects every reviewer-reproduced release, spec, resource and incubator mutation', () => {
  const frozenPlan = plan(), currentGate = gate(), expected = replayContract(), attempt = sealedAttempt()
  for (const mutate of [
    (value: any) => { value.rendererBuildSha256 = '9'.repeat(64) },
    (value: any) => { value.assemblyTemplates.reverse() },
    (value: any) => { value.assemblyApprovals[0].sha256 = '9'.repeat(64) },
    (value: any) => { value.traitApprovals[0].sha256 = '9'.repeat(64) },
    (value: any) => { value.entries[0].resourceIds = [] },
    (value: any) => { value.entries[0].specSha256 = '9'.repeat(64) },
    (value: any) => { value.entries[0].spec = '010.json' },
    (value: any) => { value.entries[0].incubator.visualExtension.catalogVersion = '0.8.0' },
  ]) {
    const changed = structuredClone(attempt)
    mutate(changed)
    expect(() => validateSealedAttemptForActivation(changed, frozenPlan, currentGate, hash, expected)).toThrow(/identity|contract/u)
  }
})

it('compares deterministic verification replay without accepting spec or PNG drift', () => {
  const expected = replayContract().entries[0]!
  expect(() => validateReplayComparison(expected, structuredClone(expected))).not.toThrow()
  for (const mutate of [
    (value: any) => { value.specDocument.catalogVersion = '0.8.0' },
    (value: any) => { value.pngSha256 = '9'.repeat(64) },
    (value: any) => { value.decodedPngSha256 = '9'.repeat(64) },
  ]) {
    const changed = structuredClone(expected)
    mutate(changed)
    expect(() => validateReplayComparison(expected, changed)).toThrow(/replay/u)
  }
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
