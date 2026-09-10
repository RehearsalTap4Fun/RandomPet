import {
  parseMonsterSpec,
  parseMonsterSpecV09,
  V09_TRAIT_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Diagnostic,
  type MonsterSpec,
  type MonsterSpecV09,
  type V09TraitSlotId,
  type VisualSlotId,
} from '@qmonster/generator-core'
import type { AnyCreatorSession, CreatorSession, V09CreatorSession } from './contracts.js'
import {
  mergeSessionDiagnostics,
  refreshSessionValidity,
} from './session-diagnostics.js'

export const CREATOR_SESSION_STORAGE_KEY = 'qmonster.creator.session.v1'
const PERSISTENCE_SCHEMA_VERSION = 2
const MONSTER_SCHEMA_VERSION = '0.1.0'
const DEFAULT_SAVE_DELAY_MS = 250
const MAX_SESSION_BYTES = 1024 * 1024
const MAX_DIAGNOSTICS = 256
const MAX_DIAGNOSTIC_PATH_SEGMENTS = 16
const MAX_DIAGNOSTIC_CODE_POINTS = 128
const MAX_PATH_SEGMENT_CODE_POINTS = 256
const MAX_DIAGNOSTIC_MESSAGE_CODE_POINTS = 2048

export interface SessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LoadSessionResult<T extends AnyCreatorSession = CreatorSession> {
  session: T
  diagnostics: Diagnostic[]
}

export interface SessionTarget {
  schemaVersion?: string
  catalogVersion: string
  rendererVersion: string
  releaseManifestSha256?: string
}

interface PendingSave {
  timer: ReturnType<typeof setTimeout>
  serialized: string
  waiters: Array<(diagnostics: Diagnostic[]) => void>
}

const pendingSaves = new WeakMap<SessionStorage, PendingSave>()

