import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJsonBytes, canonicalJsonSha256, decodedPngSha256, loadActiveV09Release, validateV09CandidatePointer } from '@qmonster/asset-catalog'
import { V09_COMPOSITION_NODE_IDS } from '@qmonster/generator-core'
import { buildV08ContactSheet } from './v08-contact-sheet.js'

const REVIEW_ROOT = 'artifacts/acceptance/v0.9.0-feline'
const POINTER = 'packages/asset-catalog/releases/candidate-v0.9.0.json'
const ACTIVE = 'packages/asset-catalog/releases/active-release.json'
const PREACTIVATION_RECEIPT = `${REVIEW_ROOT}/preactivation-gate.json`
const FINAL_VERIFICATION_RECEIPT = `${REVIEW_ROOT}/final-verification.json`
const HEX = /^[a-f0-9]{64}$/u
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const now = () => new Date().toISOString()
export const PREACTIVATION_COMMANDS = [
  'npm run typecheck', 'npm test', 'npm run catalog:validate',
  'npm run validate:v0.9.0 -w @qmonster/asset-catalog', 'npm run build',
  'npx playwright test tests/render/v09-composition.spec.ts tests/render/v08-composition.spec.ts --project=chromium --workers=1',
] as const

export function buildV09AcceptancePlan(releaseManifestSha256: string, createdAt = now()) {
  if (!HEX.test(releaseManifestSha256)) throw new Error('Invalid release identity')
  return { schemaVersion: 'qmonster-acceptance-plan-v1', seriesId: 'qmonster-v09-review', createdAt,
    releaseManifestSha256, seeds: Array.from({ length: 10 }, (_, index) => `qmonster-v09-review-${String(index + 1).padStart(3, '0')}`) }
}
type Plan = ReturnType<typeof buildV09AcceptancePlan>

const GENERATION_POLICY = {
  callsPerSeed: 1,
  rendersPerSeed: 1,
  retries: 0,
  replacements: 0,
  subjectiveFiltering: false,
} as const

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function validateSealedAttemptForActivation(
  attempt: unknown,
  plan: Plan,
  gate: unknown,
  releaseManifestSha256: string,
): void {
  const expectedPlan = buildV09AcceptancePlan(releaseManifestSha256, plan.createdAt)
  if (canonicalJsonSha256(plan) !== canonicalJsonSha256(expectedPlan)) throw new Error('Frozen plan contract mismatch')
  if (!isRecord(gate) || !HEX.test(gate.codeSha256) || !HEX.test(gate.browserBuildSha256)
    || !isRecord(attempt) || attempt.schemaVersion !== 'qmonster-acceptance-attempt-v1' || attempt.status !== 'sealed'
    || attempt.attemptId !== `attempt-${releaseManifestSha256}`
    || attempt.planSha256 !== canonicalJsonSha256(plan) || attempt.releaseManifestSha256 !== releaseManifestSha256
    || attempt.gateSha256 !== canonicalJsonSha256(gate) || attempt.codeSha256 !== gate.codeSha256
    || attempt.browserBuildSha256 !== gate.browserBuildSha256
    || canonicalJsonSha256(attempt.generationPolicy) !== canonicalJsonSha256(GENERATION_POLICY)
    || !Array.isArray(attempt.entries) || attempt.entries.length !== expectedPlan.seeds.length) {
    throw new Error('Sealed attempt identity mismatch')
  }
  for (const [index, entry] of attempt.entries.entries()) {
    if (!isRecord(entry) || entry.seed !== expectedPlan.seeds[index]
      || entry.releaseManifestSha256 !== releaseManifestSha256
      || canonicalJsonSha256(entry.trace) !== canonicalJsonSha256(V09_COMPOSITION_NODE_IDS)
      || entry.identityTransforms !== true
      || !isRecord(entry.incubator) || entry.incubator.seed !== entry.seed
      || !isRecord(entry.incubator.visualExtension)
      || entry.incubator.visualExtension.releaseManifestSha256 !== releaseManifestSha256) {
      throw new Error('Sealed attempt entry contract mismatch')
    }
  }
}

