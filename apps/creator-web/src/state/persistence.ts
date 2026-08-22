import {
  parseMonsterSpec,
  VISUAL_SLOT_IDS,
  type Diagnostic,
  type VisualSlotId,
} from '@qmonster/generator-core'
import type { CreatorSession } from './contracts.js'

export const CREATOR_SESSION_STORAGE_KEY = 'qmonster.creator.session.v1'
const PERSISTENCE_SCHEMA_VERSION = 1
const MONSTER_SCHEMA_VERSION = '0.1.0'
const DEFAULT_SAVE_DELAY_MS = 250

export interface SessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
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

function isDiagnostic(value: unknown): value is Diagnostic {
  return isRecord(value)
    && (value.severity === 'warning' || value.severity === 'error')
    && typeof value.code === 'string'
    && Array.isArray(value.path)
    && value.path.every(item => typeof item === 'string')
    && typeof value.message === 'string'
}

function parseLocks(value: unknown): Record<VisualSlotId, boolean> | null {
  if (!isRecord(value)) return null
  if (!VISUAL_SLOT_IDS.every(slotId => typeof value[slotId] === 'boolean')) return null
  return Object.fromEntries(
    VISUAL_SLOT_IDS.map(slotId => [slotId, value[slotId]]),
  ) as Record<VisualSlotId, boolean>
}

function parseStoredSession(value: unknown): CreatorSession | null {
  if (!isRecord(value)) return null
  const parsedSpec = parseMonsterSpec(value.spec)
  if (!parsedSpec.ok || parsedSpec.value.schemaVersion !== MONSTER_SCHEMA_VERSION) return null
  const locks = parseLocks(value.locks)
  if (locks === null || !Array.isArray(value.diagnostics) || !value.diagnostics.every(isDiagnostic)) return null
  if (typeof value.blocked !== 'boolean' || !isRecord(value.exportCapabilities)) return null
  if (
    typeof value.exportCapabilities.png !== 'boolean'
    || typeof value.exportCapabilities.webp !== 'boolean'
  ) return null
  return {
    spec: parsedSpec.value,
    locks,
    diagnostics: value.diagnostics.map(item => ({ ...item, path: [...item.path] })),
    blocked: value.blocked,
    exportCapabilities: {
      png: value.exportCapabilities.png,
      webp: value.exportCapabilities.webp,
    },
  }
}

function defaultStorage(): SessionStorage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
  } catch {
    return undefined
  }
}

function loadFailure(createFreshSession: () => CreatorSession, message: string): CreatorSession {
  const fresh = createFreshSession()
  return {
    ...fresh,
    diagnostics: [...fresh.diagnostics, warning('SESSION_LOAD_FAILED', message)],
  }
}

export function loadSession(
  createFreshSession: () => CreatorSession,
  storage: SessionStorage | undefined = defaultStorage(),
): CreatorSession {
  if (storage === undefined) {
    return loadFailure(createFreshSession, 'Local session storage is unavailable.')
  }
  let serialized: string | null
  try {
    serialized = storage.getItem(CREATOR_SESSION_STORAGE_KEY)
  } catch {
    return loadFailure(createFreshSession, 'The saved creator session could not be read.')
  }
  if (serialized === null) return createFreshSession()
  try {
    const envelope = JSON.parse(serialized) as unknown
    if (!isRecord(envelope) || envelope.schemaVersion !== PERSISTENCE_SCHEMA_VERSION) {
      return loadFailure(createFreshSession, 'The saved creator session uses an unsupported version.')
    }
    const session = parseStoredSession(envelope.session)
    if (session === null) {
      return loadFailure(createFreshSession, 'The saved creator session is incomplete or invalid.')
    }
    return session
  } catch {
    return loadFailure(createFreshSession, 'The saved creator session is not valid JSON.')
  }
}

function saveFailure(message: string): Diagnostic[] {
  return [warning('SESSION_SAVE_FAILED', message)]
}

export function saveSession(
  session: CreatorSession,
  storage: SessionStorage | undefined = defaultStorage(),
): Promise<Diagnostic[]> {
  if (storage === undefined) {
    return Promise.resolve(saveFailure('Local session storage is unavailable.'))
  }
  const validated = parseStoredSession(session)
  if (validated === null) {
    return Promise.resolve(saveFailure('The creator session is incomplete or uses an unsupported version.'))
  }
  let serialized: string
  try {
    serialized = JSON.stringify({ schemaVersion: PERSISTENCE_SCHEMA_VERSION, session: validated })
  } catch {
    return Promise.resolve(saveFailure('The creator session could not be serialized.'))
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