function warning(code: 'SESSION_LOAD_FAILED' | 'SESSION_SAVE_FAILED', message: string): Diagnostic {
  return { severity: 'warning', code, path: [], message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function codePointLength(value: string): number {
  return [...value].length
}

function isWithinSessionSizeLimit(serialized: string): boolean {
  return new TextEncoder().encode(serialized).byteLength <= MAX_SESSION_BYTES
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return isRecord(value)
    && (value.severity === 'warning' || value.severity === 'error')
    && typeof value.code === 'string'
    && Array.isArray(value.path)
    && value.path.length <= MAX_DIAGNOSTIC_PATH_SEGMENTS
    && value.path.every(item => typeof item === 'string')
    && typeof value.message === 'string'
    && codePointLength(value.code) <= MAX_DIAGNOSTIC_CODE_POINTS
    && value.path.every(segment => codePointLength(segment) <= MAX_PATH_SEGMENT_CODE_POINTS)
    && codePointLength(value.message) <= MAX_DIAGNOSTIC_MESSAGE_CODE_POINTS
}

function isBoundedDiagnosticArray(value: unknown): value is Diagnostic[] {
  return Array.isArray(value)
    && value.length <= MAX_DIAGNOSTICS
    && value.every(isDiagnostic)
}

function boundedDiagnosticSourceBuckets(
  generationDiagnostics: unknown,
  renderDiagnostics: unknown,
): [Diagnostic[], Diagnostic[]] | null {
  if (
    !Array.isArray(generationDiagnostics)
    || !Array.isArray(renderDiagnostics)
    || generationDiagnostics.length + renderDiagnostics.length > MAX_DIAGNOSTICS
    || !generationDiagnostics.every(isDiagnostic)
    || !renderDiagnostics.every(isDiagnostic)
  ) return null
  return [generationDiagnostics, renderDiagnostics]
}

function parseLocks(value: unknown): Record<VisualSlotId, boolean> | null {
  if (!isRecord(value)) return null
  if (!VISUAL_SLOT_IDS.every(slotId => typeof value[slotId] === 'boolean')) return null
  return Object.fromEntries(
    VISUAL_SLOT_IDS.map(slotId => [slotId, value[slotId]]),
  ) as Record<VisualSlotId, boolean>
}

function parseV09Locks(value: unknown): V09CreatorSession['locks'] | null {
  if (!isRecord(value) || typeof value.skeleton !== 'boolean' || !isRecord(value.visualSlots)) return null
  const visualSlots = value.visualSlots
  if (!V09_TRAIT_SLOT_IDS.every(slotId => typeof visualSlots[slotId] === 'boolean')) return null
  return {
    skeleton: value.skeleton,
    visualSlots: Object.fromEntries(
      V09_TRAIT_SLOT_IDS.map(slotId => [slotId, visualSlots[slotId]]),
    ) as Record<V09TraitSlotId, boolean>,
  }
}

function equalDiagnostics(left: readonly Diagnostic[], right: readonly Diagnostic[]): boolean {
  return left.length === right.length && left.every((diagnostic, index) => {
    const expected = right[index]!
    return diagnostic.severity === expected.severity
      && diagnostic.code === expected.code
      && diagnostic.message === expected.message
      && diagnostic.path.length === expected.path.length
      && diagnostic.path.every((segment, pathIndex) => segment === expected.path[pathIndex])
  })
}

type StoredSessionBase =
  | Omit<CreatorSession, 'generationDiagnostics' | 'renderDiagnostics' | 'diagnostics' | 'blocked'>
  | Omit<V09CreatorSession, 'generationDiagnostics' | 'renderDiagnostics' | 'diagnostics' | 'blocked'>

function parseStoredSessionBase(value: Record<string, unknown>): StoredSessionBase | null {
  const parsedLegacySpec = parseMonsterSpec(value.spec)
  const parsedV09Spec = parseMonsterSpecV09(value.spec)
  if (!isRecord(value.exportCapabilities)) return null
  if (
    typeof value.exportCapabilities.png !== 'boolean'
    || typeof value.exportCapabilities.webp !== 'boolean'
  ) return null
  const exportCapabilities = {
    png: value.exportCapabilities.png,
    webp: value.exportCapabilities.webp,
  }
  if (parsedV09Spec.ok) {
    const locks = parseV09Locks(value.locks)
    if (locks === null || typeof value.releaseManifestSha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(value.releaseManifestSha256)) return null
    return { spec: parsedV09Spec.value, locks, releaseManifestSha256: value.releaseManifestSha256, exportCapabilities }
  }
  if (!parsedLegacySpec.ok || parsedLegacySpec.value.schemaVersion !== MONSTER_SCHEMA_VERSION) return null
  const locks = parseLocks(value.locks)
  return locks === null ? null : { spec: parsedLegacySpec.value, locks, exportCapabilities }
}

function cloneDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.map(item => ({ ...item, path: [...item.path] }))
}

function parseStoredSessionV1(value: unknown): AnyCreatorSession | null {
  if (!isRecord(value)) return null
  if (!isBoundedDiagnosticArray(value.diagnostics)) return null
  const base = parseStoredSessionBase(value)
  if (base === null) return null
  if (typeof value.blocked !== 'boolean') return null
  if (value.blocked !== value.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return null
  return refreshSessionValidity({
    ...base,
    generationDiagnostics: cloneDiagnostics(value.diagnostics),
    renderDiagnostics: [],
  })
}

function parseStoredSessionV2(value: unknown): AnyCreatorSession | null {
  if (!isRecord(value)) return null
  const sourceBuckets = boundedDiagnosticSourceBuckets(
    value.generationDiagnostics,
    value.renderDiagnostics,
  )
  if (
    sourceBuckets === null
    || !isBoundedDiagnosticArray(value.diagnostics)
    || typeof value.blocked !== 'boolean'
  ) return null
  const base = parseStoredSessionBase(value)
  if (base === null) return null
  const [storedGenerationDiagnostics, storedRenderDiagnostics] = sourceBuckets
  const generationDiagnostics = cloneDiagnostics(storedGenerationDiagnostics)
  const renderDiagnostics = cloneDiagnostics(storedRenderDiagnostics)
  const diagnostics = mergeSessionDiagnostics(generationDiagnostics, renderDiagnostics)
  if (!equalDiagnostics(value.diagnostics, diagnostics)) return null
  if (value.blocked !== diagnostics.some(diagnostic => diagnostic.severity === 'error')) return null
  return refreshSessionValidity({
    ...base,
    generationDiagnostics,
    renderDiagnostics,
  })
}

function defaultStorage(): SessionStorage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
  } catch {
    return undefined
  }
}

function loadFailure<T extends AnyCreatorSession>(createFreshSession: () => T, message: string): LoadSessionResult<T> {
  return {
    session: createFreshSession(),
    diagnostics: [warning('SESSION_LOAD_FAILED', message)],
  }
}