async function bytesOrMissing(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function exclusive(path: string, bytes: Uint8Array | string): Promise<void> {
  const file = await open(path, 'wx')
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
}
async function ownedUnlink(path: string, bytes: Uint8Array | string): Promise<void> {
  const current = await bytesOrMissing(path)
  if (current?.equals(Buffer.from(bytes))) await unlink(path)
}

export async function withPreactivationGateLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const token = randomUUID()
  await mkdir(dirname(path), { recursive: true })
  try {
    await exclusive(path, token)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Preactivation gate is already running')
    throw error
  }
  try {
    return await action()
  } finally {
    await ownedUnlink(path, token)
  }
}

/** The durable claim survives success/failure: this release cannot be silently retried. */
export async function writeAcceptanceAttempt<T>(root: string, plan: Plan,
  render: (seed: string, staging: string) => Promise<T>,
  finalize: (staging: string, entries: T[]) => Promise<Record<string, unknown>>,
): Promise<{ directory: string; manifestSha256: string }> {
  const expected = buildV09AcceptancePlan(plan.releaseManifestSha256, plan.createdAt)
  if (canonicalJsonSha256(plan) !== canonicalJsonSha256(expected)) throw new Error('Acceptance plan differs from the frozen seed contract')
  await mkdir(root, { recursive: true })
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Indirect attempt root forbidden')
  const token = randomUUID(), lock = join(root, '.attempt.lock')
  try { await exclusive(lock, token) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Acceptance attempt locked / already exists'); throw error }
  const attemptId = `attempt-${plan.releaseManifestSha256}`
  const directory = join(root, attemptId), staging = join(root, `.staging-${token}`)
  const claim = join(root, `.claim-${plan.releaseManifestSha256}.json`)
  const journal = { authoritative: false, attemptId, planSha256: canonicalJsonSha256(plan), startedAt: now(), token }
  let staged = false, claimed = false
  try {
    try { await exclusive(claim, canonicalJsonBytes(journal)); claimed = true }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Acceptance attempt already exists (durable claim)'); throw error }
    try { await lstat(directory); throw new Error('Acceptance attempt already exists') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await mkdir(staging); staged = true
    const entries: T[] = []
    for (const seed of plan.seeds) entries.push(await render(seed, staging))
    const metadata = await finalize(staging, entries)
    const manifest = { ...metadata, schemaVersion: 'qmonster-acceptance-attempt-v1', status: 'sealed', attemptId,
      planSha256: journal.planSha256, releaseManifestSha256: plan.releaseManifestSha256,
      startedAt: journal.startedAt, sealedAt: now(), generationPolicy: GENERATION_POLICY, entries }
    await exclusive(join(staging, 'attempt.json'), canonicalJsonBytes(manifest))
    await rename(staging, directory); staged = false
    return { directory, manifestSha256: canonicalJsonSha256(manifest) }
  } catch (error) {
    if (claimed) await exclusive(join(root, `.${token}.failure.json`), canonicalJsonBytes({ ...journal, failedAt: now(), error: String(error) }))
    throw error
  } finally {
    if (staged) await rm(staging, { recursive: true, force: true })
    await ownedUnlink(lock, token)
  }
}

/** Only replaces a direct file whose captured bytes are still unchanged. */
export async function replaceActivePointer(path: string, releaseManifestSha256: string, validate: () => Promise<unknown>): Promise<void> {
  if (!HEX.test(releaseManifestSha256)) throw new Error('Invalid release identity')
  await mkdir(dirname(path), { recursive: true })
  const token = randomUUID(), lock = `${path}.lock`, temporary = `${path}.${token}.tmp`
  await exclusive(lock, token)
  let before: Buffer | undefined, published = false
  const bytes = canonicalJsonBytes({ schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256 })
  try {
    const state = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
    if (state !== undefined && !state.isFile()) throw new Error('Active pointer must be a direct regular file')
    before = await bytesOrMissing(path)
    await exclusive(temporary, bytes)
    const current = await bytesOrMissing(path)
    if (before === undefined ? current !== undefined : !current?.equals(before)) throw new Error('Foreign active pointer changed before activation')
    await rename(temporary, path); published = true
    await validate()
    if (!(await readFile(path)).equals(bytes)) throw new Error('Foreign active pointer changed during validation')
  } catch (error) {
    if (published && (await bytesOrMissing(path))?.equals(bytes)) {
      if (before === undefined) await unlink(path)
      else { await exclusive(temporary, before); await rename(temporary, path) }
    }
    throw error
  } finally { await ownedUnlink(temporary, bytes); await ownedUnlink(lock, token) }
}

async function sourceIdentity(): Promise<string> {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split(/\r?\n/u)
    .filter(path => /^(scripts\/|tests\/|apps\/creator-web\/(src\/|[^/]+\.(html|ts)$)|packages\/[^/]+\/src\/)|(^|\/)(package(-lock)?|tsconfig[^/]*)\.json$|^(vitest|playwright).*\.ts$/u.test(path))
    .filter(path => !/\.tsbuildinfo$/u.test(path)).sort()
  const hash = createHash('sha256')
  for (const path of [...new Set(names)]) { hash.update(path); hash.update(await readFile(path)) }
  return hash.digest('hex')
}
async function buildIdentity(directory = 'apps/creator-web/dist'): Promise<string> {
  const hash = createHash('sha256')
  async function visit(path: string): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'v09-resources') await visit(child) }
      else if (/\.(js|css|html)$/u.test(entry.name)) { hash.update(child.replaceAll('\\', '/')); hash.update(await readFile(child)) }
    }
  }
  await visit(directory)
  return hash.digest('hex')
}

async function runVerification(input: {
  schemaVersion: 'qmonster-v09-preactivation-gate-v1' | 'qmonster-v09-final-verification-v1'
  logRoot: string
  receiptPath: string
  requireInactive: boolean
}): Promise<void> {
  const activeBytes = await bytesOrMissing(ACTIVE)
  if (input.requireInactive && activeBytes) throw new Error('Preactivation gate requires an absent active pointer')
  if (!input.requireInactive && !activeBytes) throw new Error('Final verification requires an active pointer')
  const codeSha256 = await sourceIdentity(), results = []
  await mkdir(input.logRoot, { recursive: true })
  for (const [index, command] of PREACTIVATION_COMMANDS.entries()) {
    const log = `${input.logRoot}/${index + 1}.log`
    const file = await open(log, 'w')
    const startedAt = now()
    console.log(`GATE ${index + 1}/6: ${command}`)
    const exitCode = await new Promise<number>((done, reject) => {
      const child = spawn(command, { shell: true, env: { ...process.env, CI: '1' }, stdio: ['ignore', file.fd, file.fd] })
      child.on('error', reject); child.on('exit', code => done(code ?? -1))
    })
    await file.close()
    results.push({ command, startedAt, finishedAt: now(), exitCode, log, logSha256: digest(await readFile(log)) })
    console.log(`GATE ${index + 1}: exit ${exitCode}`)
    if (exitCode !== 0) throw new Error(`Preactivation blocked: ${command}; see ${log}`)
  }
  if (await sourceIdentity() !== codeSha256) throw new Error('Source changed during gate')
  const receipt = { schemaVersion: input.schemaVersion, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), codeSha256,
    browserBuildSha256: await buildIdentity(), candidatePointerSha256: digest(await readFile(POINTER)),
    ...(activeBytes === undefined ? {} : { activePointerSha256: digest(activeBytes) }), results }
  const temporary = `${input.receiptPath}.${randomUUID()}.tmp`
  await exclusive(temporary, canonicalJsonBytes(receipt)); await rename(temporary, input.receiptPath)
}
async function runGate(): Promise<void> {
  return runVerification({ schemaVersion: 'qmonster-v09-preactivation-gate-v1', logRoot: `${REVIEW_ROOT}/gate-logs`,
    receiptPath: PREACTIVATION_RECEIPT, requireInactive: true })
}
async function runFinalVerification(): Promise<void> {
  return runVerification({ schemaVersion: 'qmonster-v09-final-verification-v1', logRoot: `${REVIEW_ROOT}/final-verification-logs`,
    receiptPath: FINAL_VERIFICATION_RECEIPT, requireInactive: false })
}
async function readRecordedGate() {
  const receipt = JSON.parse(await readFile(PREACTIVATION_RECEIPT, 'utf8'))
  if (receipt.schemaVersion !== 'qmonster-v09-preactivation-gate-v1'
    || receipt.candidatePointerSha256 !== digest(await readFile(POINTER))
    || receipt.results.length !== 6 || receipt.results.some((result: { command: string; exitCode: number }, index: number) => result.command !== PREACTIVATION_COMMANDS[index] || result.exitCode !== 0)) throw new Error('Preactivation receipt is missing, stale or failed')
  for (const result of receipt.results) if (digest(await readFile(result.log)) !== result.logSha256) throw new Error('Gate log identity mismatch')
  return receipt
}
async function verifyGate() {
  const receipt = await readRecordedGate()
  if (receipt.codeSha256 !== await sourceIdentity() || receipt.browserBuildSha256 !== await buildIdentity()) throw new Error('Preactivation receipt is missing, stale or failed')
  return receipt
}