export function loadSession<T extends AnyCreatorSession = CreatorSession>(
  createFreshSession: () => T,
  storage: SessionStorage | undefined = defaultStorage(),
  target?: SessionTarget,
): LoadSessionResult<T> {
  let preparedFreshSession: T | undefined
  const freshSession = (): T => {
    preparedFreshSession ??= createFreshSession()
    return preparedFreshSession
  }
  if (storage === undefined) {
    return loadFailure(freshSession, 'Local session storage is unavailable.')
  }
  let serialized: string | null
  try {
    serialized = storage.getItem(CREATOR_SESSION_STORAGE_KEY)
  } catch {
    return loadFailure(freshSession, 'The saved creator session could not be read.')
  }
  if (serialized === null) return { session: freshSession(), diagnostics: [] }
  if (!isWithinSessionSizeLimit(serialized)) {
    return loadFailure(freshSession, 'The saved creator session exceeds the storage size limit.')
  }
  try {
    const envelope = JSON.parse(serialized) as unknown
    if (!isRecord(envelope) || (envelope.schemaVersion !== 1 && envelope.schemaVersion !== 2)) {
      return loadFailure(freshSession, 'The saved creator session uses an unsupported version.')
    }
    const session = envelope.schemaVersion === 1
      ? parseStoredSessionV1(envelope.session)
      : parseStoredSessionV2(envelope.session)
    if (session === null) {
      return loadFailure(freshSession, 'The saved creator session is incomplete or invalid.')
    }
    const freshSessionValue = freshSession()
    const freshSpec = freshSessionValue.spec
    const expectedTarget = target ?? {
      schemaVersion: freshSpec.schemaVersion,
      catalogVersion: freshSpec.catalogVersion,
      rendererVersion: 'rendererVersion' in freshSpec ? freshSpec.rendererVersion : freshSpec.generatorVersion,
      ...('releaseManifestSha256' in freshSessionValue
        ? { releaseManifestSha256: freshSessionValue.releaseManifestSha256 }
        : {}),
    }
    const sessionRendererVersion = 'rendererVersion' in session.spec
      ? session.spec.rendererVersion
      : session.spec.generatorVersion
    if (
      (expectedTarget.schemaVersion !== undefined && session.spec.schemaVersion !== expectedTarget.schemaVersion)
      || session.spec.catalogVersion !== expectedTarget.catalogVersion
      || sessionRendererVersion !== expectedTarget.rendererVersion
      || (expectedTarget.releaseManifestSha256 !== undefined
        && (!('releaseManifestSha256' in session)
          || session.releaseManifestSha256 !== expectedTarget.releaseManifestSha256))
    ) {
      return loadFailure(freshSession, 'The saved creator session targets a different catalog or renderer.')
    }
    return { session: session as T, diagnostics: [] }
  } catch {
    return loadFailure(freshSession, 'The saved creator session is not valid JSON.')
  }
}

function saveFailure(message: string): Diagnostic[] {
  return [warning('SESSION_SAVE_FAILED', message)]
}

export function saveSession(
  session: AnyCreatorSession,
  storage: SessionStorage | undefined = defaultStorage(),
): Promise<Diagnostic[]> {
  if (storage === undefined) {
    return Promise.resolve(saveFailure('Local session storage is unavailable.'))
  }
  if (boundedDiagnosticSourceBuckets(session.generationDiagnostics, session.renderDiagnostics) === null) {
    return Promise.resolve(saveFailure('The creator session exceeds diagnostic resource limits.'))
  }
  const validated = parseStoredSessionV2(session)
  if (validated === null) {
    return Promise.resolve(saveFailure('The creator session is incomplete or uses an unsupported version.'))
  }
  let serialized: string
  try {
    serialized = JSON.stringify({ schemaVersion: PERSISTENCE_SCHEMA_VERSION, session: validated })
  } catch {
    return Promise.resolve(saveFailure('The creator session could not be serialized.'))
  }
  if (!isWithinSessionSizeLimit(serialized)) {
    return Promise.resolve(saveFailure('The creator session exceeds the storage size limit.'))
  }

  return new Promise(resolve => {
    const pending = pendingSaves.get(storage)
    const waiters = pending?.waiters ?? []
    if (pending !== undefined) clearTimeout(pending.timer)
    waiters.push(resolve)
    const next: PendingSave = {
      serialized,
      waiters,
      timer: setTimeout(() => {
        let diagnostics: Diagnostic[] = []
        try {
          storage.setItem(CREATOR_SESSION_STORAGE_KEY, next.serialized)
        } catch {
          diagnostics = saveFailure('The creator session could not be saved to local storage.')
        }
        pendingSaves.delete(storage)
        for (const waiter of next.waiters) waiter(diagnostics)
      }, DEFAULT_SAVE_DELAY_MS),
    }
    pendingSaves.set(storage, next)
  })
}