async function verifiedCandidate() {
  const diagnostics = await validateV09CandidatePointer({ root: resolve('packages/asset-catalog'), releasePointer: resolve(POINTER) })
  if (diagnostics.length) throw new Error(`Candidate invalid: ${JSON.stringify(diagnostics)}`)
  return JSON.parse(await readFile(POINTER, 'utf8')) as { schemaVersion: string; releaseManifestSha256: string }
}

async function generateBatch(): Promise<unknown> {
  const gate = await verifyGate(), pointer = await verifiedCandidate()
  const planPath = `${REVIEW_ROOT}/plan.json`, existing = await bytesOrMissing(planPath)
  const plan: Plan = existing === undefined ? buildV09AcceptancePlan(pointer.releaseManifestSha256) : JSON.parse(existing.toString('utf8'))
  if (plan.releaseManifestSha256 !== pointer.releaseManifestSha256) throw new Error('Frozen plan release mismatch')
  if (existing === undefined) await exclusive(planPath, canonicalJsonBytes(plan))
  const [{ chromium }, { createServer }] = await Promise.all([import('@playwright/test'), import('vite')])
  const server = await createServer({ root: resolve('apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 2048, height: 2048 }, deviceScaleFactor: 1 })
    await page.goto(`${server.resolvedUrls!.local![0]}v09-user-review.html`)
    await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
    const identity = await page.evaluate(pointer => window.initializeV09Review(pointer), pointer)
    if (identity.manifestHash !== plan.releaseManifestSha256) throw new Error('Acceptance resolver identity mismatch')
    const contactEntries: Parameters<typeof buildV08ContactSheet>[0][number][] = []
    return await writeAcceptanceAttempt(`${REVIEW_ROOT}/attempts`, plan, async (seed, staging) => {
      const rendered = await page.evaluate(seed => window.renderV09ReviewOnce(seed), seed)
      const png = Buffer.from(rendered.dataUrl.split(',')[1]!, 'base64'), index = plan.seeds.indexOf(seed) + 1
      const specName = `${String(index).padStart(3, '0')}.json`, pngName = `${String(index).padStart(3, '0')}.png`
      const spec = canonicalJsonBytes(rendered.spec)
      await exclusive(join(staging, specName), spec); await exclusive(join(staging, pngName), png)
      contactEntries.push({ index, seed, themeId: rendered.spec.skeletonSelection.class, raritySummary: rendered.spec.skeletonFamilyId, pngBytes: png })
      return { seed, generatedAt: now(), spec: specName, specSha256: digest(spec), png: pngName, pngSha256: digest(png), decodedPngSha256: await decodedPngSha256(png),
        releaseManifestSha256: identity.manifestHash, trace: rendered.trace, identityTransforms: rendered.identityTransforms, resourceIds: rendered.resourceIds, incubator: rendered.incubator }
    }, async staging => {
      const sheet = await buildV08ContactSheet(contactEntries)
      await exclusive(join(staging, 'contact-sheet.png'), sheet.bytes)
      return { browserVersion: browser.version(), browserBuildSha256: gate.browserBuildSha256, codeSha256: gate.codeSha256,
        gateSha256: canonicalJsonSha256(gate), rendererBuildSha256: identity.rendererBuildSha256,
        assemblyTemplates: identity.assemblyTemplates, assemblyApprovals: identity.assemblyApprovals, traitApprovals: identity.traitApprovals,
        contactSheet: { file: 'contact-sheet.png', sha256: digest(sheet.bytes), width: sheet.width, height: sheet.height } }
    })
  } finally { await browser.close(); await server.close() }
}

async function verifySealedAttemptFiles(directory: string, attempt: any): Promise<void> {
  for (const entry of attempt.entries) {
    for (const [file, hash] of [[entry.spec, entry.specSha256], [entry.png, entry.pngSha256]]) {
      if (basename(file) !== file || digest(await readFile(join(directory, file))) !== hash) throw new Error('Acceptance output changed')
    }
    if (await decodedPngSha256(await readFile(join(directory, entry.png))) !== entry.decodedPngSha256) throw new Error('Acceptance decoded PNG changed')
  }
  if (basename(attempt.contactSheet.file) !== attempt.contactSheet.file
    || digest(await readFile(join(directory, attempt.contactSheet.file))) !== attempt.contactSheet.sha256) throw new Error('Contact sheet changed')
}

async function readSealedAttempt(pointer: { releaseManifestSha256: string }, gate: unknown) {
  const plan = JSON.parse(await readFile(`${REVIEW_ROOT}/plan.json`, 'utf8')) as Plan
  const directory = `${REVIEW_ROOT}/attempts/attempt-${pointer.releaseManifestSha256}`
  const attempt = JSON.parse(await readFile(`${directory}/attempt.json`, 'utf8'))
  validateSealedAttemptForActivation(attempt, plan, gate, pointer.releaseManifestSha256)
  await verifySealedAttemptFiles(directory, attempt)
  return attempt
}

async function activate(): Promise<unknown> {
  const gate = await verifyGate()
  const pointer = await verifiedCandidate(), attempt = await readSealedAttempt(pointer, gate)
  await replaceActivePointer(ACTIVE, pointer.releaseManifestSha256, async () => {
    const loaded = await loadActiveV09Release({ root: resolve('packages/asset-catalog') })
    if (loaded.releaseManifestSha256 !== pointer.releaseManifestSha256) throw new Error('Production loader identity mismatch')
  })
  return { activated: pointer.releaseManifestSha256, attemptSha256: canonicalJsonSha256(attempt) }
}

async function verifyActive(): Promise<unknown> {
  const gate = await readRecordedGate(), pointer = await verifiedCandidate()
  const activeBytes = await readFile(ACTIVE)
  const expected = canonicalJsonBytes({ schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: pointer.releaseManifestSha256 })
  if (!activeBytes.equals(expected)) throw new Error('Active pointer identity mismatch')
  const attempt = await readSealedAttempt(pointer, gate)
  const loaded = await loadActiveV09Release({ root: resolve('packages/asset-catalog') })
  if (loaded.releaseManifestSha256 !== pointer.releaseManifestSha256) throw new Error('Production loader identity mismatch')
  return { activePointerSha256: digest(activeBytes), releaseManifestSha256: loaded.releaseManifestSha256,
    attemptSha256: canonicalJsonSha256(attempt) }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invoked) {
  const args = process.argv.slice(2)
  const expected = ['--release-pointer', POINTER, '--plan', `${REVIEW_ROOT}/plan.json`, '--output-root', `${REVIEW_ROOT}/attempts`]
  const action = args.length === 1 && args[0] === '--gate' ? () => withPreactivationGateLock(`${REVIEW_ROOT}/.gate.lock`, runGate)
    : args.length === 1 && args[0] === '--final-verify' ? () => withPreactivationGateLock(`${REVIEW_ROOT}/.gate.lock`, runFinalVerification)
    : args.length === 1 && args[0] === '--verify-active' ? verifyActive
    : args.length === 1 && args[0] === '--activate' ? activate
    : JSON.stringify(args) === JSON.stringify(expected) ? generateBatch : undefined
  if (!action) throw new Error('Use --gate, --final-verify, --verify-active, --activate, or the exact frozen release-pointer/plan/output-root arguments')
  await action().then(result => console.log(JSON.stringify(result ?? { gate: 'passed' }))).catch(error => { console.error(error); process.exitCode = 1 })
}
